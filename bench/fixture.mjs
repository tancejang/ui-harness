// Synthetic UI fixture renderer for the held-out UI defect benchmark.
//
// A fixture is a declarative list of primitives. We rasterize it with sharp so that
// every pixel is a pure function of the spec. Perturbations then mutate the spec by a
// known defect class, which becomes the held-out ground-truth label.
//
// Design rule: nothing in here may tell the judge what the label is. The judge only ever
// sees (reference pixels, candidate pixels).

import sharp from 'sharp';

/**
 * The fixture palette.
 *
 * `accent` and `muted` are deliberately one step darker than the obvious Tailwind picks
 * (#059669 / #6b7280). The grounded design review flagged CO-6 on this screen — Refactoring UI
 * p.163 requires 4.5:1 for body text — and measurement showed white-on-accent at 3.77:1 and
 * muted-on-panel at 4.39:1, both failing. The replacements keep the hue (accent 163deg vs 161,
 * muted 215deg vs 220) and clear the bar at 5.48:1 and 5.12:1, which is what the book means by
 * "accessible doesn't have to mean ugly": darken the colour, do not desaturate it into grey.
 *
 * Verified by bench/find-accessible-palette.mjs and asserted in bench/design-rules-figures.mjs.
 */
export const PALETTE = {
  bg: '#ffffff',
  ink: '#111827',
  muted: '#5f6875',    // was #6b7280 — 4.39:1, failed CO-6
  primary: '#2563eb',
  accent: '#047857',   // was #059669 — 3.77:1, failed CO-6
  warn: '#d97706',
  danger: '#dc2626',
  panel: '#f3f4f6',
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A rectangle. `opacity` is emitted with full precision as `fill-opacity`, which is how paint
 * defects carry continuous severity — SVG colour channels get rounded by the rasterizer, but
 * compositing opacity does not. See probe-svg-color.mjs.
 */
function rect(x, y, w, h, fill, r = 0, opacity = null) {
  const op = opacity === null ? '' : ` fill-opacity="${opacity}"`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${r}"${op}/>`;
}

function text(x, y, size, fill, body, anchor = 'start', weight = 400) {
  return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(body)}</text>`;
}

/**
 * Build the canonical "clean" UI spec. All coordinates are absolute pixels in a
 * W x H canvas. Kept deliberately geometric so measurements are stable.
 */
export function cleanSpec(W = 480, H = 720) {
  const m = 32;                       // page margin
  const cw = W - m * 2;               // content width
  const prims = [];

  // Header band
  prims.push({ kind: 'header-band', box: [m, m, cw, 96], fill: PALETTE.primary });
  prims.push({ kind: 'header-text', box: [m + 20, m + 44, 200, 28], text: 'Dashboard', size: 26, fill: '#ffffff', weight: 700 });

  // Two stat cards side by side
  const gap = 16;
  const sw = Math.floor((cw - gap) / 2);
  const sy = m + 96 + 24;
  prims.push({ kind: 'stat-card', box: [m, sy, sw, 104], fill: PALETTE.panel });
  prims.push({ kind: 'stat-label', box: [m + 16, sy + 34, sw - 32, 16], text: 'Revenue', size: 14, fill: PALETTE.muted });
  prims.push({ kind: 'stat-value', box: [m + 16, sy + 66, sw - 32, 28], text: '$12,480', size: 24, fill: PALETTE.ink, weight: 700 });

  prims.push({ kind: 'stat-card', box: [m + sw + gap, sy, sw, 104], fill: PALETTE.panel });
  prims.push({ kind: 'stat-label', box: [m + sw + gap + 16, sy + 34, sw - 32, 16], text: 'Orders', size: 14, fill: PALETTE.muted });
  prims.push({ kind: 'stat-value', box: [m + sw + gap + 16, sy + 66, sw - 32, 28], text: '1,204', size: 24, fill: PALETTE.ink, weight: 700 });

  // Hero panel
  const hy = sy + 104 + 24;
  prims.push({ kind: 'hero-panel', box: [m, hy, cw, 152], fill: PALETTE.accent });
  prims.push({ kind: 'hero-text', box: [m + 20, hy + 62, cw - 40, 24], text: 'Weekly summary', size: 20, fill: '#ffffff', weight: 600 });
  prims.push({ kind: 'hero-sub', box: [m + 20, hy + 96, cw - 40, 18], text: 'All channels performing within range', size: 14, fill: '#ffffff' });

  // Two action buttons.
  //
  // The vertical gaps below use 32, not 28. The fixture originally used 28 in both places, and
  // 28 is not on Refactoring UI's spacing scale — a fact only discoverable once the book's
  // figures were extracted, because the prose states the 25% rule of thumb but never names the
  // scale. `bench/design-rules-figures.mjs` flags off-scale gaps, and it flagged these two.
  // See docs/reference/README.md.
  const by = hy + 152 + 32;
  const bw = 152, bh = 48;
  prims.push({ kind: 'button-primary', box: [m, by, bw, bh], fill: PALETTE.primary, text: 'Export', size: 16, fill: '#ffffff', weight: 600 });
  prims.push({ kind: 'button-secondary', box: [m + bw + 16, by, bw, bh], fill: PALETTE.panel, text: 'Share', size: 16, fill: PALETTE.ink, weight: 600 });

  // List rows.
  //
  // Row pitch is 48, not 64. Moving the block above down to the on-scale 32px gap pushed the
  // final row 4px past the 720px canvas, and the unit test "cleanSpec is deterministic and
  // self-consistent" caught it. The fix follows Refactoring UI's own advice for a dense list
  // (p.69, "dense UIs have their place") rather than shaving a value off the scale: 48 is a
  // legitimate step.
  //
  // ROW_H is 48 rather than 40 so the content ends exactly 32px above the canvas floor. A 40px
  // row left a 38px trailing margin, which is off the book's scale — the figure-sourced checker
  // caught that too. The page now closes on a scale value at both ends.
  const ly = by + bh + 32;
  const ROW_PITCH = 48, ROW_H = 48;
  for (let i = 0; i < 3; i++) {
    const ry = ly + i * ROW_PITCH;
    prims.push({ kind: `row-${i}`, box: [m, ry, cw, ROW_H], fill: PALETTE.panel });
    prims.push({ kind: `row-text-${i}`, box: [m + 16, ry + 30, cw - 200, 16], text: `Transaction ${i + 1}`, size: 15, fill: PALETTE.ink });
    prims.push({ kind: `row-amount-${i}`, box: [m + cw - 140, ry + 30, 124, 16], text: `$${(i + 1) * 37}.00`, size: 15, fill: PALETTE.muted, anchor: 'end' });
  }

  return { W, H, prims };
}

/**
 * Rasterize a spec to a PNG buffer.
 *
 * `scale` renders the SVG at `scale`x the logical canvas size. This exists to defeat
 * coordinate quantization: the perturbations move panels by fractional logical pixels
 * (e.g. 18 * 0.06 = 1.08), and rasterizing 1:1 would collapse every magnitude in a band
 * into the same handful of integer offsets, so distinct test cases would render to
 * byte-identical images. At scale 4 a 0.06-magnitude displacement is a real ~4px shift.
 *
 * The returned PNG is scale x larger than the logical canvas. Callers that compare two
 * images must use the same scale; the judge only ever compares like with like.
 */
export async function renderSpec(spec, { scale = 1 } = {}) {
  const parts = [rect(0, 0, spec.W, spec.H, PALETTE.bg)];
  const overlays = [];
  for (const p of spec.prims) {
    const [x, y, w, h] = p.box;
    if (p.kind.endsWith('-band') || p.kind.includes('card') || p.kind.includes('panel') || p.kind.startsWith('button') || p.kind.startsWith('row-')) {
      parts.push(rect(x, y, w, h, p.fill, p.kind.startsWith('button') ? 8 : 6));
    }
    if (p.text !== undefined) {
      const anchor = p.anchor ?? 'start';
      const tx = anchor === 'end' ? x + w : anchor === 'middle' ? x + w / 2 : x;
      // Vertically centre the text inside its declared box.
      const ty = y + h / 2 + p.size * 0.35;
      parts.push(text(tx, ty, p.size, p.fill, p.text, anchor, p.weight ?? 400));
    }
    // A paint defect is carried by an alpha-composited overlay rather than a computed colour
    // string: opacity is preserved at higher precision than SVG colour channels, which is what
    // keeps every magnitude in the band rendering to a distinct image. See probe-svg-color.mjs.
    if (p.overlay) {
      overlays.push(rect(x, y, w, h, p.overlay.fill, 0, p.overlay.opacity));
    }
  }
  const W = Math.round(spec.W * scale), H = Math.round(spec.H * scale);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${spec.W} ${spec.H}">${parts.join('')}${overlays.join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Default supersample factor for benchmark rendering. */
export const RENDER_SCALE = 4;

// ---------------------------------------------------------------------------
// Perturbations. Each returns {spec, label} where label is the held-out truth.
// Exactly ONE dominant defect class is injected per case.
// ---------------------------------------------------------------------------

const DEFECTS = ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean'];

function clone(spec) {
  return { W: spec.W, H: spec.H, prims: spec.prims.map(p => ({ ...p, box: [...p.box] })) };
}

function find(spec, kind) {
  return spec.prims.filter(p => p.kind === kind);
}

const shift = (p, dx, dy) => { p.box[0] += dx; p.box[1] += dy; };

/**
 * Perturbations deliberately do NOT round their displacements.
 *
 * Rounding to integer logical pixels collapsed an entire magnitude band into the same
 * handful of offsets: at the eval band, round(18 * mag) is only ever 1 or 2, so 24
 * declared cases rendered to 7 distinct images and per-class variety was 1. Fractional
 * coordinates are preserved so that supersampled rendering (renderSpec {scale}) turns
 * every magnitude into a genuinely different image.
 */

/** geometry defect: the hero panel is mispositioned as a rigid block. */
function perturbGeometry(spec, mag) {
  const s = clone(spec);
  const dx = 18 * mag, dy = 14 * mag;
  for (const kind of ['hero-panel', 'hero-text', 'hero-sub']) for (const p of find(s, kind)) shift(p, dx, dy);
  return { spec: s, label: 'geometry' };
}

/** typography defect: glyphs are re-rastered at a different size, in place. */
function perturbTypography(spec, mag) {
  const s = clone(spec);
  const shrink = (kind, k) => { for (const p of find(s, kind)) p.size = p.size * (1 - k * mag); };
  shrink('header-text', 0.30);
  shrink('stat-value', 0.35);
  shrink('hero-text', 0.30);
  shrink('row-text-0', 0.25);
  return { spec: s, label: 'typography' };
}

/** spacing defect: the block below the hero is translated vertically. */
function perturbSpacing(spec, mag) {
  const s = clone(spec);
  const delta = 14 * mag;
  const y0 = s.prims.find(p => p.kind === 'button-primary').box[1];
  for (const p of s.prims) if (p.box[1] >= y0) shift(p, 0, delta);
  return { spec: s, label: 'spacing' };
}

/** Mix two hex colours; t=0 -> a, t=1 -> b. Returns a float RGB triple, not a rounded hex. */
function mixRGB(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  // Deliberately NOT rounded. Rounding to 8-bit is what quantized the paint defects: the eval
  // band is narrow, so several distinct magnitudes rounded to the SAME hex and rendered
  // byte-identical PNGs. A critic measured only 15 distinct images for `color` across the
  // whole band — invariant to RENDER_SCALE, because the loss happened in hex, not in pixels.
  return pa.map((v, i) => v + (pb[i] - v) * t);
}

/** Format a float RGB triple for an SVG fill. rgb() carries fractional channels through. */
function rgbFill([r, g, b]) {
  const c = v => Math.min(255, Math.max(0, v));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

/** Mix two hex colours, returning an SVG-ready colour string. */
function mix(a, b, t) {
  return rgbFill(mixRGB(a, b, t));
}

/**
 * Rotate a hex colour's hue by `deg`, keeping saturation and value, and return an
 * SVG-ready colour string.
 *
 * Two deliberate details:
 *  - Segment lookup is clamped rather than computed with a bare `% 6`. Floating point can put
 *    `h` a hair outside [0, 360), and `Math.floor(h/60)` can then index off the end of the
 *    array and throw. Clamping makes the function total.
 *  - Channels are emitted as fractional `rgb()` values, NOT rounded to hex. Rounding destroyed
 *    the resolution of small rotations: the eval band maps onto ~8 units of 8-bit RGB, so
 *    several distinct magnitudes collapsed onto the same hex and rendered identical PNGs.
 */
function rotateHue(hex, deg) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h;
  if (d === 0) h = 0;
  else if (mx === r) h = (((g - b) / d) % 6 + 6) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + deg) % 360;
  if (h < 0) h += 360;
  if (!Number.isFinite(h)) h = 0;
  const s = mx === 0 ? 0 : d / mx;
  const c = mx * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = mx - c;
  const seg = Math.min(5, Math.max(0, Math.floor(h / 60)));
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  return rgbFill(rgb.map(v => (v + m) * 255));
}

/**
 * Paint defects use ALPHA COMPOSITING, not computed colour strings.
 *
 * This is the resolution-critical decision in this file. The paint defects must produce many
 * distinct renders across the narrow eval band (mag 0.03..0.06), and two earlier approaches
 * failed to:
 *
 *   - rounding a mixed colour to hex  -> 15 distinct renders across the whole band
 *   - emitting fractional `rgb(...)` -> still 15, because sharp's SVG rasterizer rounds
 *     colour channels to integers regardless of the decimals it is given
 *
 * Measured probe (bench/probe-svg-color.mjs, 20 fine-grained samples):
 *   fractional rgb() channel         3/20 distinct
 *   integer rgb() channel            3/20 distinct
 *   fill-opacity over a solid fill  14/20 distinct   <-- the only mechanism that works
 *   gradient stop with float rgb     2/20 distinct
 *
 * So a defect is expressed as a base fill plus an overlay whose OPACITY is the continuous
 * severity. Alpha compositing is evaluated at higher precision than channel rounding, which
 * is exactly what preserves the gradient.
 */

/**
 * color defect: the large panels take on a different HUE — the palette is wrong, not washed
 * out. Orthogonal to `imagery`: the panel's saturation is preserved.
 *
 * Hue rotation is inherently a *colour-string* operation, and SVG colour channels are rounded
 * by the rasterizer, so a direct rotation can only reach as many distinct colours as the
 * 8-bit channel grid allows (~23 of 48 samples across this narrow band).
 *
 * The fix keeps the rotation but interpolates CONTINUOUSLY between two adjacent rotation
 * steps using an alpha-composited overlay: the base panel takes the lower rotation, and an
 * overlay of the next rotation is composited at the fractional opacity between them. Because
 * both endpoints share the same saturation, the blend stays on (very nearly) the same
 * saturation ramp — which is exactly the property the judge tests — while opacity carries the
 * sub-step resolution that colour channels cannot.
 */
const HUE_STEP_DEG = 2;               // granularity of the discrete rotation ladder

function perturbColor(spec, mag) {
  const s = clone(spec);
  const totalDeg = 300 * Math.min(1, mag);
  const lo = Math.floor(totalDeg / HUE_STEP_DEG) * HUE_STEP_DEG;
  const frac = (totalDeg - lo) / HUE_STEP_DEG;
  for (const p of find(s, 'hero-panel')) {
    p.fill = rotateHue(PALETTE.accent, lo);
    p.overlay = frac > 1e-6
      ? { fill: rotateHue(PALETTE.accent, lo + HUE_STEP_DEG), opacity: frac }
      : null;
  }
  for (const p of find(s, 'stat-card')) {
    p.fill = mix(PALETTE.panel, rotateHue(PALETTE.panel, lo), 0.5);
  }
  return { spec: s, label: 'color' };
}

/**
 * imagery defect: the artwork is progressively washed out — colour drains toward the page
 * background as if the asset failed to load. Orthogonal to `color`: saturation collapses
 * while the little hue that remains stays put.
 *
 * Expressed as a pale overlay whose OPACITY carries the severity. Two things matter here:
 *
 *  1. Opacity, not colour, because the SVG rasterizer rounds colour channels but composites
 *     alpha at higher precision (see probe notes in the commit that introduced this).
 *  2. The GAIN has to be large enough that the band's opacity span is wide in absolute terms.
 *     With a gain of 8 the band `[0.015, 0.0195]` only spanned opacity 0.120..0.156 — 0.036 of
 *     the range, i.e. about nine 8-bit compositing levels — and 80 fine samples collapsed to 33
 *     distinct renders. The gain is now set so the top of the band lands near 0.75, giving the
 *     band a span of roughly 0.19 and comfortably more resolution than the sample counts used.
 *
 * The overlay is the pale page colour, so a fully-opaque overlay means "the panel has become
 * the background", which is exactly the failed-to-load semantics.
 */
const IMAGERY_GAIN = 48;

function perturbImagery(spec, mag) {
  const s = clone(spec);
  const t = Math.min(0.985, mag * IMAGERY_GAIN);
  for (const p of find(s, 'hero-panel')) p.overlay = { fill: '#f8fafc', opacity: t };
  for (const p of find(s, 'hero-text')) p.overlay = { fill: '#f8fafc', opacity: t };
  for (const p of find(s, 'hero-sub')) p.overlay = { fill: '#f8fafc', opacity: t };
  return { spec: s, label: 'imagery' };
}

const PERTURBERS = {
  geometry: perturbGeometry,
  typography: perturbTypography,
  spacing: perturbSpacing,
  color: perturbColor,
  imagery: perturbImagery,
};

/**
 * Generate the full case set. Deterministic: same seed -> same cases.
 * `mag` in [0.5, 1] controls defect severity (used to build an extreme split too).
 */
export function generateCases(seed = 1) {
  const base = cleanSpec();
  const cases = [];
  let n = 0;
  const rand = (() => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();

  // Interleave classes so any prefix of the list is roughly class-balanced.
  const plan = [];
  for (const d of DEFECTS) plan.push(d);
  for (let rep = 0; rep < 3; rep++) for (const d of DEFECTS) plan.push(d);

  for (const defect of plan) {
    n++;
    const mag = defect === 'clean' ? 0 : 0.75 + rand() * 0.25;
    let spec, label;
    if (defect === 'clean') { spec = clone(base); label = 'clean'; }
    else ({ spec, label } = PERTURBERS[defect](base, mag));
    cases.push({ id: `case-${String(n).padStart(3, '0')}`, label, defect, mag: Number(mag.toFixed(3)), spec });
  }
  return { W: base.W, H: base.H, cases };
}

export { DEFECTS, clone, find, shift, PERTURBERS };

/**
 * Apply one defect to a spec. Single source of truth shared by run.mjs, controls.mjs
 * and difficulty.mjs — earlier these each carried their own divergent copy, which is
 * how the eval band silently stopped matching the thing being measured.
 */
export function applyDefect(base, cls, mag) {
  if (cls === 'clean') return { spec: clone(base), label: 'clean' };
  const fn = PERTURBERS[cls];
  if (!fn) throw new Error(`unknown defect class: ${cls}`);
  return fn(base, mag);
}
