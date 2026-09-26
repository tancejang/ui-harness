// UIH self-improvement evaluation harness.
//
// The single source of truth for "did this cycle improve anything".
//
// It reports, on ONE line per split:
//   model score, constant-predictor score, random-predictor score,
//   TRAIN label distribution, EVAL label distribution
//
// Two independent instruments:
//   1. UNIT  — the repo's own `npm test` suite. Reported for regressions only; it is
//              deterministic and single-label, so it is explicitly marked DEGENERATE and
//              is never allowed to be the improvement signal on its own.
//   2. BENCH — the held-out UI defect benchmark (bench/run.mjs). Multi-class, non-circular,
//              validated by bench/controls.mjs. THIS is the improvement signal.
//
// Exit codes: 0 = ok, 2 = eval split fails to beat the constant predictor, 3 = degenerate
//             labelling on a split that must be multi-class, 1 = harness/internal error.
//
// Usage:
//   node eval.mjs                  human report
//   node eval.mjs --json           machine-readable, single JSON object on stdout
//   node eval.mjs --score-only     just the two REQUIRED lines

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(ROOT, '.uih', 'eval');

// ------------------------------------------------------------------ instruments

async function runUnit() {
  let stdout = '', failed = false;
  try {
    const r = await execFileAsync(process.execPath, ['--test', ...(await fs.readdir(path.join(ROOT, 'test'))).filter(f => f.endsWith('.test.mjs')).map(f => path.join('test', f))], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    stdout = r.stdout + r.stderr;
  } catch (e) {
    stdout = (e.stdout ?? '') + (e.stderr ?? '');
    failed = true;
  }
  const tests = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^(ok|not ok)\s+\d+\s+-\s+(.+)$/);
    if (m) tests.push({ name: m[2], passed: m[1] === 'ok' });
  }
  const total = tests.length;
  const passed = tests.filter(t => t.passed).length;
  const dist = { passed, failed: total - passed };
  const classes = Object.values(dist).filter(v => v > 0).length;
  return {
    name: 'unit',
    score: total ? passed / total : 0,
    const: total ? Math.max(dist.passed, dist.failed) / total : 0,
    rand: 0.5,
    trainDist: dist,
    evalDist: dist,
    degenerate: classes < 2,
    total,
    passed,
    failed,
    raw: stdout,
    spawnFailed: failed && total === 0,
  };
}

async function runBench() {
  const { stdout } = await execFileAsync(process.execPath, ['bench/run.mjs', '--json'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  const j = JSON.parse(stdout);
  return {
    name: 'bench',
    score: j.evalAcc,
    trainScore: j.trainAcc,
    const: j.evalConst,
    trainConst: j.trainConst,
    rand: j.evalRand,
    trainRand: j.trainRand,
    trainDist: j.trainDist,
    evalDist: j.evalDist,
    minShare: j.minShare,
    degenerate: Object.values(j.evalDist).filter(v => v > 0).length < 2,
    beatsConst: j.beatsConst,
    confusion: j.confusion,
    errors: j.errors,
  };
}

// ------------------------------------------------------------------ reporting

const CLASS_ORDER = ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean'];
const fmtDist = d => '{' + Object.keys(d).map(k => `${k}:${d[k]}`).join(',') + '}';

function requiredLine(split, m) {
  return `${split.padEnd(5)} model=${m.score.toFixed(4)} const=${m.const.toFixed(4)} rand=${m.rand.toFixed(4)} ` +
    `train_dist=${fmtDist(m.trainDist)} eval_dist=${fmtDist(m.evalDist)}` +
    (m.degenerate ? ' DEGENERATE' : '');
}

function checkBaselines(m, label) {
  const problems = [];
  const total = Object.values(m.evalDist).reduce((a, b) => a + b, 0) || 1;
  const least = Math.min(...Object.values(m.evalDist).filter(v => v > 0)) / total;
  if (m.const < least - 1e-9) problems.push(`${label}: constant (${m.const.toFixed(4)}) below least-frequent class share (${least.toFixed(4)}) — harness bug`);
  if (m.const === 0 && total > 0) problems.push(`${label}: constant predictor scored 0 on a populated set — harness bug`);
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const scoreOnly = args.includes('--score-only');

  const started = Date.now();
  const unit = await runUnit();
  const bench = await runBench();

  const problems = [...checkBaselines(unit, 'unit'), ...checkBaselines(bench, 'bench')];

  // The improvement signal is the benchmark only. Unit is a regression gate.
  const improvements = {
    bench: bench.score,
    benchTrain: bench.trainScore,
    unit: unit.score,
  };

  const verdict = {
    beatsConstant: bench.score > bench.const,
    unitClean: unit.failed === 0,
    unitDegenerate: unit.degenerate,
    benchDegenerate: bench.degenerate,
    problems,
  };

  // ------------------------------------------------------------- required output
  const lines = [];
  lines.push('REQUIRED REPORT LINES (model / constant / random / train dist / eval dist)');
  lines.push(requiredLine('UNIT', unit));
  lines.push(requiredLine('BENCH', bench));
  lines.push('');
  lines.push(`unit:  ${unit.passed}/${unit.total} passed, ${unit.total - unit.passed} failed${unit.degenerate ? ' (DEGENERATE single-label — not an improvement signal)' : ''}`);
  lines.push(`bench: eval=${bench.score.toFixed(4)} train=${bench.trainScore.toFixed(4)} const=${bench.const.toFixed(4)} rand=${bench.rand.toFixed(4)} least_frequent_share=${(bench.minShare ?? 0).toFixed(4)}`);
  lines.push(`verdict: bench ${verdict.beatsConstant ? 'BEATS' : 'FAILS TO BEAT'} constant predictor`);
  if (verdict.unitDegenerate) lines.push('note:  unit suite is single-label by construction; the benchmark is the improvement signal.');
  if (problems.length) for (const p of problems) lines.push(`PROBLEM: ${p}`);

  if (asJson) {
    process.stdout.write(JSON.stringify({
      unit: { score: unit.score, const: unit.const, rand: unit.rand, trainDist: unit.trainDist, evalDist: unit.evalDist, degenerate: unit.degenerate, passed: unit.passed, total: unit.total, failed: unit.failed },
      bench: { score: bench.score, trainScore: bench.trainScore, const: bench.const, rand: bench.rand, trainDist: bench.trainDist, evalDist: bench.evalDist, minShare: bench.minShare, degenerate: bench.degenerate, errors: bench.errors },
      improvements, verdict, ms: Date.now() - started,
    }) + '\n');
  } else if (scoreOnly) {
    process.stdout.write(requiredLine('UNIT', unit) + '\n' + requiredLine('BENCH', bench) + '\n');
  } else {
    console.log(lines.join('\n'));
    if (bench.errors?.length) {
      console.log('\nbench eval errors:');
      for (const e of bench.errors) console.log(`  ${e.id} truth=${e.truth} pred=${e.pred} conf=${e.conf} :: ${e.reason}`);
    }
    console.log(`\nelapsed ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  // Persist a history record so cycles are comparable.
  await fs.mkdir(RESULTS, { recursive: true });
  const record = { at: new Date().toISOString(), unit: { score: unit.score, const: unit.const, rand: unit.rand, passed: unit.passed, total: unit.total, degenerate: unit.degenerate }, bench: { score: bench.score, trainScore: bench.trainScore, const: bench.const, rand: bench.rand, minShare: bench.minShare, trainDist: bench.trainDist, evalDist: bench.evalDist }, improvements, verdict, ms: Date.now() - started };
  await fs.writeFile(path.join(RESULTS, `${record.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(record, null, 2));
  await fs.writeFile(path.join(RESULTS, 'latest.json'), JSON.stringify(record, null, 2));

  // Exit codes
  if (problems.length) process.exitCode = 1;
  else if (!verdict.beatsConstant) process.exitCode = 2;
  else if (bench.degenerate) process.exitCode = 3;
}

main().catch(e => { console.error('[eval] fatal:', e); process.exit(1); });
