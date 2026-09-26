// Verify the critic's palette-fragility finding (attack C) against the CURRENT judge.
//
// The critic showed that `satA > 0.05` was a hard cliff: with a purple accent, color was
// misread as geometry and imagery as color; with grey/stone accents, imagery was always
// misread as geometry and color always misread. The fixture's own satA sat 5.5x above the
// gate, so the fragility was invisible in-band.
//
// The fix replaced mean-saturation-of-a-box with the saturation of the largest flat region
// (the panel's own fill), which removes the absolute denominator.
//
// This script swaps the accent colour and re-runs the SAME perturbers the benchmark uses, so
// it tests the judge rather than a second, divergent implementation of the defects.
//
// Run: node bench/verify-palette.mjs
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import { measurePair, decide } from './judge.mjs';

const ACCENTS = [
  ['green (fixture default)', '#059669'],
  ['purple', '#7c3aed'],
  ['stone (low sat)', '#78716c'],
  ['pure grey', '#808080'],
  ['near-white', '#f9fafb'],
  ['red', '#dc2626'],
  ['amber', '#d97706'],
  ['navy', '#1e3a8a'],
];

/** Recolour the hero panel (and its text) so the panel's own fill is the given accent. */
function specWithAccent(accent) {
  const s = cleanSpec();
  for (const p of s.prims) if (p.kind === 'hero-panel') p.fill = accent;
  return s;
}

const SEVS = [0.03, 0.05, 0.06, 0.2, 0.5];
const DEFECTS = ['color', 'imagery', 'geometry', 'typography', 'spacing'];
let fail = 0, total = 0;
const failures = [];

console.log('accent                    ' + DEFECTS.map(d => d.slice(0, 8).padEnd(9)).join('') + '(cells show verdict; X = wrong)');
for (const [name, accent] of ACCENTS) {
  const base = specWithAccent(accent);
  const ref = await renderSpec(base, { scale: RENDER_SCALE });
  const cells = [];
  for (const defect of DEFECTS) {
    let bad = 0, n = 0;
    for (const sev of SEVS) {
      // applyDefect perturbs the spec it is given, so the swapped accent flows through.
      const { spec } = applyDefect(base, defect, sev);
      const m = await measurePair(ref, await renderSpec(spec, { scale: RENDER_SCALE }));
      const d = decide(m);
      n++; total++;
      if (d.label !== defect) { bad++; fail++; failures.push({ name, defect, sev, got: d.label, reason: d.reason }); }
    }
    cells.push((bad === 0 ? 'ok' : `X${bad}/${n}`).padEnd(9));
  }
  console.log(name.padEnd(26) + cells.join(''));
}

console.log(`\npalette-robustness: ${total - fail}/${total} correct`);
if (fail) {
  console.log('\nfirst failures:');
  for (const f of failures.slice(0, 10)) console.log(`  ${f.name} / ${f.defect} @ ${f.sev}: got ${f.got} :: ${f.reason}`);
}
console.log(fail === 0
  ? 'PASS: detection survives every accent swap, including grey and near-white'
  : `FAIL: ${fail} misclassifications — the rule is still palette-dependent`);
process.exitCode = fail === 0 ? 0 : 1;

