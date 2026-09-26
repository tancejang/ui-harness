// The design-review knowledge base.
//
// This is the module UIH consults when it reviews a screen, so a finding cites a specific,
// sourced rule instead of an opinion. Two sources back it:
//
//   1. docs/DESIGN-RUBRIC.md  - 57 rules distilled from Refactoring UI, with page numbers
//   2. docs/reference/figure-data.json - the concrete values from the book's 284 figures:
//      the spacing scale in pixels, the shade ramps in hex, the grey temperature
//
// The split matters. The prose states rules of thumb ("no two values closer than 25%",
// "you need 5-10 shades"); the figures state the values. A reviewer that has only the prose can
// say "your spacing looks inconsistent"; one that has the figures can say "28px is not on the
// scale, the nearest step is 24 or 32".
//
// Every REVIEW_RULES entry carries: the rule id, the source page, a plain-language statement,
// and — where the pixels allow it — a `measure` function returning {ok, detail, evidence}.

import {
  SPACING_SCALE, conformsToSpacingScale, snapToSpacingScale, verticalGaps,
  lightnessKeepsSaturation, greysHaveTemperature, textContrast, greyRampCount,
  greyTemperature, radiusCluster, contrastRatio, hexToHsl,
} from './design-rules.mjs';
import {
  typeScaleCount, lineHeightScaling, hierarchyContrast,
  saturationSurvivesLightness, lightFromAbove, borderCount, noGreyTextOnColour,
} from './design-rules-extended.mjs';

/**
 * The reviewable rule set. Each entry is what a review finding cites.
 *
 * `measure(ctx)` receives { png, scale, gaps } and returns null when the rule cannot be judged
 * from this screen (so a reviewer reports "unverified" rather than inventing a verdict).
 */
export const REVIEW_RULES = [
  {
    id: 'SP-2',
    page: 73,
    statement: 'Spacing and sizing should come from a constrained scale, not arbitrary values.',
    source: 'figure',
    measure: ({ gaps, scale }) => {
      if (!gaps?.length) return null;
      const c = conformsToSpacingScale(gaps, 2);
      return {
        ok: c.ok,
        detail: c.note,
        evidence: c.offScale.map(o => `${o.observed}px (nearest scale step ${o.snapped}px)`),
        suggestion: c.ok ? null : `snap each off-scale gap to the nearest step: ${c.offScale.map(o => `${o.observed}->${o.snapped}`).join(', ')}`,
      };
    },
  },
  {
    id: 'SP-1',
    page: 67,
    statement: 'Start with too much white space, then remove it; give elements room to breathe.',
    source: 'prose',
    measure: ({ gaps, scale }) => {
      const content = (gaps ?? []).filter(g => g >= 8);
      if (content.length < 2) return null;
      const tight = content.filter(g => g < 12);
      return {
        ok: tight.length === 0,
        detail: tight.length === 0
          ? `every inter-element gap is at least 12px`
          : `${tight.length} gap(s) under 12px look cramped`,
        evidence: tight.map(g => `${g.toFixed(1)}px`),
        suggestion: tight.length ? 'the book recommends starting generous and removing space, not adding it' : null,
      };
    },
  },
  {
    id: 'SP-5',
    page: 99,
    statement: 'Avoid ambiguous spacing: proximity must make grouping unmistakable.',
    source: 'prose',
    measure: ({ gaps }) => {
      const g = (gaps ?? []).filter(x => x >= 4);
      if (g.length < 3) return null;
      const uniq = [...new Set(g.map(x => Math.round(x)))].sort((a, b) => a - b);
      // Ambiguity shows up as two different gaps that are too close to distinguish.
      const ambiguous = [];
      for (let i = 1; i < uniq.length; i++) {
        const d = uniq[i] - uniq[i - 1];
        if (d > 0 && d < 8 && uniq[i] >= 8) ambiguous.push({ a: uniq[i - 1], b: uniq[i], delta: d });
      }
      return {
        ok: ambiguous.length === 0,
        detail: ambiguous.length === 0
          ? 'distinct gap sizes are far enough apart to read as different groups'
          : `${ambiguous.length} pair(s) of gaps differ by under 8px, so grouping is ambiguous`,
        evidence: ambiguous.map(a => `${a.a}px vs ${a.b}px (${a.delta}px apart)`),
        suggestion: ambiguous.length ? 'separate the two levels further, or merge them into one' : null,
      };
    },
  },
  {
    id: 'CO-6',
    page: 163,
    statement: 'Text must meet contrast requirements; accessible does not have to mean ugly.',
    source: 'prose',
    measure: ({ png }) => {
      if (!png) return null;
      return textContrast(png).then(c => {
        // With no measurable text edges the rule is UNVERIFIABLE, not failing. Reporting
        // "p05 = 0.00" as a violation would be inventing a verdict from absent data — the exact
        // failure mode the reviewer prompt warns against. Seen on a flat-colour capture with no
        // text at all.
        if (c.n < 50) return null;
        return {
          ok: c.p05 >= 4.5,
          detail: `text contrast p05=${c.p05.toFixed(2)}:1, p50=${c.p50.toFixed(2)}:1 over ${c.n} edges (WCAG body text needs 4.5)`,
          evidence: [`p05 ${c.p05.toFixed(2)}`, `p50 ${c.p50.toFixed(2)}`, `n=${c.n}`],
          suggestion: c.p05 >= 4.5 ? null : 'darken the lowest-contrast text or lighten its backdrop',
        };
      });
    },
  },
  {
    id: 'CO-2',
    page: 141,
    statement: 'You need more colours than you think: a full grey ramp plus primary and accent ramps.',
    source: 'prose',
    measure: ({ png }) => {
      if (!png) return null;
      return greyRampCount(png).then(n => {
        // A single-colour capture has no ramp to judge. Reporting it as a palette failure would
        // again be a verdict from absent data.
        if (n === 0) return null;
        return {
          ok: n >= 5,
          detail: `${n} distinct near-neutral luminance levels (the book asks for at least 5)`,
          evidence: [`grey levels: ${n}`],
          suggestion: n >= 5 ? null : 'add intermediate greys; a two-step ramp cannot express hierarchy',
        };
      });
    },
  },
  {
    id: 'CO-5',
    page: 158,
    statement: "Greys don't have to be grey: give them a consistent temperature.",
    source: 'figure',
    measure: ({ png }) => {
      if (!png) return null;
      return greyTemperature(png).then(t => {
        if (t.meanHue === null) return { ok: false, detail: 'no tinted greys found; the ramp is pure neutral', evidence: [], suggestion: 'shift greys toward one temperature (cool or warm) for cohesion' };
        const ok = t.spread < 20 && t.count > 100;
        return {
          ok,
          detail: `greys share hue ${t.meanHue.toFixed(0)}deg with spread ${t.spread.toFixed(1)}deg`,
          evidence: [`meanHue ${t.meanHue.toFixed(1)}`, `spread ${t.spread.toFixed(1)}`, `n=${t.count}`],
          suggestion: ok ? null : 'greys are tinted inconsistently; pick one temperature and hold it',
        };
      });
    },
  },
  {
    id: 'LV-5',
    page: 23,
    statement: 'Choose a personality (font, colour, radius) and stay consistent.',
    source: 'prose',
    measure: ({ png }) => {
      if (!png) return null;
      return radiusCluster(png).then(r => ({
        ok: r.distinct > 0 && r.distinct <= 4,
        detail: `${r.distinct} distinct corner radii observed`,
        evidence: r.radii.slice(0, 8).map(v => `${v}px`),
        suggestion: r.distinct > 4 ? 'reduce to a small set of radii, e.g. 4 / 8 / full' : null,
      }));
    },
  },

  // -------------------------------------------------------------------------
  // Rules that were previously prompt-only. The skill taught 29 rules but only 7 had a
  // measurement, so 22 reached the model as advice with no evidence. Each entry below is a rule
  // where the rendered image genuinely contains the answer, so a measurement is possible — and
  // where it is NOT possible the measure returns null so the rule is reported unverified rather
  // than invented. Rules that cannot be seen in pixels at all (TY-2 on `em` units, TY-3 on font
  // choice) deliberately stay prompt-only and are listed in PROMPT_ONLY_RULES.
  // -------------------------------------------------------------------------
  {
    id: 'TY-1',
    page: 101,
    statement: 'Establish a type scale; avoid arbitrary one-off sizes.',
    source: 'prose',
    measure: ({ png, scale }) => {
      if (!png) return null;
      return typeScaleCount(png, { scale }).then(r => {
        if (!r) return null;
        return {
          ok: r.ok,
          detail: `${r.distinctHeights} distinct text heights across ${r.bandCount} text bands`,
          evidence: r.heights.slice(0, 10).map(h => `${h}px`),
          suggestion: r.ok ? null : 'consolidate to a smaller set of sizes',
        };
      });
    },
  },
  {
    id: 'TY-6',
    page: 121,
    statement: 'Line-height is proportional: looser for long lines, tighter for large text.',
    source: 'prose',
    measure: ({ png, scale }) => {
      if (!png) return null;
      return lineHeightScaling(png, { scale }).then(r => {
        if (!r) return null;
        return {
          ok: r.ok,
          detail: `larger text uses ${r.larger.ratio}x line-height vs ${r.smaller.ratio}x for smaller (glyph ${r.larger.glyph}px vs ${r.smaller.glyph}px)`,
          evidence: r.blocks.map(b => `glyph ${b.glyph}px pitch ${b.pitch}px ratio ${b.ratio}`),
          suggestion: r.ok ? null : 'tighten line-height on larger text; it should not be looser than body copy',
        };
      });
    },
  },
  {
    id: 'HI-1',
    page: 35,
    statement: 'Not all elements are equal; establish a deliberate hierarchy.',
    source: 'prose',
    measure: ({ png, scale }) => {
      if (!png) return null;
      return hierarchyContrast(png, { scale }).then(r => {
        if (!r) return null;
        return {
          ok: r.ok,
          detail: `largest : smallest text = ${r.sizeRatio}x by height, ${r.weightRatio}x by stroke weight, colour delta ${r.colourDelta} — ${r.channelsDiffering} of 3 channels differ`,
          evidence: [
            `top ${r.top.height}px relStroke ${r.top.relStroke}`,
            `bottom ${r.bottom.height}px relStroke ${r.bottom.relStroke}`,
            `sizeRatio ${r.sizeRatio} weightRatio ${r.weightRatio} colourDelta ${r.colourDelta}`,
          ],
          suggestion: r.ok ? null : 'hierarchy needs either a larger size step (>=1.25x) or a second differing channel such as weight',
        };
      });
    },
  },
  {
    id: 'HI-2',
    page: 37,
    statement: "Size isn't everything — vary weight and colour too, not just scale.",
    source: 'prose',
    measure: ({ png, scale }) => {
      if (!png) return null;
      // Uses the same measurement as HI-1 but asserts the stricter form of HI-2: strictly MORE
      // than one channel must differ, because relying on size alone is the failure the book names.
      return hierarchyContrast(png, { scale }).then(r => {
        if (!r) return null;
        return {
          ok: r.channelsDiffering >= 2,
          detail: `${r.channelsDiffering} of 3 channels differ between the strongest and weakest text (size ${r.sizeRatio}x, stroke weight ${r.weightRatio}x, colour delta ${r.colourDelta})`,
          evidence: [`sizeRatio ${r.sizeRatio}`, `weightRatio ${r.weightRatio}`, `colourDelta ${r.colourDelta}`],
          suggestion: r.channelsDiffering >= 2 ? null : 'size alone is carrying the hierarchy; add a weight or colour difference',
        };
      });
    },
  },
  {
    id: 'CO-4',
    page: 151,
    statement: "Don't let lightness kill your saturation: brightening must not desaturate into pastel.",
    source: 'figure',
    measure: ({ png }) => {
      if (!png) return null;
      return saturationSurvivesLightness(png).then(r => {
        if (!r) return null;
        const w = r.worst;
        return {
          ok: r.ok,
          detail: `hue ${w.hue}deg ramp keeps ${(w.retained * 100).toFixed(0)}% of its saturation as it lightens (S ${w.dark.s}% at L ${w.dark.l}% -> S ${w.light.s}% at L ${w.light.l}%)`,
          evidence: r.families.map(f => `hue ${f.hue}: retained ${(f.retained * 100).toFixed(0)}%`),
          suggestion: r.ok ? null : 'hold saturation while changing lightness; the book\'s own ramp keeps 129%',
        };
      });
    },
  },
  {
    id: 'DE-1',
    page: 171,
    statement: 'Emulate a single light source; light comes from above.',
    source: 'prose',
    measure: ({ png, scale }) => {
      if (!png) return null;
      return lightFromAbove(png, { scale }).then(r => {
        if (!r) return null;
        return {
          ok: r.ok,
          detail: r.detail,
          evidence: r.ok ? [] : [`${r.lighterOnTop} lighter on top`, `${r.lighterOnBottom} lighter on bottom`],
          suggestion: r.ok ? null : 'pick one light direction and apply it to every raised element',
        };
      });
    },
  },
  {
    id: 'FI-5',
    page: 237,
    statement: 'Use fewer borders: prefer a shadow, two background colours, or extra spacing.',
    source: 'prose',
    measure: ({ png, scale }) => {
      if (!png) return null;
      return borderCount(png, { scale }).then(r => {
        if (!r) return null;
        return {
          ok: r.ok,
          detail: `${r.borderRows} full-width separator rows (${r.per1000LogicalPx} per 1000 logical px)`,
          evidence: [`border rows ${r.borderRows}`],
          suggestion: r.ok ? null : 'replace some separators with spacing, a background shift, or a shadow',
        };
      });
    },
  },
  {
    id: 'HI-3',
    page: 41,
    statement: 'Do not use grey text on coloured backgrounds.',
    source: 'prose',
    measure: ({ png }) => {
      if (!png) return null;
      return noGreyTextOnColour(png).then(r => {
        if (!r) return null;
        return {
          ok: r.ok,
          detail: r.violations ? `${r.violations} neutral-grey text pixels on a coloured ground` : r.note,
          evidence: [],
          suggestion: r.ok ? null : 'tint the text toward the background hue instead of using neutral grey',
        };
      });
    },
  },
];

/**
 * Rules the skill teaches that CANNOT be judged from a rendered screen.
 *
 * Listed explicitly so the gap is documented rather than mistaken for an oversight. These stay
 * prompt-only: the reviewer is told them, and no measurement is fabricated for them.
 */
export const PROMPT_ONLY_RULES = {
  'TY-2': 'em units live in source, not pixels',
  'TY-3': 'font choice and weight availability are source facts',
  'TY-4': 'line length needs the text content, which a screenshot does not reliably give',
  'TY-5': 'baseline alignment is ambiguous to recover from a raster without glyph metrics',
  'TY-8': 'centred-text line count needs the text spans, not just their pixels',
  'TY-9': 'numeric alignment needs to know which values are numbers',
  'TY-10': 'letter-spacing needs a reference metric for the same font',
  'SP-4': 'padding-vs-container proportionality needs to know which box is the container',
  'SP-6': 'content max-width needs the viewport, which the capture already encodes',
  'HI-4': 'de-emphasis is a compositional judgement',
  'HI-5': 'whether a label is needed is a content judgement',
  'CO-7': 'colour-plus-shape redundancy needs to know the semantic meaning',
  'DE-3': 'shadow layer count is not reliably separable in a raster',
  'IM-2': 'text-over-image contrast is measurable only when text sits on imagery',
  'IM-3': 'intended asset size is a source fact',
  'FI-4': 'empty states are scenarios, not a property of one capture',
  'SP-3': 'scale non-linearity is implied by SP-2 conformance',
};

/**
 * Run every reviewable rule against a rendered screen.
 *
 * Returns findings sorted worst-first so a reviewer sees the biggest problem at the top, plus a
 * count of rules that could not be judged (reported as unverified, never as passing).
 */
export async function reviewScreen(png, { scale = 1, gaps } = {}) {
  const measuredGaps = gaps ?? await verticalGaps(png, scale);
  const ctx = { png, scale, gaps: measuredGaps };
  const findings = [];
  const unverifiedIds = [];
  let unverified = 0;

  for (const rule of REVIEW_RULES) {
    let res;
    try {
      res = await rule.measure(ctx);
    } catch (e) {
      res = { ok: null, detail: `measurement failed: ${e.message}`, evidence: [] };
    }
    // A rule returning null, or a measure that threw, is UNVERIFIED — recorded by id so the
    // reviewer can mark it unverified rather than assume it passed, and never counted as a
    // failure. The ids matter: `unverified` used to be a bare count, so the caller could not
    // tell WHICH rule was unjudgeable.
    if (!res || res.ok === null) {
      unverified++;
      unverifiedIds.push(rule.id);
      continue;
    }
    findings.push({ id: rule.id, page: rule.page, statement: rule.statement, source: rule.source, ...res });
  }

  const failed = findings.filter(f => !f.ok);
  return {
    gaps: measuredGaps,
    scale: SPACING_SCALE,
    findings,
    failed,
    unverified,
    unverifiedIds,
    summary: failed.length === 0
      ? `all ${findings.length} reviewable rules pass${unverified ? `, ${unverified} could not be judged from this render (${unverifiedIds.join(', ')})` : ''}`
      : `${failed.length} of ${findings.length} reviewable rules fail: ${failed.map(f => f.id).join(', ')}${unverified ? `; ${unverified} could not be judged (${unverifiedIds.join(', ')})` : ''}`,
  };
}

/** Render a review as a short human-readable report. */
export function formatReview(review) {
  const lines = [];
  lines.push(review.summary);
  for (const f of review.failed) {
    lines.push(`  FAIL ${f.id} (p.${f.page}) — ${f.statement}`);
    lines.push(`       ${f.detail}`);
    if (f.evidence?.length) lines.push(`       evidence: ${f.evidence.join('; ')}`);
    if (f.suggestion) lines.push(`       fix: ${f.suggestion}`);
  }
  return lines.join('\n');
}
