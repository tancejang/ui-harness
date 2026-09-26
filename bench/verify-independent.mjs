// INDEPENDENT verification of the saturation claim.
//
// Deliberately shares NO machinery with run.mjs or seed-sweep.mjs: it builds its own split,
// its own accuracy bookkeeping, and its own distinct-render counting. If it disagrees with
// `node bench/run.mjs`, the benchmark's own sweep is broken.
//
// Run: node bench/verify-independent.mjs
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import { classify } from './judge.mjs';

const CLASSES = ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean'];

// The band is READ, not hard-coded. It used to be a literal `[0.03, 0.06]`, which silently
// went stale when the band rotated — the script then reported 480/480 on a RETIRED band and
// printed "agreement with bench/run.mjs headline: both say 1.0000" while run.mjs was reporting
// 0.9167. A verification tool that can disagree with reality and still exit 0 is worse than no
// tool, so it now reads the same source of truth as everything else.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BAND = JSON.parse(await fs.readFile(path.join(HERE, 'eval-band.json'), 'utf8')).band;

const refPng = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });

// Own PRNG (xorshift32), deliberately different from the mulberry32 used elsewhere.
function xorshift(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

console.log(`independent sweep: band [${BAND[0]}, ${BAND[1]}], scale ${RENDER_SCALE}`);
console.log('seeds: 20 xorshift seeds, 24 cases each = 480 cases\n');

let hits = 0, total = 0;
const perClass = Object.fromEntries(CLASSES.map(c => [c, { ok: 0, n: 0 }]));
const distinctPerClass = Object.fromEntries(CLASSES.map(c => [c, new Set()]));
const accBySeed = [];

for (let seed = 1; seed <= 20; seed++) {
  const rand = xorshift(seed * 2654435761);
  let sHit = 0, sTot = 0;
  for (const cls of CLASSES) {
    for (let rep = 0; rep < 4; rep++) {
      const mag = cls === 'clean' ? 0 : BAND[0] + rand() * (BAND[1] - BAND[0]);
      const { spec } = applyDefect(cleanSpec(), cls, mag);
      const png = await renderSpec(spec, { scale: RENDER_SCALE });
      distinctPerClass[cls].add(crypto.createHash('sha256').update(png).digest('hex'));
      const r = await classify(refPng, png);
      total++; sTot++; perClass[cls].n++;
      if (r.label === cls) { hits++; sHit++; perClass[cls].ok++; }
    }
  }
  accBySeed.push(sHit / sTot);
}

const mean = accBySeed.reduce((a, b) => a + b, 0) / accBySeed.length;
console.log(`accuracy: ${hits}/${total} = ${(hits / total).toFixed(4)}`);
console.log(`per-seed mean = ${mean.toFixed(4)}   distinct accuracies = ${[...new Set(accBySeed.map(a => a.toFixed(4)))].join(', ')}`);
console.log(`perfect seeds = ${accBySeed.filter(a => a === 1).length}/${accBySeed.length}\n`);

console.log('per-class:');
let weak = [];
for (const c of CLASSES) {
  const { ok, n } = perClass[c];
  const pct = (100 * ok / n).toFixed(1);
  if (ok < n) weak.push(c);
  console.log(`  ${c.padEnd(11)}${ok}/${n} (${pct}%)   distinct renders=${distinctPerClass[c].size}/${n}`);
}

console.log(`\nindependent verdict: ${weak.length === 0 ? 'no class fails on this band' : 'weak classes: ' + weak.join(', ')}`);

// Compare against run.mjs by ACTUALLY RUNNING IT, rather than asserting agreement from a
// formula. The old line printed "both say 1.0000" purely from this script's own number, so it
// claimed agreement with a benchmark it had never consulted — and went on claiming it after the
// two had diverged.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
let headline = null, note = '';
try {
  const { stdout } = await execFileAsync(process.execPath, ['bench/run.mjs', '--json'], { cwd: path.join(HERE, '..'), maxBuffer: 64 * 1024 * 1024 });
  headline = JSON.parse(stdout).evalAcc;
} catch (e) {
  // run.mjs exits non-zero on a failed round but still prints JSON.
  try { headline = JSON.parse(e.stdout ?? '').evalAcc; } catch { note = ` (could not read run.mjs: ${e.message})`; }
}

const mine = hits / total;
if (headline === null) {
  console.log(`agreement with bench/run.mjs: UNVERIFIED${note}`);
} else {
  const delta = Math.abs(mine - headline);
  console.log(`independent=${mine.toFixed(4)}  run.mjs=${headline.toFixed(4)}  delta=${delta.toFixed(4)}`);
  console.log(`agreement with bench/run.mjs: ${delta <= 0.05 ? 'CONSISTENT (within 0.05)' : 'DISAGREEMENT — investigate'}`);
}

// Distinct-render check, at the same 90% standard run.mjs uses. Demanding 100% is wrong: at
// 80 fine samples across a narrow band two magnitudes can legitimately round to the same render.
// What must not happen is a LOW ceiling, which is the quantization failure this guards against.
const MIN_FRACTION = 0.9;
const collapsed = CLASSES.filter(c => c !== 'clean' && distinctPerClass[c].size < perClass[c].n * MIN_FRACTION);
console.log(`distinct-render gate (>= ${MIN_FRACTION * 100}% unique): ${collapsed.length === 0 ? 'PASSED' : 'FAILED for ' + collapsed.map(c => `${c} (${distinctPerClass[c].size}/${perClass[c].n})`).join(', ')}`);

// Exit non-zero when the instrument itself is unsound. The script used to exit 0 even while
// printing "distinct-render gate: FAILED", which made it useless as a check.
process.exitCode = collapsed.length === 0 ? 0 : 1;
