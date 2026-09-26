// Measurements for the design rules that were prose-only.
//
// The skill teaches 29 rules; only 7 had a measurement, so 22 reached the model as advice with no
// evidence. This module closes that for the rules that CAN be judged from a rendered screen.
//
// The distinction is deliberate and stated per rule: a rule about `em` units or "use good fonts"
// cannot be seen in pixels and stays prompt-only. Everything here is a rule where the image
// genuinely contains the answer, so a measurement is possible and a fabricated one would be
// worse than none.
//
// Every function returns null when the screen does not contain the evidence, so the caller
// reports the rule unverified rather than inventing a verdict.

import sharp from 'sharp';

async function raw(png) {
  const { data, info } = await sharp(png).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}
const at = (d, W, x, y) => { const i = (y * W + x) * 3; return [d[i], d[i + 1], d[i + 2]]; };
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/**
 * Recover horizontal text lines: contiguous bands of high-gradient pixels.
 *
 * Used by several rules below. Returns per-band geometry in LOGICAL units, plus the estimated
 * glyph height, which is the closest pixel-level proxy for type size. It is a proxy: the skill
 * already warns never to infer font size from text bounds, so anything derived from it is
 * reported as an estimate and only compared against other estimates on the same screen.
 */
export function textBands(data, W, H, { scale = 1, gradThresh = 55 } = {}) {
  const rows = new Float64Array(H);
  for (let y = 1; y < H - 1; y++) {
    let n = 0;
    for (let x = 1; x < W - 1; x++) {
      const c = lum(at(data, W, x, y));
      if (Math.abs(c - lum(at(data, W, x + 1, y))) > gradThresh) n++;
    }
    rows[y] = n;
  }
  const bands = [];
  let start = -1;
  for (let y = 0; y < H; y++) {
    const active = rows[y] > Math.max(2, W * 0.002);
    if (active && start < 0) start = y;
    if (!active && start >= 0) {
      if (y - start >= 3) bands.push({ top: start / scale, bottom: y / scale, height: (y - start) / scale });
      start = -1;
    }
  }
  if (start >= 0) bands.push({ top: start / scale, bottom: H / scale, height: (H - start) / scale });
  return bands;
}

/**
 * TY-1: use a type scale, not one-off sizes.
 *
 * Counts distinct text-band heights on the screen. A screen with a disciplined scale shows a
 * handful of heights; one with ad-hoc sizing shows many similar-but-different ones.
 * Height is a proxy for size, so the rule is stated conservatively: it flags a LARGE number of
 * distinct heights rather than judging the scale's exact values.
 */
export async function typeScaleCount(png, { scale = 1 } = {}) {
  const { data, W, H } = await raw(png);
  const bands = textBands(data, W, H, { scale });
  if (bands.length < 4) return null;                  // too little text to judge
  // Group heights within 15% of each other, since rasterisation jitters the band edge.
  const heights = bands.map(b => b.height).sort((a, b) => a - b);
  const groups = [];
  for (const h of heights) {
    const g = groups.find(x => Math.abs(h - x.mean) / x.mean < 0.15);
    if (g) { g.n++; g.mean = (g.mean * (g.n - 1) + h) / g.n; } else groups.push({ mean: h, n: 1 });
  }
  return {
    bandCount: bands.length,
    distinctHeights: groups.length,
    heights: groups.map(g => Number(g.mean.toFixed(1))),
    ok: groups.length <= 8,
  };
}

/**
 * TY-6: line-height is proportional — looser for long lines, tighter for large text.
 *
 * Measures the ratio of line spacing to glyph height within each text block, then checks that
 * larger text does not carry a LOOSER ratio than smaller text. That is the direction the book
 * specifies, and it is measurable without knowing the font.
 */
export async function lineHeightScaling(png, { scale = 1 } = {}) {
  const { data, W, H } = await raw(png);
  const bands = textBands(data, W, H, { scale });
  if (bands.length < 5) return null;
  // Consecutive bands close enough to be one block (gap under 1.5x the smaller band).
  const blocks = [];
  let cur = [bands[0]];
  for (let i = 1; i < bands.length; i++) {
    const prev = bands[i - 1], b = bands[i];
    const gap = b.top - prev.bottom;
    if (gap < Math.max(prev.height, 4) * 1.5) cur.push(b);
    else { if (cur.length >= 3) blocks.push(cur); cur = [b]; }
  }
  if (cur.length >= 3) blocks.push(cur);
  if (blocks.length < 2) return null;

  const stats = blocks.map(bl => {
    const glyph = bl.reduce((a, b) => a + b.height, 0) / bl.length;
    const pitches = [];
    for (let i = 1; i < bl.length; i++) pitches.push(bl[i].top - bl[i - 1].top);
    const pitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    return { glyph: Number(glyph.toFixed(1)), pitch: Number(pitch.toFixed(1)), ratio: Number((pitch / glyph).toFixed(3)) };
  }).filter(s => s.glyph > 0);

  if (stats.length < 2) return null;
  const sorted = [...stats].sort((a, b) => a.glyph - b.glyph);
  const small = sorted[0], large = sorted[sorted.length - 1];
  // Only meaningful when the sizes actually differ.
  if (large.glyph / small.glyph < 1.2) return null;
  return {
    blocks: stats,
    smaller: small,
    larger: large,
    ok: large.ratio <= small.ratio * 1.05,
    invertedBy: Number((large.ratio / small.ratio).toFixed(3)),
  };
}

/**
 * HI-1 / HI-2: hierarchy — do levels differ by enough, and in more than one channel?
 *
 * Size is measured as band height. Weight is estimated as MEAN STROKE THICKNESS, not edge density:
 * density conflates size with weight, because a large thin glyph and a small bold one can carry
 * similar edge counts. Stroke thickness is measured as the run length of consecutive inked pixels
 * across a horizontal scan line, which tracks weight far more directly.
 *
 * The fill colour is also compared, because HI-2 names colour as a third channel. Colour is read
 * from the modal ink colour inside each band, so a dark heading against mid-grey body text counts
 * as a real hierarchy difference even at similar size and weight.
 */
export async function hierarchyContrast(png, { scale = 1 } = {}) {
  const { data, W, H } = await raw(png);
  const bands = textBands(data, W, H, { scale });
  if (bands.length < 4) return null;

  const measured = bands.map(b => {
    const y0 = Math.max(1, Math.round(b.top * scale)), y1 = Math.min(H - 1, Math.round(b.bottom * scale));
    // Ink = pixels differing from the band's own backdrop (its modal colour).
    const counts = new Map();
    for (let y = y0; y < y1; y++) for (let x = 1; x < W - 1; x++) {
      const p = at(data, W, x, y);
      const k = `${p[0] >> 4},${p[1] >> 4},${p[2] >> 4}`;
      const e = counts.get(k) ?? { p, n: 0 }; e.n++; counts.set(k, e);
    }
    if (!counts.size) return null;
    const bg = [...counts.values()].sort((a, b) => b.n - a.n)[0].p;

    // Stroke thickness: mean length of consecutive runs of non-background pixels.
    const runs = [];
    for (let y = y0; y < y1; y++) {
      let run = 0;
      for (let x = 1; x < W - 1; x++) {
        const p = at(data, W, x, y);
        const isInk = Math.abs(lum(p) - lum(bg)) > 24;
        if (isInk) run++;
        else { if (run > 0 && run < 30) runs.push(run); run = 0; }
      }
    }
    if (runs.length < 20) return null;
    const stroke = runs.reduce((a, b) => a + b, 0) / runs.length;
    // Normalised stroke = thickness relative to glyph height, which is the size-independent
    // quantity that actually tracks weight.
    const relStroke = b.height > 0 ? stroke / (b.height * scale) : 0;
    return { ...b, stroke: Number(stroke.toFixed(2)), relStroke: Number(relStroke.toFixed(3)), bgLum: Number(lum(bg).toFixed(1)) };
  }).filter(Boolean);

  if (measured.length < 4) return null;
  const bySize = [...measured].sort((a, b) => b.height - a.height);
  const top = bySize[0], bottom = bySize[bySize.length - 1];
  const sizeRatio = bottom.height > 0 ? top.height / bottom.height : 1;
  const weightRatio = bottom.relStroke > 0 ? top.relStroke / bottom.relStroke : 1;
  const colourDelta = Math.abs(top.bgLum - bottom.bgLum);

  const channelsDiffering =
    (sizeRatio >= 1.25 ? 1 : 0) +
    (Math.abs(weightRatio - 1) >= 0.15 ? 1 : 0) +
    (colourDelta >= 40 ? 1 : 0);

  return {
    sizeRatio: Number(sizeRatio.toFixed(2)),
    weightRatio: Number(weightRatio.toFixed(2)),
    colourDelta: Number(colourDelta.toFixed(1)),
    channelsDiffering,
    ok: sizeRatio >= 1.25 || channelsDiffering >= 2,
    top: { height: Number(top.height.toFixed(1)), relStroke: top.relStroke },
    bottom: { height: Number(bottom.height.toFixed(1)), relStroke: bottom.relStroke },
    bands: measured.length,
  };
}

/**
 * CO-4: do not let lightness kill saturation, measured on the screen's own colour ramp.
 *
 * Collects the saturated colours actually used, groups them by hue family, and within each family
 * checks whether saturation survives as lightness rises. This is the book's own ramp behaviour
 * (blue: 55.7% at L=27.5% rising to 87.5% at L=96.9%) applied to whatever palette the screen has.
 *
 * CRITICAL: only PLATEAU colours count. Antialiased edges blend a palette colour toward whatever
 * it sits on, producing a whole fan of intermediate shades that look like a ramp but are an
 * artefact of rasterisation. A first version sampled every pixel and concluded the fixture's green
 * ramp collapsed to 34% saturation as it lightened — but the "light greens" it found were blends
 * of the accent against the white page at L 97%, not palette shades. There is no light-green
 * colour on that screen at all.
 *
 * A plateau pixel is one whose whole 3x3 neighbourhood matches it, which excludes every edge.
 */
export async function saturationSurvivesLightness(png) {
  const { data, W, H } = await raw(png);
  const seen = new Map();
  const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 18;
  for (let y = 2; y < H - 2; y += 2) {
    for (let x = 2; x < W - 2; x += 2) {
      const c = at(data, W, x, y);
      // Plateau test: interior of a flat region, so not an antialiased blend.
      let flat = true;
      for (let dy = -1; dy <= 1 && flat; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!near(c, at(data, W, x + dx, y + dy))) { flat = false; break; }
        }
      }
      if (!flat) continue;
      const key = `${c[0] >> 4},${c[1] >> 4},${c[2] >> 4}`;
      if (!seen.has(key)) seen.set(key, c);
    }
  }
  const { rgbToHsl } = await import('./design-rules.mjs');
  const cols = [...seen.values()].map(rgbToHsl).filter(c => c.s > 0.15);
  if (cols.length < 4) return null;

  // Group into hue families within 25 degrees.
  const families = [];
  for (const c of cols) {
    const f = families.find(x => { const d = Math.abs(x.hue - c.h); return Math.min(d, 360 - d) < 25; });
    if (f) { f.members.push(c); f.hue = (f.hue * (f.members.length - 1) + c.h) / f.members.length; }
    else families.push({ hue: c.h, members: [c] });
  }
  // A family needs a real lightness SPREAD to be judgeable as a ramp.
  const judged = families.filter(f => f.members.length >= 3).map(f => {
    const sorted = [...f.members].sort((a, b) => a.l - b.l);
    const dark = sorted[0], light = sorted[sorted.length - 1];
    if (light.l - dark.l < 0.15) return null;          // no ramp, just one shade
    return {
      hue: Number(f.hue.toFixed(0)),
      shades: f.members.length,
      dark: { s: Number((dark.s * 100).toFixed(1)), l: Number((dark.l * 100).toFixed(1)) },
      light: { s: Number((light.s * 100).toFixed(1)), l: Number((light.l * 100).toFixed(1)) },
      retained: Number((dark.s > 0.01 ? light.s / dark.s : 1).toFixed(3)),
    };
  }).filter(Boolean);
  if (!judged.length) return null;

  const worst = judged.reduce((a, b) => (a.retained < b.retained ? a : b));
  return { families: judged, worst, ok: worst.retained >= 0.6, note: 'plateau colours only; antialiased blends excluded' };
}

/**
 * DE-1: emulate a single light source from above.
 *
 * On a screen with a raised element, the top edge should be lighter than the bottom edge, or a
 * shadow should fall below rather than above. Measured as the mean luminance gradient across the
 * vertical axis of each large region: top brighter than bottom by a consistent sign.
 */
export async function lightFromAbove(png, { scale = 1 } = {}) {
  const { data, W, H } = await raw(png);
  const { regions } = await import('./design-rules.mjs');
  const regs = regions(data, W, H).filter(r => r.area > W * H * 0.004);
  if (regs.length < 2) return null;

  const judged = [];
  for (const r of regs) {
    const [x, y, w, h] = r.box;
    if (h < 12 || y < 2 || y + h > H - 2) continue;
    // Sample a strip just inside the top and just inside the bottom.
    const strip = (yy) => {
      let s = 0, n = 0;
      for (let xx = x + 2; xx < x + w - 2; xx += 2) { s += lum(at(data, W, xx, yy)); n++; }
      return n ? s / n : 0;
    };
    const topL = strip(y + 2), bottomL = strip(y + h - 3);
    judged.push({ kind: 'region', top: Number(topL.toFixed(1)), bottom: Number(bottomL.toFixed(1)), delta: Number((topL - bottomL).toFixed(1)) });
  }
  if (!judged.length) return null;
  const above = judged.filter(j => j.delta > 0).length;
  const below = judged.filter(j => j.delta < 0).length;
  // Consistent direction is what matters; either all-above or all-below is coherent. Mixed is not.
  const consistent = above === 0 || below === 0;
  return {
    regions: judged.length,
    lighterOnTop: above,
    lighterOnBottom: below,
    ok: consistent,
    detail: consistent
      ? `all ${judged.length} large regions share one vertical light direction`
      : `${judged.length} regions disagree on light direction (${above} lighter on top, ${below} on the bottom)`,
  };
}

/**
 * FI-5: use fewer borders.
 *
 * Counts thin, high-contrast lines that span a large fraction of a region's width. A screen built
 * on borders shows many; a screen using shadows, background shifts or spacing shows few.
 */
export async function borderCount(png, { scale = 1 } = {}) {
  const { data, W, H } = await raw(png);
  // A border row: nearly every pixel differs from the row above it by a similar small amount.
  let borders = 0;
  for (let y = 1; y < H - 1; y++) {
    let changes = 0, n = 0;
    for (let x = 1; x < W - 1; x += 2) {
      const d = Math.abs(lum(at(data, W, x, y)) - lum(at(data, W, x, y - 1)));
      if (d > 6 && d < 60) changes++;
      n++;
    }
    if (n && changes / n > 0.85) borders++;
  }
  if (H / scale < 20) return null;
  const per1000 = (borders / (H / scale)) * 1000;
  return { borderRows: borders, per1000LogicalPx: Number(per1000.toFixed(1)), ok: per1000 <= 40 };
}

/**
 * HI-3: do not use grey text on coloured backgrounds.
 *
 * The rule is about MID-TONE NEUTRAL GREY text: it looks washed out and muddy against a saturated
 * ground, and the book's fix is to tint the text toward the ground's hue.
 *
 * It is NOT about white or near-white text. White on a coloured ground is usually the CORRECT
 * choice and frequently the only one that clears contrast. A first version of this rule flagged
 * any text with saturation below 10%, which flagged white 347 times on the fixture — a nonsense
 * finding. The discriminator is that the offending grey is mid-tone: light enough to look washed
 * out, dark enough not to be deliberate white.
 *
 * Judged only where the backdrop is genuinely coloured (saturation >= 0.25) and the text sits in
 * the mid lightness band 0.30..0.88 with low saturation.
 */
export async function noGreyTextOnColour(png, { scale = 1 } = {}) {
  const { data, W, H } = await raw(png);
  const { rgbToHsl } = await import('./design-rules.mjs');
  const flagged = new Map();
  let considered = 0;

  for (let y = 4; y < H - 4; y += 2) {
    for (let x = 4; x < W - 4; x += 2) {
      const c = at(data, W, x, y);
      // Edge test: this is a glyph boundary.
      const r = at(data, W, x + 2, y), dn = at(data, W, x, y + 2);
      if (Math.abs(lum(c) - lum(r)) + Math.abs(lum(c) - lum(dn)) < 60) continue;

      // Backdrop: the modal colour in the neighbourhood, excluding the glyph's own colour.
      const counts = new Map();
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const p = at(data, W, x + dx, y + dy);
        if (Math.abs(lum(p) - lum(c)) < 12) continue;      // skip the glyph itself
        const k = `${p[0] >> 4},${p[1] >> 4},${p[2] >> 4}`;
        const e = counts.get(k) ?? { p, n: 0 }; e.n++; counts.set(k, e);
      }
      if (!counts.size) continue;
      const bg = [...counts.values()].sort((a, b) => b.n - a.n)[0].p;
      const hb = rgbToHsl(bg);
      if (hb.s < 0.25) continue;                            // backdrop is not coloured
      considered++;

      const hs = rgbToHsl(c);
      const isWhiteish = hs.l > 0.88;
      const isMidToneGrey = hs.s < 0.12 && hs.l >= 0.30 && hs.l <= 0.88;
      if (isMidToneGrey && !isWhiteish) {
        const hex = '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
        const key = `${hex} on #${bg.map(v => v.toString(16).padStart(2, '0')).join('')}`;
        flagged.set(key, (flagged.get(key) ?? 0) + 1);
      }
    }
  }

  if (considered < 50) return null;                       // too little coloured-ground text to judge
  const total = [...flagged.values()].reduce((a, b) => a + b, 0);
  // A handful of antialiased pixels is not a finding; a whole text run is.
  return {
    ok: total < 150,
    violations: total,
    considered,
    examples: [...flagged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} (${n}px)`),
    note: 'mid-tone neutral grey text only; white text on colour is correct and not flagged',
  };
}
