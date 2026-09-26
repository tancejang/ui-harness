// Synthetic UI fixture renderer for the held-out UI defect benchmark.
//
// A fixture is a declarative list of primitives. We rasterize it with sharp so that
// every pixel is a pure function of the spec. Perturbations then mutate the spec by a
// known defect class, which becomes the held-out ground-truth label.
//
// Design rule: nothing in here may tell the judge what the label is. The judge only ever
// sees (reference pixels, candidate pixels).

import sharp from 'sharp';

export const PALETTE = {
  bg: '#ffffff',
  ink: '#111827',
  muted: '#6b7280',
  primary: '#2563eb',
  accent: '#059669',
  warn: '#d97706',
  danger: '#dc2626',
  panel: '#f3f4f6',
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rect(x, y, w, h, fill, r = 0) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${r}"/>`;
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

  // Two action buttons
  const by = hy + 152 + 28;
  const bw = 152, bh = 48;
  prims.push({ kind: 'button-primary', box: [m, by, bw, bh], fill: PALETTE.primary, text: 'Export', size: 16, fill: '#ffffff', weight: 600 });
  prims.push({ kind: 'button-secondary', box: [m + bw + 16, by, bw, bh], fill: PALETTE.panel, text: 'Share', size: 16, fill: PALETTE.ink, weight: 600 });

  // List rows
  const ly = by + bh + 28;
  for (let i = 0; i < 3; i++) {
    const ry = ly + i * 64;
    prims.push({ kind: `row-${i}`, box: [m, ry, cw, 52], fill: PALETTE.panel });
    prims.push({ kind: `row-text-${i}`, box: [m + 16, ry + 30, cw - 200, 18], text: `Transaction ${i + 1}`, size: 15, fill: PALETTE.ink });
    prims.push({ kind: `row-amount-${i}`, box: [m + cw - 140, ry + 30, 124, 18], text: `$${(i + 1) * 37}.00`, size: 15, fill: PALETTE.muted, anchor: 'end' });
  }

  return { W, H, prims };
}

/** Rasterize a spec to a PNG buffer. */
export async function renderSpec(spec) {
  const parts = [rect(0, 0, spec.W, spec.H, PALETTE.bg)];
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
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.W}" height="${spec.H}" viewBox="0 0 ${spec.W} ${spec.H}">${parts.join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

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
 * geometry defect: a whole panel is mispositioned / resized by a large amount.
 * Chosen magnitude is well above the noise floor of rasterization (<1px).
 */
function perturbGeometry(spec, mag) {
  const s = clone(spec);
  for (const p of find(s, 'hero-panel')) shift(p, Math.round(18 * mag), Math.round(14 * mag));
  for (const p of find(s, 'hero-text')) shift(p, Math.round(18 * mag), Math.round(14 * mag));
  for (const p of find(s, 'hero-sub')) shift(p, Math.round(18 * mag), Math.round(14 * mag));
  return { spec: s, label: 'geometry' };
}

/** typography defect: text sizes change materially (weight/size), boxes stay put. */
function perturbTypography(spec, mag) {
  const s = clone(spec);
  for (const p of find(s, 'header-text')) p.size = Math.round(p.size * (1 - 0.30 * mag));
  for (const p of find(s, 'stat-value')) p.size = Math.round(p.size * (1 - 0.35 * mag));
  for (const p of find(s, 'hero-text')) p.size = Math.round(p.size * (1 - 0.30 * mag));
  for (const p of find(s, 'row-text-0')) p.size = Math.round(p.size * (1 - 0.25 * mag));
  return { spec: s, label: 'typography' };
}

/** spacing defect: vertical gaps between sibling blocks collapse or expand. */
function perturbSpacing(spec, mag) {
  const s = clone(spec);
  const delta = Math.round(14 * mag);
  const moveFrom = y0 => {
    for (const p of s.prims) if (p.box[1] >= y0) shift(p, 0, delta);
  };
  // Squeeze everything below the hero panel upward.
  moveFrom(s.prims.find(p => p.kind === 'button-primary').box[1]);
  return { spec: s, label: 'spacing' };
}

/** color defect: large regions swap to a materially different hue. */
function perturbColor(spec, mag) {
  const s = clone(spec);
  const swap = (kind, to) => { for (const p of find(s, kind)) p.fill = to; };
  if (mag >= 1) {
    swap('header-band', PALETTE.danger);
    swap('hero-panel', PALETTE.warn);
  } else {
    swap('hero-panel', PALETTE.warn);
  }
  return { spec: s, label: 'color' };
}

/** imagery defect: an image-like panel is blanked / replaced by flat fill. */
function perturbImagery(spec, mag) {
  const s = clone(spec);
  for (const p of find(s, 'hero-panel')) {
    p.fill = mag >= 1 ? '#ffffff' : '#e5e7eb';
  }
  for (const p of find(s, 'hero-text')) p.fill = mag >= 1 ? '#ffffff' : '#9ca3af';
  for (const p of find(s, 'hero-sub')) p.fill = mag >= 1 ? '#ffffff' : '#9ca3af';
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

export { DEFECTS, clone, find, shift };
