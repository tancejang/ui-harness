// Smoke-test the design-rule measurements against the fixture, and against a case whose
// answer we can reason about by hand (the clean spec uses a 32/16/24 spacing rhythm and a
// 6/8px corner radius, so the system test must pass; the graded-spacing case must fail).
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import {
  greyRampCount, greyTemperature, textContrast, verticalGaps, spacingSystem,
  radiusCluster, contrastRatio, rgbToHsl,
} from './design-rules.mjs';

const cleanPng = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });

console.log('--- CO-2 grey ramp ---');
console.log('  distinct near-neutral luminance buckets:', await greyRampCount(cleanPng));

console.log('--- CO-5 grey temperature ---');
const t = await greyTemperature(cleanPng);
console.log(`  meanHue=${t.meanHue === null ? 'none (pure neutral)' : t.meanHue.toFixed(1)}deg spread=${t.spread.toFixed(1)} n=${t.count}`);

console.log('--- CO-6 text contrast ---');
const c = await textContrast(cleanPng);
console.log(`  n=${c.n} p05=${c.p05.toFixed(2)} p50=${c.p50.toFixed(2)} p95=${c.p95.toFixed(2)}  (WCAG body text needs >= 4.5)`);

console.log('--- SP-2/3 spacing system (clean) ---');
const g = await verticalGaps(cleanPng, RENDER_SCALE);
const s = spacingSystem(g);
console.log(`  gaps(logical)=${g.map(x => x.toFixed(1)).join(',')}`);
console.log(`  fitted scale=${s.scale.join(',')} violations=${s.violations.length} ok=${s.ok}`);
if (s.violations.length) for (const v of s.violations.slice(0, 6)) console.log(`    ${v.a} -> ${v.b} ratio ${v.ratio} (< 1.25)`);

console.log('--- LV-5 radius cluster ---');
const r = await radiusCluster(cleanPng);
console.log(`  radii=${r.radii.join(',')} distinct=${r.distinct}`);

console.log('\n--- HAND CHECK: contrast of known colour pairs ---');
// Reasoned by hand from the WCAG formula:
//   white (#ffffff) on primary blue (#2563eb) should be comfortably above 4.5
//   white on accent green (#059669) likewise
//   muted grey (#6b7280) on panel (#f3f4f6) should be the weak pair
const white = [255, 255, 255];
const primary = [0x25, 0x63, 0xeb];
const accent = [0x05, 0x96, 0x69];
const muted = [0x6b, 0x72, 0x80];
const panel = [0xf3, 0xf4, 0xf6];
for (const [name, a, b] of [
  ['white on primary', white, primary],
  ['white on accent', white, accent],
  ['muted on panel', muted, panel],
]) {
  const cr = contrastRatio(a, b);
  console.log(`  ${name.padEnd(18)} rgb(${a}) on rgb(${b}) = ${cr.toFixed(2)}:1 ${cr >= 4.5 ? 'PASS' : 'FAIL'}`);
}

console.log('\n--- HAND CHECK: spacing measurement against a graded perturbation ---');
// By construction the spacing defect translates the block below the hero down by 14*mag
// logical px. At mag 1 that must appear as a gap roughly 14px larger than in the clean
// render, in the region below the hero. We assert the direction, not an exact value.
const spaced = await renderSpec(applyDefect(cleanSpec(), 'spacing', 1).spec, { scale: RENDER_SCALE });
const g2 = await verticalGaps(spaced, RENDER_SCALE);
const maxClean = Math.max(...g), maxSpaced = Math.max(...g2);
console.log(`  max gap clean=${maxClean.toFixed(1)}  spacing(mag=1)=${maxSpaced.toFixed(1)}  delta=${(maxSpaced - maxClean).toFixed(1)}`);
console.log(`  direction: ${maxSpaced > maxClean ? 'MATCHES hand expectation (larger gap)' : 'CONTRADICTS hand expectation'}`);

console.log('\n--- hand-derivable HSL check ---');
const hsl = rgbToHsl(primary);
console.log(`  primary rgb(${primary}) -> h=${hsl.h.toFixed(0)} s=${(hsl.s * 100).toFixed(0)}% l=${(hsl.l * 100).toFixed(0)}%`);
console.log(`  hand check: #2563eb is a blue, so h should be in [200,240] -> ${hsl.h >= 200 && hsl.h <= 240 ? 'MATCHES' : 'CONTRADICTS'}`);
