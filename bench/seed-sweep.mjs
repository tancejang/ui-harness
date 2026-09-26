// Seed sweep: is the eval score robust, or tuned to one seed?
//
// A perfect score that only holds for one seed is overfitting. This rebuilds the eval split
// under many seeds (same band, same size, different magnitudes) and reports the distribution
// of accuracies, plus which classes fail when they fail.
//
// The band is read from eval-band.json so this file cannot drift from run.mjs — earlier they
// carried independent copies of the band, which is how a stale sweep kept reporting a
// saturated result for a band that had already moved.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import { classify } from './judge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(await fs.readFile(path.join(HERE, 'eval-band.json'), 'utf8'));
const BAND = CFG.band;
const PER = CFG.casesPerClass;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const CLASSES = ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean'];
const refPng = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });

const N_SEEDS = Number(process.argv[2]) || 30;
const SEEDS = [];
for (let s = 1; s <= N_SEEDS; s++) SEEDS.push(s * 7 + 90);

const accs = [];
const classFail = Object.fromEntries(CLASSES.map(c => [c, 0]));
const classTot = Object.fromEntries(CLASSES.map(c => [c, 0]));

for (const seed of SEEDS) {
  const rand = mulberry32(seed);
  let hit = 0, tot = 0;
  for (let rep = 0; rep < PER; rep++) {
    for (const cls of CLASSES) {
      const mag = cls === 'clean' ? 0 : BAND[0] + rand() * (BAND[1] - BAND[0]);
      const { spec } = applyDefect(cleanSpec(), cls, mag);
      const r = await classify(refPng, await renderSpec(spec, { scale: RENDER_SCALE }));
      tot++; classTot[cls]++;
      if (r.label === cls) hit++; else classFail[cls]++;
    }
  }
  accs.push(hit / tot);
}

const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
const sorted = [...accs].sort((a, b) => a - b);
console.log(`seed sweep over ${SEEDS.length} seeds (band [${BAND[0]}, ${BAND[1]}], ${PER} cases per class each)`);
console.log(`  distinct accuracies: ${[...new Set(accs.map(a => a.toFixed(4)))].sort().join(', ')}`);
console.log(`  mean=${mean.toFixed(4)}  min=${sorted[0].toFixed(4)}  median=${sorted[Math.floor(sorted.length / 2)].toFixed(4)}  max=${sorted[sorted.length - 1].toFixed(4)}`);
console.log(`  perfect seeds: ${accs.filter(a => a === 1).length}/${accs.length}`);
console.log('\nper-class failure rate across all seeds:');
const weak = [];
for (const c of CLASSES) {
  const pct = classTot[c] ? (100 * classFail[c] / classTot[c]) : 0;
  if (classFail[c] > 0) weak.push(c);
  console.log(`  ${c.padEnd(11)}${classFail[c]}/${classTot[c]} failed${classFail[c] ? ` (${pct.toFixed(1)}%)` : ''}`);
}

// A sweep mean of 1.0000 with no per-class failures means this band is SATURATED: it can no
// longer distinguish a better judge from the current one, so it cannot drive improvement.
// That is a finding, not a failure — it means the band must move down (see bench/README.md).
const saturated = mean === 1 && weak.length === 0;
console.log(`\nband status: ${saturated ? 'SATURATED — re-derive the band with bench/difficulty.mjs before using it as an improvement signal' : 'has headroom (weak classes: ' + weak.join(', ') + ')'}`);
process.exitCode = saturated ? 0 : 0;

