// Design-rule measurements over a rendered screen
//
// The rubric in docs/DESIGN-RUBRIC.md marks rules `[MEASURABLE]`. This module is where
// that claim is cashed out: each function here computes one of those measurements from
// actual pixels, so a design finding can cite a number rather than an opinion.
//
// Scope note: this operates on a rendered PNG with a known palette-driven layout. It
// recovers structure by colour region segmentation, not by reading the source spec, so
// it would also run against a real screenshot of a similar screen.

import sharp from 'sharp';

async function raw(png) {
  const { data, info } = await sharp(png).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}

const at = (d, W, x, y) => { const i = (y * W + x) * 3; return [d[i], d[i + 1], d[i + 2]]; };
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h *= 60;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

/** WCAG relative-luminance contrast ratio. */
export function contrastRatio(a, b) {
  const rel = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const la = rel(a), lb = rel(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Segment the image into flat-colour regions by quantising each pixel and grouping
 * 4-connected runs of the same quantised colour. Returns regions sorted by area.
 */
function regions(d, W, H, q = 12) {
  const key = i => `${Math.round(d[i] / q)},${Math.round(d[i + 1] / q)},${Math.round(d[i + 2] / q)}`;
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let y0 = 0; y0 < H; y0++) {
    for (let x0 = 0; x0 < W; x0++) {
      const p0 = y0 * W + x0;
      if (seen[p0]) continue;
      const target = key(p0 * 3);
      // Scanline flood fill (BFS on a stack) for this flat-colour region.
      const stack = [[x0, y0]];
      seen[p0] = 1;
      let minX = x0, maxX = x0, minY = y0, maxY = y0, area = 0;
      let sr = 0, sg = 0, sb = 0;
      while (stack.length) {
        const [x, y] = stack.pop();
        const i = (y * W + x) * 3;
        sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; area++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx;
          if (seen[np]) continue;
          if (key(np * 3) !== target) continue;
          seen[np] = 1;
          stack.push([nx, ny]);
        }
      }
      out.push({ area, box: [minX, minY, maxX - minX + 1, maxY - minY + 1], rgb: [sr / area, sg / area, sb / area] });
    }
  }
  return out.sort((a, b) => b.area - a.area);
}

/** Fraction of the region's box that is actually filled (vs. holes/text carved out). */
function fillRatio(r) {
  const [,, w, h] = r.box;
  return r.area / (w * h);
}

/**
 * CO-2: a complete screen needs a grey ramp, not two greys.
 * Counts distinct low-saturation colours with meaningful area.
 */
export async function greyRampCount(png) {
  const { data, W, H } = await raw(png);
  const buckets = new Set();
  for (let i = 0; i < data.length; i += 3 * 11) {
    const { s } = rgbToHsl([data[i], data[i + 1], data[i + 2]]);
    if (s < 0.12) buckets.add(Math.round(lum([data[i], data[i + 1], data[i + 2]]) / 16));
  }
  return buckets.size;
}

/**
 * CO-5: greys don't have to be grey — measure the hue offset of near-neutral colours.
 *
 * Antialiased edges borrow hue from whatever they sit against, so sampling every
 * semi-desaturated pixel reports the accent colour's hue rather than the grey ramp's
 * temperature. We therefore only sample pixels that sit in the INTERIOR of a flat region
 * (all four neighbours nearly identical), which excludes edges by construction.
 */
export async function greyTemperature(png) {
  const { data, W, H } = await raw(png);
  const hues = [];
  const step = 3;
  for (let y = step; y < H - step; y += 2) {
    for (let x = step; x < W - step; x += 2) {
      const c = at(data, W, x, y);
      // Interior test: all 4 neighbours within a tight tolerance of this pixel.
      const nb = [at(data, W, x + step, y), at(data, W, x - step, y), at(data, W, x, y + step), at(data, W, x, y - step)];
      if (nb.some(p => Math.abs(lum(p) - lum(c)) > 3)) continue;
      const { h, s } = rgbToHsl(c);
      if (s > 0.02 && s < 0.16) hues.push(h);
    }
  }
  if (!hues.length) return { meanHue: null, spread: 0, count: 0 };
  const mean = hues.reduce((a, b) => a + b, 0) / hues.length;
  const spread = Math.sqrt(hues.reduce((a, b) => a + (b - mean) ** 2, 0) / hues.length);
  return { meanHue: mean, spread, count: hues.length };
}

/**
 * CO-6: contrast of small text against its own backdrop.
 *
 * IMPORTANT — this must NOT be measured on edge pixels. A first version sampled every
 * high-gradient pixel and took a low percentile, which measures ANTIALIASING rather than
 * legibility: the blend colours between glyph and background (`#b2c8f8` between white text and
 * a blue band) necessarily sit at ~2:1 against both sides, so the rule failed on screens whose
 * every declared colour pair passed. Diagnosed in bench/diagnose-contrast.mjs.
 *
 * The correct statistic is the contrast between the two PLATEAU colours meeting at an edge —
 * the text's own colour and the background's own colour — because those are what a reader
 * actually looks at. We therefore:
 *   1. find high-gradient pixels (an edge),
 *   2. take the darkest and lightest colours in a small neighbourhood,
 *   3. require that neighbourhood to be bimodal, i.e. the two extremes are far apart and few
 *      pixels sit in between. Blend-heavy neighbourhoods are skipped.
 *
 * Returns the distribution over qualifying edges.
 */
export async function textContrast(png, minEdgeGap = 40) {
  const { data, W, H } = await raw(png);
  const ratios = [];
  const pairColours = new Map();
  for (let y = 3; y < H - 3; y += 2) {
    for (let x = 3; x < W - 3; x += 2) {
      const c = at(data, W, x, y);
      const r = at(data, W, x + 2, y), dn = at(data, W, x, y + 2);
      const grad = Math.abs(lum(c) - lum(r)) + Math.abs(lum(c) - lum(dn));
      if (grad < 60) continue;                       // not an edge

      // Sample the neighbourhood and find its two extreme luminances.
      const near = [];
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) near.push(at(data, W, x + dx, y + dy));
      near.sort((a, b) => lum(a) - lum(b));
      const dark = near[0], light = near[near.length - 1];
      const gap = lum(light) - lum(dark);
      if (gap < minEdgeGap) continue;                // not a real text/background boundary

      // Bimodality: count how many samples sit in the middle third of the range.
      const lo = lum(dark), hi = lum(light);
      const mid = near.filter(p => { const l = lum(p); return l > lo + gap / 3 && l < hi - gap / 3; }).length;
      if (mid > near.length * 0.45) continue;        // blend-heavy: antialiasing, not a plateau edge

      ratios.push(contrastRatio(dark, light));
      pairColours.set(`#${dark.map(v => v.toString(16).padStart(2, '0')).join('')}/#${light.map(v => v.toString(16).padStart(2, '0')).join('')}`, true);
    }
  }
  ratios.sort((a, b) => a - b);
  const pct = p => ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))] : 0;
  return { n: ratios.length, p05: pct(0.05), p50: pct(0.5), p95: pct(0.95), pairColours: [...pairColours.keys()] };
}

/**
 * SP-5: within-group gaps must be strictly smaller than between-group gaps.
 * Recovers horizontal bands of content and measures the empty runs between them.
 * Returns the sorted vertical gap list, in logical pixels (divided by `scale`).
 */
export async function verticalGaps(png, scale = 1) {
  const { data, W, H } = await raw(png);
  const rowInk = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) {
      const c = at(data, W, x, y);
      const bg = at(data, W, 1, y);
      s += Math.abs(lum(c) - lum(bg));
    }
    rowInk[y] = s / W;
  }
  const thr = 2.0;
  const gaps = [];
  let run = 0;
  for (let y = 0; y < H; y++) {
    if (rowInk[y] <= thr) run++;
    else { if (run > 0) gaps.push(run / scale); run = 0; }
  }
  if (run > 0) gaps.push(run / scale);
  return gaps;
}

/**
 * SP-2/SP-3: does the observed spacing cluster on a scale whose adjacent values
 * differ by >= 25%? Returns the fitted scale and the offending pairs.
 */
export function spacingSystem(gaps, minRatio = 1.25) {
  const uniq = [...new Set(gaps.filter(g => g >= 4).map(g => Math.round(g)))].sort((a, b) => a - b);
  const violations = [];
  for (let i = 1; i < uniq.length; i++) {
    const ratio = uniq[i] / uniq[i - 1];
    if (ratio < minRatio) violations.push({ a: uniq[i - 1], b: uniq[i], ratio: Number(ratio.toFixed(3)) });
  }
  return { scale: uniq, violations, ok: violations.length === 0 };
}

// ---------------------------------------------------------------------------
// Sourced knowledge from Refactoring UI's figures.
//
// The rules below are testable ONLY because the book's figures were extracted and sampled.
// The prose says "no two values closer than ~25%" without naming the scale, and "you need
// 5-10 shades" without saying which. The figures print the scale and the ramps; those numbers
// live in docs/reference/figure-data.json and are reproduced here so the code is self-contained
// and auditable.
// ---------------------------------------------------------------------------

/**
 * SP-2, the real scale (Refactoring UI p.73).
 *
 * The book's own spacing/sizing scale. Every value is a multiple or simple fraction of 16.
 * Unlike a bare "adjacent values differ by 25%" test, this says WHICH values are legitimate,
 * so a screen using 20px and 28px is caught even though those differ from their neighbours
 * by more than 25%.
 */
export const SPACING_SCALE = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 640, 768];

/**
 * Snap a measured gap onto the book's scale and report the residual.
 * `tolerance` is absolute px: rasterised edges are not exact, so a gap of 23 is a 24.
 */
export function snapToSpacingScale(px, tolerance = 2) {
  let best = null, bestErr = Infinity;
  for (const v of SPACING_SCALE) {
    const err = Math.abs(px - v);
    if (err < bestErr) { bestErr = err; best = v; }
  }
  return { snapped: best, error: Number(bestErr.toFixed(2)), onScale: bestErr <= tolerance };
}

/**
 * SP-2 as the book states it: do the observed gaps land ON the scale?
 *
 * Returns the per-gap verdicts and an overall pass. Gaps below the scale's floor are ignored —
 * a 1-2px hairline is not a spacing decision.
 */
export function conformsToSpacingScale(gaps, tolerance = 2) {
  const considered = gaps.filter(g => g >= SPACING_SCALE[0]);
  const results = considered.map(g => ({ observed: Number(g.toFixed(2)), ...snapToSpacingScale(g, tolerance) }));
  const off = results.filter(r => !r.onScale);
  return {
    considered: considered.length,
    results,
    offScale: off,
    ok: off.length === 0,
    note: off.length === 0
      ? `every measured gap snaps onto the book's scale within ${tolerance}px`
      : `${off.length}/${considered.length} gaps are off-scale: ${off.map(o => `${o.observed}->${o.snapped} (${o.error}px)`).join(', ')}`,
  };
}

/** HSL of a hex string, for the ramp rules. */
export function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s, l };
}

/**
 * CO-4: "Don't let lightness kill your saturation" (Refactoring UI pp.151-153).
 *
 * Measured on the book's own blue ramp: as lightness rises from 27.5% to 96.9%, saturation
 * RISES from 55.7% to 87.5% — it never collapses. A ramp that turns pastel as it lightens
 * violates the rule.
 *
 * `hexes` should be ordered dark to light. The test compares the saturation of the lightest
 * real shade against the darkest: the light end must retain a meaningful fraction of it.
 */
export function lightnessKeepsSaturation(hexes, minRetained = 0.6) {
  const hsl = hexes.map(hexToHsl).filter(c => c.l > 0.05 && c.l < 0.98);
  if (hsl.length < 3) return { ok: null, reason: 'need at least 3 usable shades' };
  const sorted = [...hsl].sort((a, b) => a.l - b.l);
  const dark = sorted[0], light = sorted[sorted.length - 1];
  const retained = dark.s > 0.01 ? light.s / dark.s : 1;
  return {
    ok: retained >= minRetained,
    dark: { s: Number((dark.s * 100).toFixed(1)), l: Number((dark.l * 100).toFixed(1)) },
    light: { s: Number((light.s * 100).toFixed(1)), l: Number((light.l * 100).toFixed(1)) },
    retained: Number(retained.toFixed(3)),
    reason: retained >= minRetained
      ? `the light end keeps ${(retained * 100).toFixed(0)}% of the dark end's saturation`
      : `saturation collapses to ${(retained * 100).toFixed(0)}% as the ramp lightens, so lightness is killing it`,
  };
}

/**
 * CO-5: "Greys don't have to be grey" (Refactoring UI pp.157-159).
 *
 * Measured on the book's own grey ramp: every step holds a cool hue of ~207-215 degrees and
 * never a neutral 0. A ramp of pure #808080-family greys violates the rule.
 *
 * The rule is about the GREY ramp, so only low-saturation colours are considered. The cut is
 * generous (0.35) because tinted greys like Tailwind's slate family reach ~0.25 saturation;
 * anything above that is a colour, not a grey, and is excluded rather than judged.
 */
export function greysHaveTemperature(hexes, minSaturation = 0.05, neutralCut = 0.35) {
  const neutrals = hexes.map(hexToHsl).filter(c => c.s < neutralCut);
  if (neutrals.length < 3) {
    return { ok: null, reason: `only ${neutrals.length} of ${hexes.length} colours are neutral enough to be a grey ramp (need 3+)` };
  }
  const hues = neutrals.map(c => c.h);
  const mean = hues.reduce((a, b) => a + b, 0) / hues.length;
  const spread = Math.sqrt(hues.reduce((a, b) => a + (b - mean) ** 2, 0) / hues.length);
  const meanSat = neutrals.reduce((a, c) => a + c.s, 0) / neutrals.length;
  return {
    ok: meanSat >= minSaturation && spread < 20,
    meanHue: Number(mean.toFixed(1)),
    hueSpread: Number(spread.toFixed(1)),
    meanSaturation: Number((meanSat * 100).toFixed(1)),
    considered: neutrals.length,
    reason: meanSat < minSaturation
      ? `greys are effectively neutral (mean saturation ${(meanSat * 100).toFixed(1)}%), not tinted`
      : spread >= 20
        ? `greys are tinted but inconsistent (hue spread ${spread.toFixed(1)}deg)`
        : `greys share a consistent ${mean.toFixed(0)}deg temperature at ${(meanSat * 100).toFixed(1)}% saturation`,
  };
}

/**
 * LV-5: corner radii should cluster on a bounded set.
 *
 * For each substantial flat region we walk along its top edge and count how far in from the
 * left edge the region's own fill colour first appears. On a rounded rectangle the corner is
 * cut away, so the fill starts `radius` pixels in; on a square corner it starts at 0.
 *
 * The earlier version compared the top-edge pixel to the region mean and broke out on the
 * first background pixel, which always fired immediately and reported every radius as 0.
 */
export async function radiusCluster(png) {
  const { data, W, H } = await raw(png);
  const regs = regions(data, W, H).filter(r => r.area > W * H * 0.002 && fillRatio(r) > 0.5);
  const radii = [];
  for (const r of regs) {
    const [x, y, w] = r.box;
    // Skip regions that are clipped by the canvas edge (their corner is not visible).
    if (x <= 0 || y <= 0) { radii.push(null); continue; }
    let cut = 0;
    const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 24;
    for (let dx = 0; dx < Math.min(w, 48); dx++) {
      if (near(at(data, W, x + dx, y + 1), r.rgb)) { cut = dx; break; }
      cut = dx + 1;
    }
    radii.push(cut);
  }
  const visible = radii.filter(v => v !== null);
  return { radii: visible, skipped: radii.length - visible.length, distinct: [...new Set(visible)].length };
}

export { rgbToHsl, lum, raw, regions };
