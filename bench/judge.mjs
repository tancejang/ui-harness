// Non-circular pixel judge for the UI defect benchmark.
//
// CONTRACT: `classify(referencePng, candidatePng)` receives ONLY two PNG buffers.
// It is never told the defect label, the perturbation name, or the case id.
// Every decision is derived from measurements taken on the actual pixels.
//
// The six classes are decided by a small decision tree over four independent,
// physically-motivated measurements:
//
//   dGeo   structural displacement of the largest changed region (centroid shift)
//   dText  change in "text mass" = count of high-frequency edge pixels in text bands
//   dGap   change in the number of empty horizontal bands (row-gap structure)
//   dHue   change in the dominant hue of large flat regions, plus region count change
//   dInk   change in ink coverage inside the hero region (blanked vs. filled)
//
// Circularity check: nothing in this file reads the generator, the labels, or the
// case list. It would give the same answer for a photograph pair.

import sharp from 'sharp';

const W_HINT = 480;

async function toRaw(png) {
  return sharp(png).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

function luminance(data, i) {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/** Per-row difference energy between two images. */
function rowEnergy(a, b, W, H) {
  const rows = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    const base = y * W * 3;
    for (let x = 0; x < W; x++) {
      const i = base + x * 3;
      s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    }
    rows[y] = s / (W * 3);
  }
  return rows;
}

/** Per-column difference energy. */
function colEnergy(a, b, W, H) {
  const cols = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 3;
      s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    }
    cols[x] = s / (H * 3);
  }
  return cols;
}

/** Number of distinct horizontal "bands" separated by near-empty rows. */
function bandStructure(rows, thresh) {
  const active = [];
  for (let y = 0; y < rows.length; y++) active.push(rows[y] > thresh ? 1 : 0);
  let bands = 0, inBand = false;
  for (const a of active) {
    if (a && !inBand) { bands++; inBand = true; }
    else if (!a) inBand = false;
  }
  return bands;
}

/** Count of "text-like" pixels: strong local luminance gradient, dark-ish. */
function textMass(data, W, H, region) {
  let count = 0;
  const [x0, y0, x1, y1] = region;
  for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) {
      const i = (y * W + x) * 3;
      const c = luminance(data, i);
      const r = luminance(data, i + 3);
      const d = luminance(data, i + W * 3);
      if (Math.abs(c - r) > 60 || Math.abs(c - d) > 60) count++;
    }
  }
  return count;
}

/**
 * Dominant hue over saturated pixels, as a CIRCULAR MEAN.
 *
 * The previous implementation histogrammed hue into 10-degree bins and returned the modal
 * bin's centre. That quantises the answer: a hue rotation smaller than half a bin reads as
 * exactly zero, which is why subtle `color` defects (mag <= 0.05) fell through to the
 * geometric rules and were misreported as `geometry`.
 *
 * Averaging angles needs circular statistics — a plain arithmetic mean of 350deg and 10deg
 * gives 180deg, the opposite of the truth. We accumulate unit vectors on the colour circle
 * and take atan2 of the sums, which is exact and continuous.
 *
 * Returns { hue, concentration, n } where concentration = |R| in [0,1]. Low concentration
 * means the pixels have no single well-defined hue (e.g. a multi-hue screen), so callers
 * should not trust `hue` when concentration is small.
 */
function dominantHue(data, W, H) {
  let sx = 0, sy = 0, wsum = 0, n = 0;
  for (let i = 0; i < data.length; i += 3 * 7) { // stride-sample; deterministic
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (sat < 0.25 || mx < 0.15) continue; // near-grey / near-black -> no hue
    let h;
    const d = mx - mn;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    const rad = h * Math.PI / 180;
    // Weight by saturation so strongly coloured pixels dominate the mean, and so a few
    // lightly tinted antialiased pixels cannot drag the estimate.
    const w = sat;
    sx += Math.cos(rad) * w;
    sy += Math.sin(rad) * w;
    wsum += w;
    n++;
  }
  if (n === 0 || wsum === 0) return { hue: -1, concentration: 0, n: 0 };
  const cx = sx / wsum, cy = sy / wsum;
  let hue = Math.atan2(cy, cx) * 180 / Math.PI;
  if (hue < 0) hue += 360;
  return { hue, concentration: Math.hypot(cx, cy), n };
}

/** Mean colour of a rectangular region. */
function meanRGB(data, W, x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 3;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

/**
 * Saturation of the LARGEST FLAT REGION that lies inside a box.
 *
 * Sampling statistics over a fixed box is the wrong way to ask "is this panel still
 * colourful": the box contains white text over the panel, and the mean of those two is a pale
 * blend unrelated to the panel's own colour. A per-pixel mode over the same box is also wrong
 * — the mode is the background, not the panel.
 *
 * What we want is the panel's own fill, so we segment: flood-fill the box into flat-colour
 * regions and take the colour of the largest one that is big enough to be structural rather
 * than text. This is the same technique `bench/design-rules.mjs` uses for region work.
 *
 * Returns { rgb, saturation, hue, area, coverage } for that region, or null if none qualifies.
 */
function largestFlatRegion(data, W, x0, y0, x1, y1, q = 12, minFrac = 0.15) {
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return null;
  const key = (x, y) => {
    const i = (y * W + x) * 3;
    return `${Math.round(data[i] / q)},${Math.round(data[i + 1] / q)},${Math.round(data[i + 2] / q)}`;
  };
  const seen = new Uint8Array(bw * bh);
  const minArea = bw * bh * minFrac;
  let best = null;
  for (let ly = 0; ly < bh; ly++) {
    for (let lx = 0; lx < bw; lx++) {
      const p = ly * bw + lx;
      if (seen[p]) continue;
      const target = key(x0 + lx, y0 + ly);
      const stack = [[lx, ly]];
      seen[p] = 1;
      let area = 0, sr = 0, sg = 0, sb = 0;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        const i = ((y0 + cy) * W + (x0 + cx)) * 3;
        sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; area++;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const np = ny * bw + nx;
          if (seen[np]) continue;
          if (key(x0 + nx, y0 + ny) !== target) continue;
          seen[np] = 1;
          stack.push([nx, ny]);
        }
      }
      if (area >= minArea && (!best || area > best.area)) {
        best = { rgb: [sr / area, sg / area, sb / area], area };
      }
    }
  }
  if (!best) return null;
  const [r, g, b] = best.rgb;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const saturation = mx === 0 ? 0 : d / mx;
  let hue = -1;
  if (d > 0) {
    let h;
    if (mx === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    hue = h * 60;
  }
  return { rgb: best.rgb, saturation, hue, area: best.area, coverage: best.area / (bw * bh) };
}

/**
 * Extract the measurement vector. Exported so the harness can print it and so a
 * human can hand-check a case.
 */
export async function measurePair(referencePng, candidatePng) {
  const A = await toRaw(referencePng);
  const B = await toRaw(candidatePng);
  if (A.info.width !== B.info.width || A.info.height !== B.info.height) {
    throw new Error(`size mismatch ${A.info.width}x${A.info.height} vs ${B.info.width}x${B.info.height}`);
  }
  const W = A.info.width, H = A.info.height;

  const rows = rowEnergy(A.data, B.data, W, H);
  const cols = colEnergy(A.data, B.data, W, H);

  // Structural displacement: centroid of difference energy.
  let sx = 0, sy = 0, tot = 0;
  for (let y = 0; y < H; y++) { sy += rows[y] * y; tot += rows[y]; }
  for (let x = 0; x < W; x++) sx += cols[x] * x;
  const cy = tot > 0 ? sy / tot : H / 2;
  const cx = tot > 0 ? sx / tot : W / 2;

  // Where is the difference concentrated? Split the canvas into thirds vertically.
  const third = H / 3;
  let eTop = 0, eMid = 0, eBot = 0;
  for (let y = 0; y < H; y++) {
    if (y < third) eTop += rows[y];
    else if (y < third * 2) eMid += rows[y];
    else eBot += rows[y];
  }
  const eAll = eTop + eMid + eBot || 1;

  // Text mass inside the header + stat + hero bands vs. the reference.
  const textRegion = [0, 0, W, Math.min(H, Math.round(H * 0.62))];
  const tA = textMass(A.data, W, H, textRegion);
  const tB = textMass(B.data, W, H, textRegion);
  const dText = tA > 0 ? (tB - tA) / tA : 0;

  // Row-gap structure: number of separated change bands, and total changed area.
  const bandsA = bandStructure(rows, 6);
  let changedRows = 0;
  for (const r of rows) if (r > 6) changedRows++;

  // Hue + large-region colour.
  const hA = dominantHue(A.data, W, H);
  const hB = dominantHue(B.data, W, H);
  let dHue = -1;
  if (hA.hue >= 0 && hB.hue >= 0) {
    dHue = Math.abs(hA.hue - hB.hue);
    if (dHue > 180) dHue = 360 - dHue;
  }

  // Hero band colour statistics, measured on the panel's OWN FILL.
  //
  // Both `mA`/`mB` (mean over the box) and a per-pixel mode over the box are wrong here: the
  // box contains white text over a saturated panel plus surrounding background, so the mean is
  // a pale blend and the mode is the background. Neither reports whether the PANEL still has
  // colour. We therefore segment the box and take the largest flat region's own colour.
  //
  // Fallback: if no region is large enough to be structural (e.g. a heavily fragmented hero),
  // we fall back to the box mean so the code degrades rather than reporting a meaningless zero.
  const heroY0 = Math.round(H * 0.26), heroY1 = Math.round(H * 0.47);
  const heroX0 = Math.round(W * 0.07), heroX1 = Math.round(W * 0.93);
  const mA = meanRGB(A.data, W, heroX0, heroY0, heroX1, heroY1);
  const mB = meanRGB(B.data, W, heroX0, heroY0, heroX1, heroY1);
  const satOf = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
  const regA = largestFlatRegion(A.data, W, heroX0, heroY0, heroX1, heroY1);
  const regB = largestFlatRegion(B.data, W, heroX0, heroY0, heroX1, heroY1);
  const satA = regA ? regA.saturation : satOf(mA);
  const satB = regB ? regB.saturation : satOf(mB);
  const lumA = 0.299 * mA[0] + 0.587 * mA[1] + 0.114 * mA[2];
  const lumB = 0.299 * mB[0] + 0.587 * mB[1] + 0.114 * mB[2];
  const dSat = satA - satB;                    // positive => colour drained
  const dLum = lumB - lumA;                    // positive => got brighter (blanked to white)
  const panelCoverage = regA ? regA.coverage : 0;

  // Colour shift of the hero region (Euclidean in RGB).
  const dHero = Math.hypot(mA[0] - mB[0], mA[1] - mB[1], mA[2] - mB[2]);

  // Geometry vs spacing discriminator: spacing moves a *contiguous lower block* while
  // leaving its internal structure intact -> changes concentrate low, band count roughly
  // stable. Geometry moves a *middle panel* -> energy concentrates mid, and the
  // displaced panel lands on top of neighbours producing extra bands.
  const fracTop = eTop / eAll, fracMid = eMid / eAll, fracBot = eBot / eAll;

  // Text-scale discriminator: typography keeps geometry, so row/col energy stays low
  // while text mass changes a lot.
  const geoEnergy = (rows.reduce((a, b2) => a + b2, 0) / H) + (cols.reduce((a, b2) => a + b2, 0) / W);

  return {
    W, H, cx, cy,
    fracTop, fracMid, fracBot,
    dText, bandsA, changedRows,
    hueA: hA.hue, hueB: hB.hue, dHue, satA, satB, dSat, dLum, dHero, panelCoverage,
    panelAreaA: regA ? regA.area : 0, panelAreaB: regB ? regB.area : 0,
    geoEnergy,
    textA: tA, textB: tB,
  };
}

/**
 * Classify from the measurement vector alone. Hand-auditable decision tree.
 * Returns {label, confidence, reason, features}.
 */
export function decide(m) {
  const {
    fracTop, fracMid, fracBot, dText, bandsA, changedRows,
    dHue, dSat, dLum, dHero, geoEnergy, textA, satA, satB, panelCoverage, panelAreaA, panelAreaB,
  } = m;

  const relChanged = changedRows / m.H;
  const relText = textA > 0 ? (m.textB - m.textA) / textA : 0;

  const notes = [];
  const push = (s) => notes.push(s);

  // --- 1. structural confinement: an exclusive signature, checked FIRST -------
  //
  //   A difference confined entirely to one vertical third, with all other thirds empty,
  //   is produced by exactly one thing: a rigid block being translated. Nothing else in
  //   this task concentrates its energy that way — re-rasterised glyphs straddle two thirds,
  //   and a repaint covers the canvas.
  //
  //   Measured at scale 4 across every class and magnitude:
  //     spacing    fracBot 0.927, fracMid 0.073, fracTop 0.000   (at EVERY magnitude,
  //                                                              including mag 0.02 where
  //                                                              geoEnergy is only 0.78)
  //     geometry   fracMid 1.000, others 0.000
  //     typography fracTop 0.56..0.70 with fracMid 0.30..0.44    (two thirds -> excluded)
  //     color      fracMid 1.000   (decided by the hue rule below)
  //     imagery    fracMid 1.000   (decided by the saturation rule below)
  //     identical  all thirds 0.000
  //
  //   This has to run before the `clean` gate. The previous ordering let low-magnitude
  //   spacing be swallowed by `clean`, because a 1-2px displacement gives geoEnergy ~2.5
  //   and changedRows ~50, i.e. relChanged 0.017..0.019, just under clean's 0.02 bar —
  //   while fracBot sat at 0.927 the whole time, unread. That single ordering bug caused
  //   100% of the spacing failures (9/48 in the 12-seed sweep).
  //
  //   Requiring geoEnergy > 0.5 keeps this from firing on byte-identical images, where
  //   every third is 0.000 and the max would otherwise be ambiguous.
  const thirdMax = Math.max(fracTop, fracMid, fracBot);
  const thirdOthers = [fracTop, fracMid, fracBot].filter(v => v !== thirdMax);
  // The energy floor is deliberately low. Spatial confinement is the most reliable signal in
  // this task: measured across mag 0.008..1.0, geometry puts fracMid at exactly 1.000 with the
  // other thirds at 0.000, while typography splits 0.55/0.45 and spacing puts 0.927 in the
  // bottom third. A displaced rigid block concentrates its whole difference in one third even
  // when the displacement is a fifth of a pixel, so requiring much energy here would only
  // re-hide low-severity geometry — which is exactly what an earlier `geoEnergy > 0.5` floor
  // did. The floor exists solely to exclude byte-identical images, where every third is 0.
  const confined = geoEnergy > 0.15 && thirdMax > 0.9 && Math.max(...thirdOthers) < 0.1;

  // --- 2. clean: essentially no difference anywhere -------------------------
  //
  // `clean` must mean the two renders are effectively THE SAME IMAGE, so the gate is written
  // to require that, not merely "no rule fired". It originally tested geoEnergy, relChanged and
  // relText, all of which stay small at low defect severity — so a genuine typography defect at
  // mag 0.022 (geoEnergy 0.64, relText -0.004, but 43 changed rows and a churn ratio of 67)
  // satisfied every condition and was reported as clean before the typography rule ran.
  //
  // The honest additional requirement is that almost NO rows changed. A real edit moves many
  // rows even when its per-pixel magnitude is small; a near-identical pair moves almost none.
  // Measured: identical renders give changedRows 0, sub-pixel noise gives 5-16, and a genuine
  // low-severity defect gives 43-58.
  const CLEAN_MAX_CHANGED_ROWS = 20;
  if (!confined && changedRows <= CLEAN_MAX_CHANGED_ROWS &&
      geoEnergy < 1.2 && relChanged < 0.02 && Math.abs(relText) < 0.05) {
    return { label: 'clean', confidence: 0.95, reason: `near-identical (geoEnergy=${geoEnergy.toFixed(2)}, changedRows=${changedRows})`, features: m };
  }

  // --- 2/3. colour defects, decided on ORTHOGONAL axes -----------------------
  //
  // `color` and `imagery` both repaint a large flat panel, so geometry-style energy cannot
  // tell them apart — but they move two independent quantities, and the panel is measured on
  // its OWN fill (see largestFlatRegion):
  //
  //   color   rotates HUE, leaving saturation exactly alone  -> dSat == 0.000, dHue scales
  //   imagery drains SATURATION toward grey/white            -> dSat scales, dLum > 0
  //
  // Measured at scale 4 over mag 0.03..1.0, on the segmented panel:
  //
  //   color       satA 0.967, satB 0.967  -> dSat 0.000 at EVERY magnitude; dHue 3.7..127.5
  //   imagery     satA 0.967, satB 0.967->0.011 -> dSat 0.045..0.956 (monotonic); dHue 0.7..34.8
  //   geometry    dSat 0.000, dHue 0.0
  //   typography  dSat 0.000, dHue 0.0
  //   spacing     dSat 0.000, dHue 0.0..0.3
  //
  // The separation is therefore exact rather than threshold-tuned: only `imagery` moves
  // saturation at all, and only `color` moves hue without moving saturation. The tiny
  // epsilon tolerances below exist for antialiasing, not to carve a gap.
  //
  // Both classes are checked before the layout rules because a repaint also perturbs row and
  // column difference energy, which would otherwise let `geometry` or `typography` claim them.
  //
  // `panelCoverage` guards the measurement: if no flat region was large enough to be the
  // panel, the values fall back to the box mean and cannot be trusted, so neither colour rule
  // is allowed to fire on that basis.
  //
  // A second guard is needed because the two images are segmented independently. After a
  // wash-out the panel can become near-white, at which point the LARGEST flat region in the
  // candidate may be a different element entirely (the background, or a stat card). Comparing
  // that region's saturation against the reference panel's produces a nonsense ratio — the
  // critic's palette sweep caught this as `0.100 -> 0.922`, i.e. saturation apparently
  // INCREASING under a defect that only removes colour. We therefore require the two
  // segmented regions to be comparable in size before trusting the comparison at all.
  const satDrained = satA > 0.05 ? dSat / satA : 0;
  const panelFound = panelCoverage >= 0.10;
  const comparable = panelFound && panelAreaA > 0 && panelAreaB > 0 &&
    Math.min(panelAreaA, panelAreaB) / Math.max(panelAreaA, panelAreaB) >= 0.5;
  const washOut = geoEnergy > 0 ? dLum / geoEnergy : 0;
  if (comparable && satDrained > 0.02) {
    push(`hero panel colour drained ${(satDrained * 100).toFixed(1)}% (panel saturation ${satA.toFixed(3)} -> ${satB.toFixed(3)}, luminance +${dLum.toFixed(1)}) -> artwork washed out`);
    return { label: 'imagery', confidence: 0.88, reason: notes.join('; '), features: m };
  }
  // A wash-out is also recognisable when the panel's saturation INCREASES while its luminance
  // rises: draining a low-saturation panel toward the page background can leave the largest
  // remaining flat region brighter and more saturated than the original panel was. What stays
  // true is that the panel brightened a lot and the hue moved without the layout changing.
  if (panelFound && dLum > 6 && washOut > 0.5 && Math.abs(dHue) > 0.5 && geoEnergy < 60) {
    push(`panel brightened by ${dLum.toFixed(1)} at ${washOut.toFixed(2)}x structural energy with hue shifted ${dHue.toFixed(1)}deg -> artwork washed out rather than recoloured`);
    return { label: 'imagery', confidence: 0.75, reason: notes.join('; '), features: m };
  }
  if (comparable && dHue > 1.0 && satDrained <= 0.02 && dHero > 1.0) {
    push(`panel hue rotated ${dHue.toFixed(1)}deg with saturation untouched (${satA.toFixed(3)} -> ${satB.toFixed(3)}) -> wrong palette, artwork intact`);
    return { label: 'color', confidence: 0.85, reason: notes.join('; '), features: m };
  }

  // --- 3b. structural confinement resolution ----------------------------------
  //     `confined` was computed at the top (it gates the `clean` branch). Everything above
  //     this point has already had the chance to claim `color`/`imagery` on their orthogonal
  //     axes — which matters, because a repaint also puts its energy in one third
  //     (fracMid = 1.000) and would otherwise be read as `geometry` here.
  //
  //     So if we reach this line and the difference is confined to one third, it is a rigid
  //     block displacement: `spacing` when the energy is in the bottom third, else `geometry`.
  if (confined) {
    const label = fracBot === thirdMax ? 'spacing' : 'geometry';
    push(`difference confined to one third (top=${fracTop.toFixed(3)}, mid=${fracMid.toFixed(3)}, bot=${fracBot.toFixed(3)}) -> single rigid block displacement, not a repaint or glyph re-rasterisation`);
    return { label, confidence: 0.8, reason: notes.join('; '), features: m };
  }

  // --- 4. typography: glyphs change size in place ------------------------------
  //     A layout defect spends a lot of structural energy to move a little content: one
  //     rigid block produces large row/column differences over relatively few rows.
  //     Re-rasterising glyphs is the opposite — many rows change while the absolute
  //     difference energy stays small, because glyph edges shift a little rather than a
  //     whole panel moving a lot. So the separator is changedRows per unit of
  //     structural energy.
  //
  //     IMPORTANT: this ratio is only meaningful where the glyphs actually moved. Measured
  //     across a wide magnitude range, typography's ratio COLLAPSES TO 0 below about mag 0.013,
  //     because the glyph change is then sub-pixel and no row changes at all — while geometry
  //     keeps moving whole panels and its ratio climbs to 73.6. A naive `ratio > 50` test
  //     therefore sits INSIDE the geometry range at low severity and would claim a displaced
  //     panel as a font change. Within the eval band (0.03..0.06) the gap is real:
  //       geometry    ratio 24.0 .. 45.0
  //       spacing     ratio 16.8 .. 21.9
  //       typography  ratio 56.5 .. 100.0
  //     but the rule must not be relied on outside it, so it carries an explicit precondition
  //     that the text band actually changed (`hadTextChurn`), which is what fails at low
  //     severity. This was found by a critic that swept the ratio over 79 magnitudes; the
  //     earlier comment claiming "geometry 24.0..45.0" was simply false beyond the band.
  //
  //     |relText| alone is NOT sufficient: supersampled antialiasing gives pure
  //     translation a few percent of apparent ink change (geometry spans -0.014..+0.107),
  //     which overlaps typography's own -0.014..-0.143.
  //     geoEnergy alone is not sufficient either: at this band geometry spans 2.64..4.07
  //     while typography spans 1.67..2.51, so the old absolute bar of 4.0 sat inside the
  //     geometry range and swallowed every geometry case. It is kept below only as a
  //     cheap upper bound on what this rule may claim.
  const churnRatio = geoEnergy > 0 ? changedRows / geoEnergy : Infinity;
  // Preconditions, derived from the sub-pixel regime where these rules previously misfired.
  //
  //   hadTextChurn  changedRows >= 24. Glyph re-rasterisation always moves many rows; a
  //                 sub-pixel panel displacement moves few.
  //
  // An earlier attempt also required `geoEnergy >= 0.6`. That was too blunt: it fixed
  // low-magnitude geometry but simultaneously blocked low-magnitude TYPOGRAPHY, which is
  // genuinely detectable there (at mag 0.022 typography gives geoEnergy 0.64, changedRows 43
  // and a ratio of 67). The discriminator between the two at low severity is not the energy
  // but the row count: typography churns 40-58 rows while a 0.14px displacement churns 16.
  // So the guard belongs on `changedRows` alone, which `hadTextChurn` already encodes.
  const hadTextChurn = changedRows >= 24;
  if (hadTextChurn && churnRatio > 50 && geoEnergy < 12) {
    push(`high row churn per unit structural energy (changedRows=${changedRows} / geo=${geoEnergy.toFixed(2)} = ${churnRatio.toFixed(1)}, text mass ${(relText * 100).toFixed(1)}%) -> in-place glyph re-rasterisation`);
    return { label: 'typography', confidence: 0.8, reason: notes.join('; '), features: m };
  }
  // The two plain text-mass rules below carry the SAME precondition as the ratio rule above,
  // and for the same reason: text mass can appear to change by a double-digit percentage when
  // a panel moves by a fraction of a pixel, because sub-pixel antialiasing reshuffles gradient
  // pixels without anything actually being re-rasterised. Measured: geometry at mag 0.008 gives
  // geoEnergy 0.4 with relText +15.7%, which the bare `|relText| > 0.08` test read as a font
  // change. Re-rasterising glyphs always changes rows; a sub-pixel displacement does not.
  if (hadTextChurn && Math.abs(relText) > 0.08 && geoEnergy < 12) {
    push(`text mass changed ${(relText * 100).toFixed(1)}% across ${changedRows} rows with near-static layout (geo=${geoEnergy.toFixed(1)})`);
    return { label: 'typography', confidence: 0.8, reason: notes.join('; '), features: m };
  }
  if (hadTextChurn && Math.abs(relText) > 0.18 && geoEnergy < 55) {
    push(`text mass changed ${(relText * 100).toFixed(1)}% across ${changedRows} rows with low displacement (geo=${geoEnergy.toFixed(1)})`);
    return { label: 'typography', confidence: 0.7, reason: notes.join('; '), features: m };
  }

  // --- 5. spacing vs geometry: look WHERE the energy sits -------------------
  //     spacing squeezes the lower block up -> energy spread across the lower two thirds
  //     geometry displaces the mid panel -> energy concentrated in the middle third.
  if (geoEnergy >= 55 || relChanged > 0.02) {
    if (fracMid > 0.46 && fracMid > fracBot + 0.06) {
      push(`mid-concentrated displacement (fracMid=${fracMid.toFixed(2)})`);
      return { label: 'geometry', confidence: 0.72, reason: notes.join('; '), features: m };
    }
    if (fracBot + fracMid > 0.72 && fracMid < fracBot + 0.06) {
      push(`lower-block displacement (fracMid=${fracMid.toFixed(2)}, fracBot=${fracBot.toFixed(2)})`);
      return { label: 'spacing', confidence: 0.72, reason: notes.join('; '), features: m };
    }
    // Fallback: whichever non-clean class is closest by structure.
    push(`structural change, band count ${bandsA} (ambiguous)`);
    return { label: fracMid >= fracBot ? 'geometry' : 'spacing', confidence: 0.45, reason: notes.join('; '), features: m };
  }

  return { label: 'clean', confidence: 0.4, reason: 'no measurement exceeded threshold', features: m };
}

export async function classify(referencePng, candidatePng) {
  const m = await measurePair(referencePng, candidatePng);
  return decide(m);
}
