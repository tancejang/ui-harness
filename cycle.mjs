// Cycle recorder for the self-improvement loop.
//
// The orchestrator (me, across turns) calls this to record what actually happened:
// a builder proposed a change, the eval harness produced before/after numbers, and a
// FRESH-CONTEXT critic — which inspected the real artifacts — returned a verdict.
//
// This writes .uih/agent/cycle-NNN.json, which progress.mjs renders. Nothing here is
// allowed to invent a number: every score must come from a recorded eval run.
//
// Usage:
//   node cycle.mjs begin  --piece <p> --title <t> --builder <id>
//   node cycle.mjs score  --piece <p> --phase before|after     (runs eval.mjs, records it)
//   node cycle.mjs critic --piece <p> --id <critic-agent-id> --verdict <v> --gap <g> [--notes <file>]
//   node cycle.mjs settle --piece <p> --accepted true|false --commit <sha> [--reverted true]
//   node cycle.mjs show

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(ROOT, '.uih', 'agent');

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

async function listCycles() {
  try {
    return (await fs.readdir(DIR)).filter(f => /^cycle-\d+\.json$/.test(f)).sort();
  } catch { return []; }
}

async function readCycle(file) {
  return JSON.parse(await fs.readFile(path.join(DIR, file), 'utf8'));
}

async function writeCycle(c) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `cycle-${String(c.cycle).padStart(3, '0')}.json`), JSON.stringify(c, null, 2));
}

async function findOpen(piece) {
  const files = await listCycles();
  for (const f of files.reverse()) {
    const c = await readCycle(f);
    if (c.piece === piece && !c.settled) return c;
  }
  return null;
}

async function runEval() {
  // Read the harness's own machine-readable output; never paraphrase a score.
  let stdout;
  try {
    const r = await execFileAsync(process.execPath, ['eval.mjs', '--json'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    stdout = r.stdout;
  } catch (e) {
    // eval.mjs exits non-zero on failed rounds; it still prints JSON.
    stdout = e.stdout ?? '';
    if (!stdout.trim()) throw new Error(`eval.mjs produced no output: ${e.message}`);
  }
  const j = JSON.parse(stdout);
  return j;
}

async function main() {
  const cmd = process.argv[2];
  const piece = arg('piece');

  if (cmd === 'begin') {
    const files = await listCycles();
    const n = files.length + 1;
    const c = {
      cycle: n,
      piece,
      title: arg('title', ''),
      builder: arg('builder', ''),
      startedAt: new Date().toISOString(),
      before: null, after: null, delta: null,
      unitBefore: null, unitAfter: null,
      critic: null,
      accepted: null,
      commit: null,
      reverted: null,
      settled: false,
    };
    await writeCycle(c);
    console.log(JSON.stringify({ cycle: n, file: `cycle-${String(n).padStart(3, '0')}.json` }, null, 2));
    return;
  }

  if (cmd === 'score') {
    const phase = arg('phase');
    const c = await findOpen(piece);
    if (!c) throw new Error(`no open cycle for piece "${piece}"`);
    const explicit = arg('value');
    let j = null, score, unitPct = null;
    if (explicit !== null) {
      // Recording a value eval.mjs can no longer reproduce, because the instrument
      // itself is what changed. Requires an explicit --note explaining the provenance.
      score = Number(explicit);
    } else {
      j = await runEval();
      score = j.bench.score;
      unitPct = `${j.unit.passed}/${j.unit.total}`;
    }
    if (phase === 'before') {
      c.before = score;
      c.unitBefore = unitPct;
      if (j) c.beforeDetail = { bench: j.bench, unit: { score: j.unit.score, passed: j.unit.passed, total: j.unit.total } };
      if (explicit !== null) c.beforeNote = arg('note', 'historical value recorded manually');
    } else if (phase === 'after') {
      c.after = score;
      c.unitAfter = unitPct;
      if (j) c.afterDetail = { bench: j.bench, unit: { score: j.unit.score, passed: j.unit.passed, total: j.unit.total } };
      if (explicit !== null) c.afterNote = arg('note', 'historical value recorded manually');
    } else throw new Error('--phase must be before|after');
    if (c.before != null && c.after != null) c.delta = Number((c.after - c.before).toFixed(4));
    if (j) {
      c.evalVerdict = j.verdict;
      c.regressionGate = { unitFailed: j.unit.failed, unitClean: j.unit.failed === 0 };
    }
    await writeCycle(c);
    console.log(JSON.stringify({ cycle: c.cycle, phase, score, unit: unitPct, problems: j?.verdict?.problems }, null, 2));
    return;
  }

  if (cmd === 'critic') {
    const c = await findOpen(piece);
    if (!c) throw new Error(`no open cycle for piece "${piece}"`);
    let notes = arg('notes');
    if (notes) {
      try { notes = await fs.readFile(path.resolve(ROOT, notes), 'utf8'); } catch { /* keep the raw string */ }
    }
    c.critic = {
      id: arg('id', ''),
      verdict: arg('verdict', ''),          // wowed | pass | fail
      biggest_gap: arg('gap', ''),
      notes: notes ?? '',
    };
    await writeCycle(c);
    console.log(JSON.stringify(c.critic, null, 2));
    return;
  }

  if (cmd === 'settle') {
    const c = await findOpen(piece);
    if (!c) throw new Error(`no open cycle for piece "${piece}"`);
    c.accepted = arg('accepted') === 'true';
    c.commit = arg('commit');
    c.reverted = arg('reverted') === 'true';
    c.settled = true;
    c.settledAt = new Date().toISOString();
    await writeCycle(c);
    console.log(JSON.stringify({ cycle: c.cycle, accepted: c.accepted, commit: c.commit }, null, 2));
    return;
  }

  if (cmd === 'show') {
    const files = await listCycles();
    for (const f of files) console.log(JSON.stringify(await readCycle(f), null, 2));
    return;
  }

  console.log(`usage:
  node cycle.mjs begin  --piece <p> --title <t> --builder <id>
  node cycle.mjs score  --piece <p> --phase before|after
  node cycle.mjs critic --piece <p> --id <agent-id> --verdict <wowed|pass|fail> --gap <text> [--notes <file>]
  node cycle.mjs settle --piece <p> --accepted <true|false> --commit <sha> [--reverted true]
  node cycle.mjs show`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
