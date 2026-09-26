// Seed sweep: is EVAL 1.0000 robust, or tuned to seed 97?
//
// A perfect score that only holds for one seed is overfitting. This rebuilds the eval
// split under many seeds (same band, same size, different magnitudes) and reports the
// distribution of accuracies, plus which classes fail when they fail.
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import { classify } from './judge.mjs';

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const CLASSES = ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean'];
const refPng = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });

const SEEDS = [];
for (let s = 1; s <= 30; s++) SEEDS.push(s * 7 + 90);

const accs = [];
const classFail = Object.fromEntries(CLASSES.map(c => [c, 0]));
const classTot = Object.fromEntries(CLASSES.map(c => [c, 0]));
const bandArg = process.argv[2];

for (const seed of SEEDS) {
  const rand = mulberry32(seed);
  let hit = 0, tot = 0;
  for (let rep = 0; rep < 4; rep++) {
    for (const cls of CLASSES) {
      const mag = cls === 'clean' ? 0 : 0.06 + rand() * (0.11 - 0.06);
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
console.log(`seed sweep over ${SEEDS.length} seeds (band [0.06, 0.11], 24 cases each)`);
console.log(`  distinct accuracies: ${[...new Set(accs.map(a => a.toFixed(4)))].sort().join(', ')}`);
console.log(`  mean=${mean.toFixed(4)}  min=${sorted[0].toFixed(4)}  median=${sorted[Math.floor(sorted.length / 2)].toFixed(4)}  max=${sorted[sorted.length - 1].toFixed(4)}`);
console.log(`  perfect seeds: ${accs.filter(a => a === 1).length}/${accs.length}`);
console.log('\nper-class failure rate across all seeds:');
for (const c of CLASSES) console.log(`  ${c.padEnd(11)}${classFail[c]}/${classTot[c]} failed`);
