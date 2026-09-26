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
    dHue, dSat, dLum, dHero, geoEnergy, textA,
  } = m;

  const relChanged = changedRows / m.H;
  const relText = textA > 0 ? (m.textB - m.textA) / textA : 0;

  const notes = [];
  const push = (s) => notes.push(s);

  // --- 1. clean: essentially no difference anywhere -------------------------
  if (geoEnergy < 1.2 && relChanged < 0.02 && Math.abs(relText) < 0.05) {
    return { label: 'clean', confidence: 0.95, reason: `near-identical (geoEnergy=${geoEnergy.toFixed(2)}, changedRows=${changedRows})`, features: m };
  }

  // --- 2. imagery: hero region loses saturation AND gains luminance (blanked to white/grey)
  if (dSat > 0.25 && dLum > 25) {
    push(`hero blanked (dSat=${dSat.toFixed(2)}, dLum=${dLum.toFixed(1)})`);
    return { label: 'imagery', confidence: 0.85, reason: notes.join('; '), features: m };
  }

  // --- 3. color: dominant hue rotates materially ---------------------------
  if (dHue >= 0 && dHue > 55 && dHero > 60) {
    push(`hue rotated (dHue=${dHue.toFixed(0)}deg, dHero=${dHero.toFixed(0)})`);
    return { label: 'color', confidence: 0.85, reason: notes.join('; '), features: m };
  }

  // --- 4. typography: glyphs change size in place ------------------------------
  //     Key invariant: typography alters a LOT of pixels (glyph edges move within
  //     their boxes) while displacing almost no *structure* — geoEnergy stays in the
  //     low single digits even at full severity, whereas every panel-moving class
  //     starts around 4.5 and climbs steeply. So the reliable discriminator is
  //     "large pixel churn + tiny structural energy", not the size of the text change.
  if (geoEnergy < 4.0 && changedRows >= 20) {
    push(`high pixel churn (changedRows=${changedRows}) with minimal structural energy (geo=${geoEnergy.toFixed(2)}) -> in-place glyph change`);
    return { label: 'typography', confidence: 0.78, reason: notes.join('; '), features: m };
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
