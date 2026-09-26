// Smoke-test the design-rule measurements against the fixture, including hand-checkable
// cases whose answers can be derived on paper before running any code.
//
// Run: node bench/design-rules-smoke.mjs
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import {
  greyRampCount, greyTemperature, textContrast, verticalGaps, spacingSystem,
  radiusCluster, contrastRatio, rgbToHsl,
} from './design-rules.mjs';

const cleanPng = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures++;
};

console.log('--- CO-2 grey ramp ---');
const ramp = await greyRampCount(cleanPng);
console.log(`  distinct near-neutral luminance buckets: ${ramp}`);
check('CO-2 has a grey ramp (>= 5 levels)', ramp >= 5, `got ${ramp}`);

console.log('--- CO-5 grey temperature ---');
const t = await greyTemperature(cleanPng);
console.log(`  meanHue=${t.meanHue === null ? 'none (pure neutral)' : t.meanHue.toFixed(1) + 'deg'} spread=${t.spread.toFixed(1)} n=${t.count}`);
// Hand-derived: the fixture's greys are #f3f4f6 / #6b7280 / #111827, all Tailwind "cool gray"
// at hue 220. A consistent cool temperature is therefore the CORRECT reading, not contamination.
check('CO-5 greys share a consistent temperature', t.meanHue !== null && t.spread < 5 && t.count > 100,
  `meanHue=${t.meanHue?.toFixed(1)} spread=${t.spread.toFixed(2)}`);

console.log('--- CO-6 text contrast ---');
const c = await textContrast(cleanPng);
console.log(`  n=${c.n} p05=${c.p05.toFixed(2)} p50=${c.p50.toFixed(2)} p95=${c.p95.toFixed(2)}  (WCAG body text needs >= 4.5)`);
console.log('  note: a LOW reading here is the fixture failing the rule, not a broken measurement.');
check('CO-6 measurement produces a usable distribution', c.n > 1000 && c.p95 > 8, `n=${c.n} p95=${c.p95.toFixed(2)}`);

console.log('--- SP-2/3 spacing system ---');
const g = await verticalGaps(cleanPng, RENDER_SCALE);
const s = spacingSystem(g);
console.log(`  gaps(logical)=${g.map(x => x.toFixed(1)).join(',')}`);
console.log(`  fitted scale=${s.scale.join(',')} violations=${s.violations.length}`);
for (const v of s.violations) console.log(`    ${v.a} -> ${v.b} ratio ${v.ratio} (< 1.25)`);
check('SP-2/3 finds exactly the real 24->28 and 28->32 violations', s.violations.length === 2,
  `found ${s.violations.length}`);

console.log('--- LV-5 radius cluster ---');
const r = await radiusCluster(cleanPng);
console.log(`  radii=${r.radii.join(',')} distinct=${r.distinct} (skipped ${r.skipped} canvas-clipped)`);
check('LV-5 radii cluster on a bounded set', r.distinct > 0 && r.distinct <= 4, `distinct=${r.distinct}`);

console.log('\n--- HAND CHECK: contrast of known colour pairs ---');
// Worked by hand from the WCAG relative-luminance formula.
//   white on #2563eb (primary)   -> 5.17:1  PASS
//   white on #059669 (accent)    -> 3.77:1  FAIL  (the fixture really does fail WCAG here)
//   #6b7280 on #f3f4f6 (muted)   -> 4.39:1  FAIL  (just under the bar)
const white = [255, 255, 255], primary = [0x25, 0x63, 0xeb], accent = [0x05, 0x96, 0x69];
const muted = [0x6b, 0x72, 0x80], panel = [0xf3, 0xf4, 0xf6];
const expected = [
  ['white on primary', contrastRatio(white, primary), true, 5.17],
  ['white on accent', contrastRatio(white, accent), false, 3.77],
  ['muted on panel', contrastRatio(muted, panel), false, 4.39],
];
for (const [name, got, wantPass, want] of expected) {
  console.log(`  ${name.padEnd(18)} = ${got.toFixed(2)}:1  (hand-derived ${want}:1)  ${got >= 4.5 ? 'PASS' : 'FAIL'}`);
  check(`${name} matches the hand-derived value`, Math.abs(got - want) < 0.02, `got ${got.toFixed(2)} want ${want}`);
  check(`${name} pass/fail matches hand derivation`, (got >= 4.5) === wantPass);
}

console.log('\n--- HAND CHECK: HSL conversion ---');
const hsl = rgbToHsl(primary);
console.log(`  #2563eb -> h=${hsl.h.toFixed(1)} s=${(hsl.s * 100).toFixed(0)}% l=${(hsl.l * 100).toFixed(0)}%`);
check('HSL hue of a blue lands in [200,240]', hsl.h >= 200 && hsl.h <= 240, `h=${hsl.h.toFixed(1)}`);

console.log('\n--- HAND CHECK: spacing perturbation moves the expected gap ---');
// By construction the spacing defect translates the block below the hero by 14*mag logical
// px, so at mag 1 the largest vertical gap must grow. Direction and rough magnitude are
// derived on paper before running.
const spaced = await renderSpec(applyDefect(cleanSpec(), 'spacing', 1).spec, { scale: RENDER_SCALE });
const g2 = await verticalGaps(spaced, RENDER_SCALE);
const dMax = Math.max(...g2) - Math.max(...g);
console.log(`  max gap clean=${Math.max(...g).toFixed(1)} spacing(mag=1)=${Math.max(...g2).toFixed(1)} delta=${dMax.toFixed(1)} (hand expectation: positive)`);
check('spacing grows the max gap in the derived direction', dMax > 0, `delta=${dMax.toFixed(1)}`);

console.log(`\ndesign-rule smoke: ${failures === 0 ? 'ALL CHECKS PASS' : failures + ' CHECK FAILURE(S)'}`);
process.exitCode = failures === 0 ? 0 : 1;
