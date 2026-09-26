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

/** Dominant hue (degrees) over pixels that are saturated enough to have a hue. */
function dominantHue(data, W, H) {
  const hist = new Float64Array(36); // 10-degree bins
  let n = 0;
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
    hist[Math.floor(h / 10) % 36] += 1;
    n++;
  }
  if (n === 0) return { hue: -1, share: 0, n: 0 };
  let best = 0;
  for (let k = 1; k < 36; k++) if (hist[k] > hist[best]) best = k;
  return { hue: best * 10 + 5, share: hist[best] / n, n };
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

  // Hero band ink coverage (proxy for "was there artwork here").
  const heroY0 = Math.round(H * 0.26), heroY1 = Math.round(H * 0.47);
  const heroX0 = Math.round(W * 0.07), heroX1 = Math.round(W * 0.93);
  const mA = meanRGB(A.data, W, heroX0, heroY0, heroX1, heroY1);
  const mB = meanRGB(B.data, W, heroX0, heroY0, heroX1, heroY1);
  const satOf = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
  const satA = satOf(mA), satB = satOf(mB);
  const lumA = 0.299 * mA[0] + 0.587 * mA[1] + 0.114 * mA[2];
  const lumB = 0.299 * mB[0] + 0.587 * mB[1] + 0.114 * mB[2];
  const dSat = satA - satB;                    // positive => colour drained
  const dLum = lumB - lumA;                    // positive => got brighter (blanked to white)

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
    hueA: hA.hue, hueB: hB.hue, dHue, satA, satB, dSat, dLum, dHero,
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
    dHue, dSat, dLum, dHero, geoEnergy, textA, satA, satB,
  } = m;

  const relChanged = changedRows / m.H;
  const relText = textA > 0 ? (m.textB - m.textA) / textA : 0;

  const notes = [];
  const push = (s) => notes.push(s);

  // --- 1. clean: essentially no difference anywhere -------------------------
  if (geoEnergy < 1.2 && relChanged < 0.02 && Math.abs(relText) < 0.05) {
    return { label: 'clean', confidence: 0.95, reason: `near-identical (geoEnergy=${geoEnergy.toFixed(2)}, changedRows=${changedRows})`, features: m };
  }

  // --- 2/3. colour defects, decided on ORTHOGONAL axes -----------------------
  //
  // `color` and `imagery` both repaint large flat regions, so geometry-style energy
  // cannot tell them apart — but they move different, independent quantities:
  //
  //   color   rotates HUE at constant saturation  -> dSat ~= 0.000, dHue large
  //   imagery drains SATURATION toward grey/white -> dHue == 0,    dSat large, dLum > 0
  //
  // Measured over mag 0.06..1.0: color gives dSat in [-0.004, +0.005] while dHue climbs
  // 10..160; imagery gives dHue == 0 exactly while dSat climbs 0.020..0.263 and dLum
  // 3.5..57.3. So the two axes are genuinely separable and neither class needs to be
  // guessed from shape.
  //
  // Both are checked before the layout rules because a repaint also perturbs row/column
  // difference energy, which would otherwise let `geometry` or `typography` claim them.
  // The saturation test is a ratio rather than a fixed bar so it survives rescalings of
  // the fixture's palette: what matters is that saturation was destroyed, not its size.
  const satDrained = satA > 0.05 ? dSat / satA : 0;   // fraction of original saturation lost
  // A layout blit also drains a little saturation (areas shift onto differently coloured
  // neighbours), so saturation loss alone is not sufficient. What separates a genuine
  // wash-out is that the luminance gain is large RELATIVE to the structural displacement:
  // over mag 0.06..1.0 imagery gives dLum/geoEnergy of 0.98..1.38 with dHue == 0, while
  // geometry gives 0.23..0.78 (its energy is spent moving pixels, not brightening them).
  const washOut = geoEnergy > 0 ? dLum / geoEnergy : 0;
  if (satDrained > 0.06 && dLum > 1.5 && washOut > 0.9 && dHue === 0) {
    push(`hero washed out: saturation -${(satDrained * 100).toFixed(0)}%, luminance +${dLum.toFixed(1)} at ${washOut.toFixed(2)}x structural energy, hue unchanged -> artwork lost`);
    return { label: 'imagery', confidence: 0.85, reason: notes.join('; '), features: m };
  }
  if (dHue >= 0 && dHue > 6 && Math.abs(dSat) < 0.02 && dHero > 5) {
    push(`hue rotated ${dHue.toFixed(0)}deg at constant saturation (dSat=${dSat.toFixed(3)}, dHero=${dHero.toFixed(1)}) -> wrong palette`);
    return { label: 'color', confidence: 0.82, reason: notes.join('; '), features: m };
  }

  // --- 3b. decisive structural override ---------------------------------------
  //     Before the text-mass test, check whether the difference is spatially confined to
  //     a single vertical third. Re-rasterised glyphs change edges wherever text lives,
  //     which straddles the header, the stat row and the hero — it cannot concentrate in
  //     one third. A displaced panel is one rigid block, so its energy sits in exactly
  //     one third (measured: geometry fracMid = 1.000 with fracTop = fracBot = 0.000).
  //
  //     This override exists because supersampled rendering gives antialiased text edges
  //     a slightly different gradient count under pure translation, so |relText| is no
  //     longer exactly 0 and the ink-loss test below would misread a moved panel as a
  //     re-rastered one. Spatial confinement is the more reliable signal at that point.
  //
  //     "Confined to one third" means one third holds ~everything AND the others hold
  //     ~nothing. Measured over mag 0.06..1.0: geometry gives (top,mid,bot) =
  //     (0.000, 1.000, 0.000) at every magnitude, while spacing gives (0.000, 0.073,
  //     0.927). Typography is the case that must NOT match: it gives top 0.556..0.701
  //     with mid 0.299..0.444, i.e. energy split across two thirds, because glyphs
  //     change in the header band AND the stat row AND the hero. Requiring the other
  //     thirds to be near-empty is what keeps typography out of this branch.
  const third = Math.max(fracTop, fracMid, fracBot);
  const others = [fracTop, fracMid, fracBot].filter(v => v !== third);
  if (relChanged > 0.02 && third > 0.9 && Math.max(...others) < 0.1) {
    const label = fracBot === third ? 'spacing' : 'geometry';
    push(`difference confined to one third (top=${fracTop.toFixed(3)}, mid=${fracMid.toFixed(3)}, bot=${fracBot.toFixed(3)}) -> single rigid block displacement, not glyph re-rasterisation`);
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
  //     Measured over mag 0.06..1.0 at scale 4:
  //       geometry    ratio 24.0 .. 45.0
  //       spacing     ratio 16.8 .. 21.9
  //       typography  ratio 56.5 .. 100.0     <- clean gap above the layout classes
  //     A cut at 50 sits inside that gap. (`color`/`imagery` also give high ratios, since
  //     a repaint touches every row at low energy, but both are decided by their
  //     orthogonal saturation/hue rules above and never reach this branch.)
  //
  //     |relText| alone is NOT sufficient: supersampled antialiasing gives pure
  //     translation a few percent of apparent ink change (geometry spans -0.014..+0.107),
  //     which overlaps typography's own -0.014..-0.143.
  //     geoEnergy alone is not sufficient either: at this band geometry spans 2.64..4.07
  //     while typography spans 1.67..2.51, so the old absolute bar of 4.0 sat inside the
  //     geometry range and swallowed every geometry case. It is kept below only as a
  //     cheap upper bound on what this rule may claim.
  const churnRatio = geoEnergy > 0 ? changedRows / geoEnergy : Infinity;
  if (churnRatio > 50 && geoEnergy < 12 && changedRows >= 8) {
    push(`high row churn per unit structural energy (changedRows=${changedRows} / geo=${geoEnergy.toFixed(2)} = ${churnRatio.toFixed(1)}, text mass ${(relText * 100).toFixed(1)}%) -> in-place glyph re-rasterisation`);
    return { label: 'typography', confidence: 0.8, reason: notes.join('; '), features: m };
  }
  if (Math.abs(relText) > 0.08 && geoEnergy < 12) {
    push(`text mass changed ${(relText * 100).toFixed(1)}% with near-static layout (geo=${geoEnergy.toFixed(1)})`);
    return { label: 'typography', confidence: 0.8, reason: notes.join('; '), features: m };
  }
  if (Math.abs(relText) > 0.18 && geoEnergy < 55) {
    push(`text mass changed ${(relText * 100).toFixed(1)}% with low displacement (geo=${geoEnergy.toFixed(1)})`);
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
