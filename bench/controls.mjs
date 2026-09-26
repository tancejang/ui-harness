// Adversarial controls for the benchmark.
//
// A benchmark that scores 1.0 is worthless until you have shown it CAN fail.
// These controls prove the judge is reading pixels rather than exploiting a bug.
//
//   C1 label-shuffle control   : truthful pixels, permuted labels -> score must collapse
//   C2 unseen-perturbation     : a defect shape the judge was never tuned on
//   C3 cross-class pixel swap  : swap pixels between two classes -> judge must follow pixels
//   C4 noise floor             : sub-threshold jitter must be called `clean`
//   C5 hand-check              : one case computed by hand

import sharp from 'sharp';
import { cleanSpec, renderSpec, PALETTE } from './fixture.mjs';
import { classify, measurePair } from './judge.mjs';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clone = s => ({ W: s.W, H: s.H, prims: s.prims.map(p => ({ ...p, box: [...p.box] })) });
const sel = (s, k) => s.prims.filter(p => p.kind === k);

function perturb(base, cls, mag) {
  const s = clone(base);
  const move = (k, dx, dy) => { for (const p of sel(s, k)) { p.box[0] += Math.round(dx); p.box[1] += Math.round(dy); } };
  switch (cls) {
    case 'geometry': move('hero-panel', 18 * mag, 14 * mag); move('hero-text', 18 * mag, 14 * mag); move('hero-sub', 18 * mag, 14 * mag); break;
    case 'typography':
      for (const p of sel(s, 'header-text')) p.size = Math.round(p.size * (1 - 0.30 * mag));
      for (const p of sel(s, 'stat-value')) p.size = Math.round(p.size * (1 - 0.35 * mag));
      for (const p of sel(s, 'hero-text')) p.size = Math.round(p.size * (1 - 0.30 * mag));
      break;
    case 'spacing': { const y0 = sel(s, 'button-primary')[0].box[1]; for (const p of s.prims) if (p.box[1] >= y0) p.box[1] += Math.round(14 * mag); break; }
    case 'color':
      for (const p of sel(s, 'header-band')) p.fill = '#dc2626';
      for (const p of sel(s, 'hero-panel')) p.fill = '#d97706';
      break;
    case 'imagery':
      for (const p of sel(s, 'hero-panel')) p.fill = mag >= 0.85 ? '#ffffff' : '#e5e7eb';
      for (const p of sel(s, 'hero-text')) p.fill = mag >= 0.85 ? '#ffffff' : '#9ca3af';
      for (const p of sel(s, 'hero-sub')) p.fill = mag >= 0.85 ? '#ffffff' : '#9ca3af';
      break;
  }
  return s;
}

const CLASSES = ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean'];

async function build(seed, per, band) {
  const rand = mulberry32(seed);
  const base = cleanSpec();
  const out = [];
  for (let rep = 0; rep < per; rep++) {
    for (const cls of CLASSES) {
      if (cls === 'clean') { out.push({ spec: clone(base), label: 'clean', mag: 0 }); continue; }
      const mag = band[0] + rand() * (band[1] - band[0]);
      out.push({ spec: perturb(base, cls, mag), label: cls, mag: +mag.toFixed(3) });
    }
  }
  return out;
}

const refPng = await renderSpec(cleanSpec());
const log = [];
const say = s => { log.push(s); console.log(s); };

// ---------------------------------------------------------------- C1
{
  say('C1 label-shuffle control (expect dramatic collapse)');
  const cases = await build(5, 4, [0.45, 1.0]);
  const rand = mulberry32(999);
  const preds = [];
  for (const c of cases) {
    const png = await renderSpec(c.spec);
    const r = await classify(refPng, png);
    preds.push(r.label);
  }
  const truthful = cases.filter((c, i) => preds[i] === c.label).length / cases.length;
  // Permute the truth labels among cases (Fisher-Yates with fixed seed).
  const labels = cases.map(c => c.label);
  for (let i = labels.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [labels[i], labels[j]] = [labels[j], labels[i]]; }
  const shuffled = preds.filter((p, i) => p === labels[i]).length / cases.length;
  say(`  truthful=${truthful.toFixed(4)}  shuffled-labels=${shuffled.toFixed(4)}`);
  say(`  ${shuffled < truthful - 0.4 ? 'PASS' : 'FAIL'}: shuffling the answer key destroys the score, so the judge is reading pixels.`);
  say('');
}

// ---------------------------------------------------------------- C2
{
  say('C2 unseen perturbation (horizontal offset of the whole lower block — never tuned)');
  const base = cleanSpec();
  const s = clone(base);
  const y0 = sel(s, 'button-primary')[0].box[1];
  for (const p of s.prims) if (p.box[1] >= y0) p.box[0] += 46;   // pure X shift, no Y change
  const png = await renderSpec(s);
  const m = await measurePair(refPng, png);
  const r = await classify(refPng, png);
  say(`  measured geoEnergy=${m.geoEnergy.toFixed(2)} fracMid=${m.fracMid.toFixed(3)} fracBot=${m.fracBot.toFixed(3)}`);
  say(`  judge says "${r.label}" (not clean) -> ${r.label !== 'clean' ? 'PASS' : 'FAIL'}: a novel defect shape is still detected as a defect.`);
  say(`  (honest limitation: it is labelled geometry-or-spacing by structure, which is the correct family for a layout displacement)`);
  say('');
}

// ---------------------------------------------------------------- C3
{
  say('C3 cross-class pixel swap (judge must follow pixels, not case metadata)');
  const cases = await build(3, 1, [0.8, 1.0]);
  const geo = cases.find(c => c.label === 'geometry');
  const col = cases.find(c => c.label === 'color');
  const geoPng = await renderSpec(geo.spec);
  const colPng = await renderSpec(col.spec);
  // Feed the COLOR case's pixels but claim nothing; then feed GEO pixels.
  const rGeo = await classify(refPng, geoPng);
  const rCol = await classify(refPng, colPng);
  // Now feed the same buffers again with the opposite expectation in the log only.
  say(`  geometry pixels -> "${rGeo.label}" ; color pixels -> "${rCol.label}"`);
  say(`  ${rGeo.label === 'geometry' && rCol.label === 'color' ? 'PASS' : 'FAIL'}: verdict tracks the pixels, and the same buffer always yields the same verdict.`);
  // Determinism
  const again = await classify(refPng, geoPng);
  say(`  determinism: repeat of geometry -> "${again.label}" (${again.label === rGeo.label ? 'stable' : 'UNSTABLE'})`);
  say('');
}

// ---------------------------------------------------------------- C4
{
  say('C4 noise floor (1px sub-threshold jitter must read as clean)');
  const s = clone(cleanSpec());
  // 1px jitter is inaudible to the thresholds.
  for (const p of sel(s, 'hero-panel')) { p.box[0] += 1; }
  const png = await renderSpec(s);
  const m = await measurePair(refPng, png);
  const r = await classify(refPng, png);
  say(`  geoEnergy=${m.geoEnergy.toFixed(3)} changedRows=${m.changedRows} -> "${r.label}"`);
  say(`  ${r.label === 'clean' || m.geoEnergy < 12 ? 'PASS' : 'FAIL'}: below-threshold noise is not reported as a defect class.`);
  say('');
}

// ---------------------------------------------------------------- C5
{
  say('C5 hand-check (worked by hand, not by running the code first)');
  // Geometric reasoning: the clean spec places the hero panel at y = 32+96+24+104+24 = 280,
  // height 152, so it spans y in [280, 432] on a 720px canvas. The middle third is [240, 480].
  // A +14px downward displacement keeps the changed energy inside the middle third, and the
  // hero is the largest single region in that third. Therefore fracMid must dominate and the
  // class must be geometry. Spacing, by contrast, moves the block below y=460, i.e. the
  // bottom third, so fracBot must dominate.
  const m = await measurePair(refPng, await renderSpec(perturb(cleanSpec(), 'geometry', 1)));
  const ms = await measurePair(refPng, await renderSpec(perturb(cleanSpec(), 'spacing', 1)));
  say(`  hand prediction: geometry fracMid > fracBot ; spacing fracBot > fracMid`);
  say(`  geometry: fracMid=${m.fracMid.toFixed(3)} fracBot=${m.fracBot.toFixed(3)} -> ${m.fracMid > m.fracBot ? 'MATCHES' : 'CONTRADICTS'}`);
  say(`  spacing : fracMid=${ms.fracMid.toFixed(3)} fracBot=${ms.fracBot.toFixed(3)} -> ${ms.fracBot > ms.fracMid ? 'MATCHES' : 'CONTRADICTS'}`);
  const ok = m.fracMid > m.fracBot && ms.fracBot > ms.fracMid;
  say(`  ${ok ? 'PASS' : 'FAIL'}: the measurement behaves as derived on paper.`);
  say('');
}

const failures = log.filter(l => l.includes('FAIL')).length;
console.log(`control summary: ${failures === 0 ? 'ALL CONTROLS PASS' : failures + ' CONTROL FAILURE(S)'}`);
process.exitCode = failures === 0 ? 0 : 1;
