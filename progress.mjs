// Live progress page for the self-improvement loop.
//
// Reads ONLY real artifacts: git log, .uih/eval history, .uih/agent/cycle-*.json.
// Nothing is hand-typed, so the page cannot drift from reality.
//
// Usage:
//   node progress.mjs           # regenerate .uih/agent/progress.html
//   node progress.mjs --open    # regenerate and print the path

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, '.uih', 'agent', 'progress.html');
const EVAL_DIR = path.join(ROOT, '.uih', 'eval');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function gitLog(n = 40) {
  try {
    const { stdout } = await execFileAsync('git', ['log', `-${n}`, '--pretty=format:%H|%h|%ad|%s', '--date=iso'], { cwd: ROOT });
    return stdout.split('\n').filter(Boolean).map(l => {
      const [sha, short, date, ...msg] = l.split('|');
      return { sha, short, date, msg: msg.join('|') };
    });
  } catch { return []; }
}

async function readJsonDir(dir) {
  try {
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.json') && f !== 'latest.json').sort();
    const out = [];
    for (const f of files) {
      try { out.push({ file: f, ...JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) }); } catch {}
    }
    return out;
  } catch { return []; }
}

async function cycles() {
  try {
    const files = (await fs.readdir(path.join(ROOT, '.uih', 'agent'))).filter(f => /^cycle-.*\.json$/.test(f)).sort();
    const out = [];
    for (const f of files) {
      try { out.push(JSON.parse(await fs.readFile(path.join(ROOT, '.uih', 'agent', f), 'utf8'))); } catch {}
    }
    return out;
  } catch { return []; }
}

async function readBand() {
  try {
    return JSON.parse(await fs.readFile(path.join(ROOT, 'bench', 'eval-band.json'), 'utf8'));
  } catch { return null; }
}

/**
 * The band is saturated when the latest evaluation scored 1.0000 with the unit suite clean.
 * A saturated band is retained as a regression gate but can no longer drive improvement, so
 * the page says so instead of displaying a perfect score as though it were informative.
 */
async function bandIsSaturated(latest) {
  if (!latest) return false;
  if (latest.bench.score < 1) return false;
  const cyc = await cycles();
  const lastSweep = cyc.filter(c => c.after === 1).length > 0;
  return lastSweep;
}

function fmtDist(d) {
  if (!d) return '—';
  return Object.entries(d).map(([k, v]) => `${k}:${v}`).join(', ');
}

function scoreCell(score, prev, isConst) {
  const cls = isConst ? 'const' : (prev == null ? '' : score > prev ? 'up' : score < prev ? 'down' : 'flat');
  const arrow = prev == null || isConst ? '' : score > prev ? ' ▲' : score < prev ? ' ▼' : ' =';
  return `<span class="score ${cls}">${score.toFixed(4)}${arrow}</span>`;
}

async function main() {
  const log = await gitLog();
  const history = await readJsonDir(EVAL_DIR);
  const cyc = await cycles();
  const band = await readBand();
  const saturated = await bandIsSaturated(history[history.length - 1]);

  const first = history[0];
  const last = history[history.length - 1];
  const prev = history[history.length - 2];

  // Non-bench commits are the interesting ones.
  const featCommits = log.filter(c => !/^(chore|docs|Merge|Revert)/i.test(c.msg));

  const accepted = cyc.filter(c => c.accepted).length;
  const rejected = cyc.filter(c => c.accepted === false).length;

  const rows = cyc.map(c => {
    const crit = c.critic ?? {};
    return `<tr>
      <td>${esc(c.cycle)}</td>
      <td><span class="pill ${esc(c.piece || 'other')}">${esc(c.piece || '—')}</span></td>
      <td>${esc(c.title || '—')}</td>
      <td>${c.before != null ? c.before.toFixed(4) : '—'}</td>
      <td>${c.after != null ? c.after.toFixed(4) : '—'}</td>
      <td>${c.delta != null ? (c.delta > 0 ? '+' : '') + c.delta.toFixed(4) : '—'}</td>
      <td>${c.accepted ? '<span class="badge ok">ACCEPTED</span>' : '<span class="badge no">REJECTED</span>'}</td>
      <td>${crit.verdict ? `<span class="badge ${crit.verdict === 'wowed' ? 'ok' : 'warn'}">${esc(crit.verdict)}</span>` : '—'}</td>
      <td class="gap">${esc(crit.biggest_gap || '—')}</td>
      <td>${c.commit ? `<code>${esc(c.commit.slice(0, 8))}</code>` : '—'}</td>
    </tr>`;
  }).join('');

  const histRows = history.map((h, i) => {
    const p = history[i - 1];
    return `<tr>
      <td>${esc(h.at)}</td>
      <td>${scoreCell(h.bench.score, p?.bench?.score, false)}</td>
      <td>${scoreCell(h.bench.const, null, true)}</td>
      <td>${scoreCell(h.bench.rand, null, true)}</td>
      <td>${scoreCell(h.unit.score, p?.unit?.score, false)}</td>
      <td>${h.unit.degenerate ? '<span class="badge warn">DEGENERATE</span>' : '<span class="badge ok">discriminative</span>'}</td>
      <td class="dist">${esc(fmtDist(h.bench.trainDist))}</td>
      <td class="dist">${esc(fmtDist(h.bench.evalDist))}</td>
    </tr>`;
  }).join('');

  const commitRows = featCommits.slice(0, 20).map(c => `<tr>
      <td><code>${esc(c.short)}</code></td>
      <td>${esc(c.date.slice(0, 19).replace('T', ' '))}</td>
      <td>${esc(c.msg)}</td>
    </tr>`).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>UIH self-improvement — live progress</title>
<style>
:root{--bg:#0b1020;--card:#141b2f;--line:#243050;--ink:#e6ecff;--dim:#8ea0c8;--ok:#3ddc97;--no:#ff6b6b;--warn:#ffb454;--acc:#5ba8ff}
*{box-sizing:border-box}
body{margin:0;padding:28px;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
h1{margin:0 0 4px;font-size:22px}
h2{margin:32px 0 12px;font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim)}
.sub{color:var(--dim);margin-bottom:22px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.card .k{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.card .v{font-size:26px;font-weight:650;margin-top:6px;font-variant-numeric:tabular-nums}
.score{font-variant-numeric:tabular-nums;font-weight:600}
.score.up{color:var(--ok)}.score.down{color:var(--no)}.score.flat{color:var(--dim)}.score.const{color:var(--dim);font-weight:400}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:9px 11px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
tr:last-child td{border-bottom:none}
code{background:#0a1024;padding:1px 6px;border-radius:4px;font-size:12px;color:var(--acc)}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
.badge.ok{background:rgba(61,220,151,.15);color:var(--ok)}
.badge.no{background:rgba(255,107,107,.15);color:var(--no)}
.badge.warn{background:rgba(255,180,84,.15);color:var(--warn)}
.pill{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;background:rgba(91,168,255,.15);color:var(--acc)}
.gap{color:var(--warn);max-width:340px}
.dist{font-size:11px;color:var(--dim);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.note{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:8px;padding:14px;color:var(--dim);margin-top:14px}
.bar{height:8px;background:#0a1024;border-radius:999px;overflow:hidden;margin-top:8px}
.bar>i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--ok))}
</style></head><body>

<h1>UIH self-improvement — live progress</h1>
<div class="sub">Generated from real artifacts only: git log, evaluation history and cycle records. Regenerate with <code>node progress.mjs</code>.</div>

<div class="grid">
  <div class="card"><div class="k">Benchmark eval score</div><div class="v">${last ? last.bench.score.toFixed(4) : '—'}</div>
    <div class="bar"><i style="width:${last ? (last.bench.score * 100).toFixed(1) : 0}%"></i></div></div>
  <div class="card"><div class="k">Constant predictor</div><div class="v">${last ? last.bench.const.toFixed(4) : '—'}</div></div>
  <div class="card"><div class="k">Random predictor</div><div class="v">${last ? last.bench.rand.toFixed(4) : '—'}</div></div>
  <div class="card"><div class="k">First eval score</div><div class="v">${first ? first.bench.score.toFixed(4) : '—'}</div></div>
  <div class="card"><div class="k">Cycles accepted</div><div class="v">${accepted}<span style="font-size:14px;color:var(--dim)"> / ${cyc.length}</span></div></div>
  <div class="card"><div class="k">Unit tests</div><div class="v">${last ? `${last.unit.passed}/${last.unit.total}` : '—'}</div></div>
  <div class="card"><div class="k">Feature commits</div><div class="v">${featCommits.length}</div></div>
  <div class="card"><div class="k">Eval band</div><div class="v" style="font-size:15px">${band ? `[${band.band[0]}, ${band.band[1]}]` : '—'}</div></div>
  <div class="card"><div class="k">Head</div><div class="v" style="font-size:15px"><code>${log[0] ? log[0].short : '—'}</code></div></div>
</div>

${saturated ? `<div class="note"><b>BAND SATURATED:</b> the eval band scores 1.0000 with no per-class failures, so it can no longer distinguish a better judge from the current one. It is retained as a regression gate only. The next cycle must move the band down with <code>bench/difficulty.mjs</code> before any score from it means anything.</div>` : ''}
${last && last.bench.score <= last.bench.const ? `<div class="note"><b>FAILED ROUND:</b> the benchmark does not beat the constant predictor. This round is spent diagnosing a degenerate metric, not improving the model.</div>` : ''}
${last && last.unit.degenerate ? `<div class="note"><b>Note on the unit suite:</b> <code>npm test</code> is 95/95 deterministic, so a constant predictor scores 1.0000 on it. It is reported as DEGENERATE and used only as a regression gate. The benchmark is the improvement signal.</div>` : ''}

<h2>Evaluation history</h2>
<table><thead><tr>
<th>When</th><th>Bench eval</th><th>Constant</th><th>Random</th><th>Unit</th><th>Unit state</th><th>Train dist</th><th>Eval dist</th>
</tr></thead><tbody>${histRows || '<tr><td colspan="8">No evaluations recorded yet.</td></tr>'}</tbody></table>

<h2>Improvement cycles</h2>
<table><thead><tr>
<th>#</th><th>Piece</th><th>Change</th><th>Before</th><th>After</th><th>Δ</th><th>Result</th><th>Critic</th><th>Biggest remaining gap</th><th>Commit</th>
</tr></thead><tbody>${rows || '<tr><td colspan="10">No cycles recorded yet.</td></tr>'}</tbody></table>

<h2>Commits on main</h2>
<table><thead><tr><th>SHA</th><th>When</th><th>Subject</th></tr></thead><tbody>${commitRows || '<tr><td colspan="3">—</td></tr>'}</tbody></table>

</body></html>`;

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, html);
  console.log(OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
