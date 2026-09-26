// Demonstrate the grounded design review on a good screen and a bad one.
//
// The point is to show that findings cite specific sourced rules with numbers, rather than
// generic remarks, and that the same rule set separates a compliant screen from a non-compliant
// one. Run: node bench/review-demo.mjs
import { cleanSpec, renderSpec, RENDER_SCALE } from './fixture.mjs';
import { reviewScreen, formatReview } from './review-knowledge.mjs';
import { verticalGaps } from './design-rules.mjs';

console.log('='.repeat(78));
console.log('UIH grounded design review — Refactoring UI (Wathan & Schoger)');
console.log('='.repeat(78));

// ---------------------------------------------------------------- 1. the fixture
console.log('\n### 1. The benchmark fixture (the "approved reference")');
const good = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });
const goodReview = await reviewScreen(good, { scale: RENDER_SCALE });
console.log(formatReview(goodReview));

// ---------------------------------------------------------------- 2. off-scale spacing
console.log('\n### 2. The same screen with off-scale spacing introduced');
console.log('   (gaps moved onto 20 / 28 / 38 — plausible-looking numbers that are not on the scale)');
const offScale = (() => {
  const s = cleanSpec();
  // Shift blocks by amounts that produce off-scale gaps.
  const shiftFrom = (y0, dy) => { for (const p of s.prims) if (p.box[1] >= y0) p.box[1] += dy; };
  shiftFrom(430, 4);    // 32 -> 36
  shiftFrom(520, -2);   // 48 -> 46
  return s;
})();
const offPng = await renderSpec(offScale, { scale: RENDER_SCALE });
const offReview = await reviewScreen(offPng, { scale: RENDER_SCALE });
console.log(formatReview(offReview));

// Show the gap-by-gap evidence for the spacing rule specifically.
const gaps = await verticalGaps(offPng, RENDER_SCALE);
console.log(`\n   measured gaps: ${gaps.map(g => g.toFixed(1)).join(', ')}`);

// ---------------------------------------------------------------- 3. a bad palette
console.log('\n### 3. The same screen with a pure-neutral grey ramp (CO-5)');
const flatGreys = (() => {
  const s = cleanSpec();
  const map = { '#6b7280': '#808080', '#f3f4f6': '#e0e0e0', '#111827': '#101010' };
  for (const p of s.prims) if (map[p.fill]) p.fill = map[p.fill];
  for (const p of s.prims) {
    if (p.fill === '#808080' && p.text !== undefined) p.fill = '#ffffff';
  }
  return s;
})();
const flatPng = await renderSpec(flatGreys, { scale: RENDER_SCALE });
const flatReview = await reviewScreen(flatPng, { scale: RENDER_SCALE });
console.log(formatReview(flatReview));

console.log('\n' + '='.repeat(78));
console.log('Note: every finding above names a rule id and a page in the book, so a reader can');
console.log('check the claim. Rules that cannot be judged from a single render are reported as');
console.log(`unverified rather than passing (the fixture reported ${goodReview.unverified} such).`);
console.log('='.repeat(78));
