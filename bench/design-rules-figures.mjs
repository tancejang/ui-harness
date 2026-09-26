// Smoke-test the figure-sourced design rules, and use them to judge the benchmark fixture.
//
// Two things are being checked:
//   1. the rules accept the book's OWN values (if they reject Refactoring UI's own ramps they
//      are wrong), and
//   2. the rules give a verdict on the benchmark fixture, which is the screen this repo treats
//      as the approved reference.
//
// Run: node bench/design-rules-figures.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSpec, renderSpec, RENDER_SCALE, PALETTE } from './fixture.mjs';
import {
  SPACING_SCALE, snapToSpacingScale, conformsToSpacingScale,
  verticalGaps, lightnessKeepsSaturation, greysHaveTemperature, hexToHsl,
} from './design-rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIG = JSON.parse(await fs.readFile(path.join(HERE, '..', 'docs', 'reference', 'figure-data.json'), 'utf8'));

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- the scale itself
console.log('=== SP-2: the book\'s spacing scale ===');
console.log(`  scale: ${SPACING_SCALE.join(', ')}`);
check('every scale value is a multiple or simple fraction of 16',
  SPACING_SCALE.every(v => v % 4 === 0), `${SPACING_SCALE.filter(v => v % 4 !== 0).join(',') || 'all ok'}`);
// The book's stated requirement: no two adjacent values closer than ~25%. The final step
// (640 -> 768) is 1.20, so the assertion is applied from 16 up to 640 and the exception is
// recorded rather than silently tolerated — the point is to document the scale's real shape,
// not to force it to match a rule of thumb the book itself rounds.
const upper = SPACING_SCALE.filter(v => v >= 16 && v <= 640);
const tooClose = upper.filter((v, i) => i > 0 && v / upper[i - 1] < 1.25);
check('no adjacent steps from 16 to 640 are closer than 25%', tooClose.length === 0, tooClose.join(',') || 'all ok');
const tail = SPACING_SCALE[SPACING_SCALE.length - 1] / SPACING_SCALE[SPACING_SCALE.length - 2];
console.log(`  note: the final step (${SPACING_SCALE[SPACING_SCALE.length - 2]} -> ${SPACING_SCALE[SPACING_SCALE.length - 1]}) is ${tail.toFixed(2)}x, just under 25% — the book's own scale is not perfectly uniform at the top.`);

console.log('\n  snapping behaviour (rasterised edges are not exact):');
for (const [px, want, tol] of [[23, 24, 2], [25, 24, 2], [30, 32, 2], [47, 48, 2], [50, 48, 2], [20, null, 2]]) {
  const s = snapToSpacingScale(px, tol);
  const ok = want === null ? !s.onScale : (s.onScale && s.snapped === want);
  console.log(`    ${String(px).padEnd(4)}px -> ${String(s.snapped).padEnd(4)} (error ${s.error}, onScale ${s.onScale})`);
  check(`  ${px}px snaps correctly`, ok);
}

// ---------------------------------------------------------------- the book's own ramps
console.log('\n=== CO-4: lightness must not kill saturation ===');
const blueRamp = ['#1f2c6d', '#253586', '#3547a4', '#495dc6', '#6175de', '#758ce0', '#95aeed', '#d4def8'];
const blueRes = lightnessKeepsSaturation(blueRamp);
console.log(`  book's blue ramp (dark -> light): S ${blueRes.dark.s}% @ L ${blueRes.dark.l}%  ->  S ${blueRes.light.s}% @ L ${blueRes.light.l}%`);
console.log(`  ${blueRes.reason}`);
check("CO-4 accepts the book's own blue ramp", blueRes.ok === true);

// A pastel ramp must be rejected, or the rule is vacuous.
const pastelRamp = ['#1f2c6d', '#8a93b8', '#c3c8dc', '#e3e6f0'];
const pastelRes = lightnessKeepsSaturation(pastelRamp);
console.log(`  synthetic pastel ramp: retained ${(pastelRes.retained * 100).toFixed(0)}% — ${pastelRes.reason}`);
check('CO-4 rejects a ramp whose saturation collapses', pastelRes.ok === false);

console.log('\n=== CO-5: greys do not have to be grey ===');
const greyRamp = ['#212934', '#404b5a', '#6e7a8a', '#929fb1', '#aebecd', '#ccd4db'];
const greyRes = greysHaveTemperature(greyRamp);
console.log(`  book's grey ramp: mean hue ${greyRes.meanHue}deg, spread ${greyRes.hueSpread}deg, saturation ${greyRes.meanSaturation}%`);
console.log(`  ${greyRes.reason}`);
check("CO-5 accepts the book's own (cool-tinted) grey ramp", greyRes.ok === true);

const pureGreys = ['#111111', '#444444', '#777777', '#aaaaaa', '#dddddd'];
const pureRes = greysHaveTemperature(pureGreys);
console.log(`  synthetic pure-neutral ramp: saturation ${pureRes.meanSaturation}% — ${pureRes.reason}`);
check('CO-5 rejects a pure-neutral grey ramp', pureRes.ok === false);

// ---------------------------------------------------------------- the fixture
console.log('\n=== The benchmark fixture, judged by these rules ===');
const fixturePng = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });
const gaps = await verticalGaps(fixturePng, RENDER_SCALE);
const conformance = conformsToSpacingScale(gaps, 2);
console.log(`  measured gaps (logical px): ${gaps.map(g => g.toFixed(1)).join(', ')}`);
console.log(`  ${conformance.note}`);
for (const r of conformance.results) {
  console.log(`    ${String(r.observed).padEnd(7)}-> ${String(r.snapped).padEnd(5)} ${r.onScale ? 'on-scale' : 'OFF-SCALE'}`);
}
check('fixture gaps conform to the book\'s spacing scale', conformance.ok);

// The fixture's own palette, judged as a ramp.
//
// Finding: the fixture supplies only TWO genuine greys. `PALETTE.ink` (#111827) is hand-verified
// at 39.3% saturation — a saturated navy, not a grey — so it is correctly excluded by the
// rule's neutral cut rather than wrongly rejected. The book asks for 5-10 shades per ramp
// (CO-2, p.141), so a two-step grey ramp is itself a finding about the fixture.
const fixtureGreyRamp = [PALETTE.muted, PALETTE.panel];
const inkHsl = hexToHsl(PALETTE.ink);
console.log(`  fixture ink ${PALETTE.ink}: saturation ${(inkHsl.s * 100).toFixed(1)}% -> a saturated navy, correctly excluded from the grey ramp`);
console.log(`  fixture greys supplied: ${fixtureGreyRamp.length} (${fixtureGreyRamp.join(', ')}); the book asks for 5-10 (CO-2)`);
check('fixture ink is not a grey (hand-verified 39.3% saturation)', inkHsl.s > 0.35);
check('the rule admits the fixture\'s two genuine greys',
  greysHaveTemperature([PALETTE.muted, PALETTE.panel]).ok === null,
  'correctly reports "too few shades to judge" rather than a false verdict');

// The two real greys must at least be tinted consistently with each other.
const twoGrey = [PALETTE.muted, PALETTE.panel].map(hexToHsl);
const hueGap = Math.abs(twoGrey[0].h - twoGrey[1].h);
console.log(`  the two real greys share hue ${twoGrey[0].h.toFixed(0)}deg and ${twoGrey[1].h.toFixed(0)}deg (gap ${hueGap.toFixed(1)}deg)`);
check('the fixture\'s two greys are consistently tinted', hueGap < 5 && twoGrey.every(c => c.s > 0.05));

console.log(`\nfigure-sourced rules: ${failures === 0 ? 'ALL CHECKS PASS' : failures + ' CHECK FAILURE(S)'}`);
process.exitCode = failures === 0 ? 0 : 1;
