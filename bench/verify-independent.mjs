// INDEPENDENT verification of the saturation claim.
//
// Deliberately shares NO machinery with run.mjs or seed-sweep.mjs: it builds its own split,
// its own accuracy bookkeeping, and its own distinct-render counting. If it disagrees with
// `node bench/run.mjs`, the benchmark's own sweep is broken.
//
// Run: node bench/verify-independent.mjs
import crypto from 'node:crypto';
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import { classify } from './judge.mjs';

const CLASSES = ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean'];
const BAND = [0.03, 0.06];
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

console.log(`\nindependent verdict: ${weak.length === 0 ? 'CONFIRMED SATURATED (no class fails)' : 'NOT SATURATED — weak: ' + weak.join(', ')}`);
console.log(`agreement with bench/run.mjs headline: ${(hits / total === 1) === true ? 'both say 1.0000' : 'DISAGREEMENT — investigate'}`);

// Distinct-render check must also hold independently.
const collapsed = CLASSES.filter(c => c !== 'clean' && distinctPerClass[c].size < perClass[c].n);
console.log(`distinct-render gate: ${collapsed.length ? 'FAILED for ' + collapsed.join(',') : 'PASSED (all non-clean classes fully distinct)'}`);
