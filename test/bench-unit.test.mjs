// Unit tests for the benchmark's measurement layer.
//
// These cover the parts that were previously exercised only indirectly, through the
// benchmark and its controls. Several assertions encode bugs that were actually shipped
// and found by critics, so a regression is caught here rather than in a score change.
//
// Run: node --test test/bench-unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';

import { cleanSpec, renderSpec, applyDefect, clone, RENDER_SCALE } from '../bench/fixture.mjs';
import { measurePair, decide, classify } from '../bench/judge.mjs';
import {
  contrastRatio, rgbToHsl, spacingSystem, verticalGaps, greyTemperature,
} from '../bench/design-rules.mjs';

const scale = RENDER_SCALE;
const refPng = await renderSpec(cleanSpec(), { scale });

const sharpMeta = buf => sharp(buf).metadata();
const hash = buf => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- fixture

test('cleanSpec is deterministic and self-consistent', () => {
  const a = cleanSpec(), b = cleanSpec();
  assert.deepEqual(a, b);
  assert.ok(a.prims.length > 10);
  // Every primitive's box must lie inside the canvas.
  for (const p of a.prims) {
    const [x, y, w, h] = p.box;
    assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0, `bad box for ${p.kind}`);
    assert.ok(x + w <= a.W && y + h <= a.H, `${p.kind} escapes the canvas`);
  }
});

test('clone produces an independent copy', () => {
  const a = cleanSpec();
  const b = clone(a);
  b.prims[0].box[0] += 100;
  b.prims[1].size = 999;
  assert.notEqual(a.prims[0].box[0], b.prims[0].box[0]);
  assert.notEqual(a.prims[1].size, b.prims[1].size);
});

test('renderSpec honours the supersample scale', async () => {
  const one = await renderSpec(cleanSpec(), { scale: 1 });
  const four = await renderSpec(cleanSpec(), { scale: 4 });
  const meta1 = await sharpMeta(one), meta4 = await sharpMeta(four);
  assert.equal(meta1.width, cleanSpec().W);
  assert.equal(meta4.width, cleanSpec().W * 4);
  assert.equal(meta4.height, cleanSpec().H * 4);
});

test('renderSpec is deterministic for the same spec and scale', async () => {
  const a = await renderSpec(cleanSpec(), { scale });
  const b = await renderSpec(cleanSpec(), { scale });
  assert.equal(hash(a), hash(b));
});

test('applyDefect is deterministic and rejects unknown classes', () => {
  const a = applyDefect(cleanSpec(), 'geometry', 0.5);
  const b = applyDefect(cleanSpec(), 'geometry', 0.5);
  assert.deepEqual(a.spec, b.spec);
  assert.equal(a.label, 'geometry');
  assert.equal(applyDefect(cleanSpec(), 'clean', 0).label, 'clean');
  assert.throws(() => applyDefect(cleanSpec(), 'nonsense', 1), /unknown defect class/);
});

/**
 * REGRESSION: coordinate quantization.
 * The original eval split used Math.round on every displacement, so an entire magnitude
 * band collapsed into a handful of identical images (24 declared cases -> 7 distinct).
 *
 * A later critic found the SAME defect surviving in the paint classes by a different route:
 * mixed colours were rounded to 8-bit hex, so `color` produced only 15 distinct images across
 * the whole band and `imagery` 16 — invariant to RENDER_SCALE, because the loss happened in
 * colour, not in pixels. Sampling 12 points with a `>= 10` bar let that pass at 12/12 while
 * the true ceiling was 15.
 *
 * This test therefore samples enough points to exceed the old ceiling and demands that nearly
 * all of them be unique, so a re-quantization cannot hide behind a low bar.
 */
test('REGRESSION: the eval band renders distinct images per class', async () => {
  const band = [0.03, 0.06];
  const N = 48;
  for (const cls of ['geometry', 'typography', 'spacing', 'color', 'imagery']) {
    const seen = new Set();
    for (let i = 0; i < N; i++) {
      const mag = band[0] + (i / (N - 1)) * (band[1] - band[0]);
      seen.add(hash(await renderSpec(applyDefect(cleanSpec(), cls, mag).spec, { scale })));
    }
    // 90% unique. The old hex-quantized implementation scored 15/48 and 16/48 here and fails.
    const minUnique = Math.floor(N * 0.9);
    assert.ok(seen.size >= minUnique,
      `${cls} produced only ${seen.size}/${N} distinct renders (need >= ${minUnique}) — the band is quantized`);
  }
});

/**
 * The paint defects carry severity through alpha compositing, not through computed colour
 * strings, because sharp's SVG rasterizer rounds colour channels but does not round opacity.
 * This pins that mechanism: if someone reverts to hex/`rgb()` mixing, the resolution test
 * above fails, and this one explains why.
 */
test('paint defects carry severity as composited opacity, not as a rounded colour', async () => {
  const a = applyDefect(cleanSpec(), 'imagery', 0.030).spec;
  const b = applyDefect(cleanSpec(), 'imagery', 0.034).spec;
  const panel = s => s.prims.find(p => p.kind === 'hero-panel');
  assert.ok(panel(a).overlay, 'imagery should emit an overlay for continuous severity');
  assert.notEqual(panel(a).overlay.opacity, panel(b).overlay.opacity);
  // And those distinct opacities must survive rendering.
  const pa = await renderSpec(a, { scale });
  const pb = await renderSpec(b, { scale });
  assert.notEqual(hash(pa), hash(pb), 'distinct severities must render to distinct images');
});

/**
 * REGRESSION: rotateHue threw on float error at a hue segment boundary because it used a
 * bare `% 6` as an array index. Sweeping angles must never throw.
 */
test('REGRESSION: rotateHue never throws across a full hue sweep', async () => {
  for (const cls of ['color']) {
    for (let i = 0; i <= 40; i++) {
      const mag = i / 40;
      await assert.doesNotReject(
        renderSpec(applyDefect(cleanSpec(), cls, mag).spec, { scale: 1 }),
        `color at mag ${mag} threw`,
      );
    }
  }
});

// ---------------------------------------------------------------- judge

test('identical renders measure as zero difference and classify clean', async () => {
  const m = await measurePair(refPng, refPng);
  assert.equal(m.geoEnergy, 0);
  assert.equal(m.changedRows, 0);
  assert.equal(m.fracTop, 0);
  assert.equal(m.fracMid, 0);
  assert.equal(m.fracBot, 0);
  const d = decide(m);
  assert.equal(d.label, 'clean');
});

test('classify is a pure function of the two buffers', async () => {
  const png = await renderSpec(applyDefect(cleanSpec(), 'geometry', 0.5).spec, { scale });
  const a = await classify(refPng, png);
  const b = await classify(refPng, png);
  assert.deepEqual(a.label, b.label);
  assert.deepEqual(a.reason, b.reason);
});

/**
 * REGRESSION: the hue estimate used a 10-degree histogram mode, which quantized small
 * rotations to exactly 0 and sent subtle colour defects to the geometric rules.
 * A continuous circular mean must resolve sub-degree rotation.
 */
test('REGRESSION: hue measurement resolves sub-10-degree rotation', async () => {
  const small = applyDefect(cleanSpec(), 'color', 0.02).spec;
  const m = await measurePair(refPng, await renderSpec(small, { scale }));
  assert.ok(m.dHue > 0.5, `expected a resolvable hue rotation, got ${m.dHue}`);
  assert.ok(Number.isFinite(m.dHue));
});

test('measurePair rejects size mismatches instead of guessing', async () => {
  const small = await renderSpec(cleanSpec(), { scale: 1 });
  await assert.rejects(measurePair(refPng, small), /size mismatch/);
});

/**
 * Each defect class must be separable at a severity well inside the eval band, and the
 * classification must be the class that was actually injected.
 */
test('each defect class is correctly classified across the eval band', async () => {
  const band = [0.03, 0.06];
  for (const cls of ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean']) {
    for (let i = 0; i <= 4; i++) {
      const mag = band[0] + (i / 4) * (band[1] - band[0]);
      const { spec, label } = applyDefect(cleanSpec(), cls, mag);
      const d = await classify(refPng, await renderSpec(spec, { scale }));
      assert.equal(d.label, label, `${cls} at mag ${mag.toFixed(3)} -> ${d.label} (${d.reason})`);
    }
  }
});

test('decide() is auditable: every verdict carries a reason and features', async () => {
  for (const cls of ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean']) {
    const spec = applyDefect(cleanSpec(), cls, 0.05).spec;
    const d = await classify(refPng, await renderSpec(spec, { scale }));
    assert.equal(typeof d.reason, 'string');
    assert.ok(d.reason.trim().length > 0);
    assert.equal(typeof d.confidence, 'number');
    assert.ok(d.confidence > 0 && d.confidence <= 1);
    assert.ok(d.features && typeof d.features === 'object');
  }
});

/**
 * REGRESSION: the typography rules must not claim a displaced panel at low severity.
 *
 * A critic swept changedRows/geoEnergy over 79 magnitudes and found the `ratio > 50` cut sits
 * INSIDE the geometry range below the eval band: typography's ratio collapses to 0 once the
 * glyph change is sub-pixel (no row changes at all), while geometry keeps moving whole panels
 * and its ratio climbs to 73.6. The rules therefore carry two preconditions — the text band
 * must actually have churned (>= 24 rows) and the difference must be measurable at all
 * (geoEnergy >= 0.6). Without them a small panel displacement is read as a font change.
 *
 * The assertions below encode the real detection floor rather than a wish:
 *   mag >= 0.012  (>= 0.22px displacement)  -> must be `geometry`
 *   mag <  0.012  (sub-pixel)               -> must NOT be a wrong defect class; `clean` is
 *                                              the honest answer for an invisible edit
 */
test('REGRESSION: low-severity geometry is never misread as typography', async () => {
  for (const mag of [0.012, 0.015, 0.020, 0.030, 0.045]) {
    const { spec } = applyDefect(cleanSpec(), 'geometry', mag);
    const d = await classify(refPng, await renderSpec(spec, { scale }));
    assert.equal(d.label, 'geometry', `geometry at mag ${mag} was read as ${d.label} :: ${d.reason}`);
  }
  for (const mag of [0.008, 0.010]) {
    const { spec } = applyDefect(cleanSpec(), 'geometry', mag);
    const d = await classify(refPng, await renderSpec(spec, { scale }));
    assert.ok(d.label === 'clean' || d.label === 'geometry',
      `sub-pixel geometry at mag ${mag} was read as ${d.label}, which is a wrong defect class :: ${d.reason}`);
  }
});

// ---------------------------------------------------------------- design rules

test('contrastRatio matches hand-derived WCAG values', () => {
  const white = [255, 255, 255];
  // Derived by hand from the WCAG relative-luminance formula.
  assert.ok(Math.abs(contrastRatio(white, [0x25, 0x63, 0xeb]) - 5.17) < 0.02);
  assert.ok(Math.abs(contrastRatio(white, [0x05, 0x96, 0x69]) - 3.77) < 0.02);
  assert.ok(Math.abs(contrastRatio([0x6b, 0x72, 0x80], [0xf3, 0xf4, 0xf6]) - 4.39) < 0.02);
  // Identical colours have no contrast.
  assert.equal(contrastRatio(white, white), 1);
});

test('contrastRatio is symmetric', () => {
  const a = [0x25, 0x63, 0xeb], b = [0xf3, 0xf4, 0xf6];
  assert.equal(contrastRatio(a, b), contrastRatio(b, a));
});

test('rgbToHsl places known colours in the right hue sector', () => {
  assert.ok(Math.abs(rgbToHsl([0x25, 0x63, 0xeb]).h - 221) < 1.5);   // blue
  assert.ok(Math.abs(rgbToHsl([0xdc, 0x26, 0x26]).h - 0) < 1.5);      // red
  assert.ok(Math.abs(rgbToHsl([0x05, 0x96, 0x69]).h - 161) < 2);      // green
  // A pure grey has no hue.
  assert.equal(rgbToHsl([128, 128, 128]).s, 0);
});

test('spacingSystem flags adjacent steps closer than 25%', () => {
  const ok = spacingSystem([16, 24, 40, 64]);
  assert.equal(ok.ok, true);
  const bad = spacingSystem([24, 28, 32]);
  assert.equal(bad.ok, false);
  assert.equal(bad.violations.length, 2);
  assert.ok(bad.violations.every(v => v.ratio < 1.25));
});

test('verticalGaps measures a known synthetic pattern', async () => {
  // Build a spec with two bars separated by an exact, known gap.
  const spec = { W: 100, H: 100, prims: [
    { kind: 'row-a', box: [10, 10, 80, 10], fill: '#000000' },
    { kind: 'row-b', box: [10, 40, 80, 10], fill: '#000000' },
  ] };
  const png = await renderSpec(spec, { scale: 1 });
  const gaps = await verticalGaps(png, 1);
  // The gap between the bars is 20px; it must appear in the measured list.
  assert.ok(gaps.some(g => Math.abs(g - 20) <= 1), `expected a ~20px gap, got ${gaps.join(',')}`);
});

test('greyTemperature finds the fixture greys are cool, matching their real hue', async () => {
  // The fixture greys are Tailwind "cool gray": #f3f4f6, #6b7280 and #111827 are all hue 220.
  // The measurement must report that rather than a neutral 0.
  const t = await greyTemperature(refPng);
  assert.ok(t.count > 100, `too few grey samples: ${t.count}`);
  assert.ok(Math.abs(t.meanHue - 220) < 6, `expected ~220deg, got ${t.meanHue}`);
  assert.ok(t.spread < 5, `greys should be consistent, spread=${t.spread}`);
});
