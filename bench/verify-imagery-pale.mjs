// Reproduce a critic's open finding: imagery is undetectable when the hero starts pale.
//
// The `imagery` defect represents artwork that failed to load, modelled as a pale overlay
// composited over the hero panel. That model has a blind spot the critic found: if the panel is
// ALREADY near the overlay colour, compositing changes almost nothing, so the defect is
// invisible no matter how severe it is.
//
// This measures how large that blind spot is and whether it is confined to genuinely degenerate
// input. Run: node bench/verify-imagery-pale.mjs
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import { measurePair, decide } from './judge.mjs';

// Panel colours spanning saturated -> near-white, which is the axis the blind spot lies on.
const PANELS = [
  ['saturated green (default)', '#059669'],
  ['saturated blue', '#2563eb'],
  ['mid grey', '#78716c'],
  ['very pale', '#eef2f6'],
  ['near overlay colour', '#f8fafc'],
  ['exactly the overlay colour', '#f8fafc'],
];

function specWith(accent) {
  const s = cleanSpec();
  for (const p of s.prims) if (p.kind === 'hero-panel') p.fill = accent;
  return s;
}

const MAGS = [0.02, 0.05, 0.2, 0.5, 1.0];
let detectable = 0, total = 0;
const blind = [];

console.log('panel                        ' + MAGS.map(m => String(m).padEnd(9)).join(''));
for (const [name, accent] of PANELS) {
  const base = specWith(accent);
  const ref = await renderSpec(base, { scale: RENDER_SCALE });
  const cells = [];
  for (const mag of MAGS) {
    const { spec } = applyDefect(base, 'imagery', mag);
    const m = await measurePair(ref, await renderSpec(spec, { scale: RENDER_SCALE }));
    const d = decide(m);
    total++;
    if (d.label === 'imagery') { detectable++; cells.push('ok'.padEnd(9)); }
    else { blind.push({ name, mag, got: d.label, dSat: m.dSat, satA: m.satA }); cells.push(('->' + d.label.slice(0, 6)).padEnd(9)); }
  }
  console.log(name.padEnd(29) + cells.join(''));
}

console.log(`\nimagery detectable in ${detectable}/${total} (panel colour x severity) combinations`);
console.log('\nblind spot detail (cases where a wash-out was NOT reported):');
for (const b of blind) {
  console.log(`  ${b.name.padEnd(28)} mag=${String(b.mag).padEnd(5)} -> ${b.got.padEnd(10)} panel saturation=${b.satA.toFixed(3)} dSat=${b.dSat.toFixed(3)}`);
}

const paleBlind = blind.filter(b => b.satA < 0.10).length;
const saturatedBlind = blind.filter(b => b.satA >= 0.10).length;
console.log(`\nof the misses: ${paleBlind} are on a near-neutral panel (saturation < 0.10), ${saturatedBlind} are on a saturated panel`);
console.log(saturatedBlind === 0
  ? 'CONFINED: every miss is a near-neutral panel, where a saturation-based defect cannot exist by definition.\nThat is a genuine limitation to document, not a coding bug.'
  : `BUG: ${saturatedBlind} saturated panels also fail, which is a real defect in the rule.`);
process.exitCode = saturatedBlind === 0 ? 0 : 1;
