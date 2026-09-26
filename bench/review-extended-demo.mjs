// Exercise every measured rule against the fixture and against deliberately broken variants.
//
// A rule that never fires is not evidence of quality, and a rule that always fires is noise. This
// shows each rule's actual verdict on a good screen and confirms the ones that should fire do.
//
// Run: node bench/review-extended-demo.mjs
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import { reviewScreen } from './review-knowledge.mjs';
import {
  typeScaleCount, lineHeightScaling, hierarchyContrast, saturationSurvivesLightness,
  lightFromAbove, borderCount, noGreyTextOnColour, textBands,
} from './design-rules-extended.mjs';

const png = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });

console.log('=== raw measurements on the fixture ===\n');

const bands = textBands(
  (await import('sharp')).default ? (await (await import('sharp')).default(png).raw().toBuffer({ resolveWithObject: true })).data : [],
  480, 720, { scale: 1 });

const results = {
  'TY-1 type scale': await typeScaleCount(png, { scale: RENDER_SCALE }),
  'TY-6 line-height': await lineHeightScaling(png, { scale: RENDER_SCALE }),
  'HI-1 hierarchy': await hierarchyContrast(png, { scale: RENDER_SCALE }),
  'CO-4 saturation survives lightness': await saturationSurvivesLightness(png),
  'DE-1 light from above': await lightFromAbove(png, { scale: RENDER_SCALE }),
  'FI-5 border count': await borderCount(png, { scale: RENDER_SCALE }),
  'HI-3 grey text on colour': await noGreyTextOnColour(png),
};

for (const [name, r] of Object.entries(results)) {
  if (r === null) { console.log(`${name.padEnd(36)} UNVERIFIED (no evidence in this render)`); continue; }
  console.log(`${name.padEnd(36)} ${r.ok ? 'pass' : 'FAIL'}  ${JSON.stringify(r).slice(0, 150)}`);
}

console.log('\n=== full review ===\n');
const review = await reviewScreen(png, { scale: RENDER_SCALE });
console.log(`${review.findings.length} rules measured, ${review.unverified} unverified`);
console.log(review.summary);
for (const f of review.failed) {
  console.log(`  FAIL ${f.id} (p.${f.page}) — ${f.detail}`);
}

console.log('\n=== do the rules fire on deliberately broken input? ===\n');
const broken = [
  ['spacing', () => { const s = cleanSpec(); for (const p of s.prims) if (p.box[1] >= 430) p.box[1] += 4; return s; }, 'SP-2'],
  ['colour', () => { const s = cleanSpec(); for (const p of s.prims) if (p.fill === '#047857') p.fill = '#d97706'; return s; }, 'CO-4'],
  ['type', () => { const s = cleanSpec(); const sizes = [11, 13, 17, 19, 23, 27]; let i = 0; for (const p of s.prims) if (p.text !== undefined) p.size = sizes[i++ % sizes.length]; return s; }, 'TY-1'],
];

for (const [label, make, expect] of broken) {
  const p = await renderSpec(make(), { scale: RENDER_SCALE });
  const r = await reviewScreen(p, { scale: RENDER_SCALE });
  const ids = r.failed.map(f => f.id);
  console.log(`${label.padEnd(10)} expected ${expect.padEnd(5)} -> failed: ${ids.join(', ') || '(none)'} ${ids.includes(expect) ? 'FIRED' : ''}`);
}
