// Difficulty analysis: where does the judge actually break?
//
// A benchmark at 1.0000 has no gradient, so no cycle can "strictly raise" it. Before
// building any improvement loop we must find the regime where the judge fails, and make
// THAT the eval split. Otherwise the loop would be moving a needle that is pegged.
//
// This script sweeps defect magnitude downward until accuracy leaves 1.0, and reports the
// breakdown point per class. The resulting band becomes the held-out eval difficulty.

import { cleanSpec, renderSpec } from './fixture.mjs';
import { classify } from './judge.mjs';

const CLASSES = ['geometry', 'typography', 'spacing', 'color', 'imagery'];

function clone(s) { return { W: s.W, H: s.H, prims: s.prims.map(p => ({ ...p, box: [...p.box] })) }; }
const sel = (s, k) => s.prims.filter(p => p.kind === k);

function perturb(base, cls, mag) {
  const s = clone(base);
  const move = (k, dx, dy) => { for (const p of sel(s, k)) { p.box[0] += Math.round(dx); p.box[1] += Math.round(dy); } };
  switch (cls) {
    case 'geometry': move('hero-panel', 18 * mag, 14 * mag); move('hero-text', 18 * mag, 14 * mag); move('hero-sub', 18 * mag, 14 * mag); break;
    case 'typography':
      for (const p of sel(s, 'header-text')) p.size = Math.max(6, Math.round(p.size * (1 - 0.30 * mag)));
      for (const p of sel(s, 'stat-value')) p.size = Math.max(6, Math.round(p.size * (1 - 0.35 * mag)));
      for (const p of sel(s, 'hero-text')) p.size = Math.max(6, Math.round(p.size * (1 - 0.30 * mag)));
      break;
    case 'spacing': { const y0 = sel(s, 'button-primary')[0].box[1]; for (const p of s.prims) if (p.box[1] >= y0) p.box[1] += Math.round(14 * mag); break; }
    case 'color': for (const p of sel(s, 'hero-panel')) p.fill = mag >= 0.5 ? '#d97706' : '#f59e0b'; break;
    case 'imagery':
      for (const p of sel(s, 'hero-panel')) p.fill = mag >= 0.85 ? '#ffffff' : '#e5e7eb';
      for (const p of sel(s, 'hero-text')) p.fill = mag >= 0.85 ? '#ffffff' : '#9ca3af';
      for (const p of sel(s, 'hero-sub')) p.fill = mag >= 0.85 ? '#ffffff' : '#9ca3af';
      break;
  }
  return s;
}

const refPng = await renderSpec(cleanSpec());

console.log('per-class breakdown point (accuracy at each magnitude)\n');
const mags = [1.0, 0.85, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06, 0.04, 0.02];
const head = 'mag    ' + CLASSES.map(c => c.slice(0, 9).padEnd(11)).join('') + 'clean';
console.log(head);
for (const mag of mags) {
  const cells = [];
  for (const cls of CLASSES) {
    const png = await renderSpec(perturb(cleanSpec(), cls, mag));
    const r = await classify(refPng, png);
    cells.push((r.label === cls ? 'ok' : `->${r.label.slice(0, 6)}`).padEnd(11));
  }
  const pngc = await renderSpec(cleanSpec());
  const rc = await classify(refPng, pngc);
  cells.push(rc.label === 'clean' ? 'ok' : `->${rc.label}`);
  console.log(String(mag).padEnd(7) + cells.join(''));
}

console.log('\nInterpretation: the eval split should sit where accuracy is meaningfully < 1.0.');
