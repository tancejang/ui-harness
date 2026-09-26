// Bridge between the design knowledge base and a live UIH run.
//
// The reviewer prompt is built in src/runner.mjs `review()`. Before this module existed there was
// no path from the sourced design rules to a running review at all: the rubric lived in docs/,
// the rules in bench/, and the two never met the coordinator. This produces the `designFindings`
// array that `review()` attaches to every critic and judge request.
//
// Design constraints:
//  - It must never invent a number. If a rule cannot be measured from the supplied capture, the
//    rule is reported as unverified rather than guessed.
//  - It must never throw into the run. A measurement failure degrades to "unverified"; a broken
//    design checker should not fail a refinement run.
//  - It must stay small: the findings ride in every model request, so it carries ids, values and
//    short evidence, not prose.

import fs from 'node:fs/promises';
import { reviewScreen } from './review-knowledge.mjs';

/**
 * Build design findings for one rendered capture.
 *
 * @param {object} opts
 * @param {string} opts.imagePath   path to the rendered candidate PNG
 * @param {number} [opts.scale=1]   pixels per logical unit (device pixel ratio, or 1)
 * @param {object} [opts.scenario]  the run's scenario, for its expected width/height
 * @returns {Promise<object>} { findings, unverified, summary, rulesChecked }
 */
export async function designFindingsFor({ imagePath, scale = 1, scenario } = {}) {
  const out = { findings: [], unverified: [], summary: '', rulesChecked: 0 };
  if (!imagePath) return { ...out, summary: 'no capture supplied; design rules not evaluated' };

  try {
    await fs.access(imagePath);
  } catch {
    return { ...out, summary: `capture ${imagePath} not readable; design rules not evaluated` };
  }

  let review;
  try {
    review = await reviewScreen(imagePath, { scale });
  } catch (e) {
    // A checker failure must not fail the run.
    return { ...out, summary: `design rules could not be evaluated: ${e.message}` };
  }

  out.rulesChecked = review.findings.length + review.unverified;

  // Report only failures plus a compact pass summary. Sending every passing rule would bloat the
  // request and bury the actionable ones.
  for (const f of review.failed) {
    out.findings.push({
      rule: f.id,
      page: f.page,
      statement: f.statement,
      measured: f.detail,
      evidence: (f.evidence ?? []).slice(0, 6),
      suggestedFix: f.suggestion ?? null,
      source: f.source,          // 'figure' means the threshold came from the book's figures
    });
  }

  // A rule that genuinely could not be judged is surfaced by ID so the reviewer can mark it
  // unverified rather than silently assuming it passed. This reads `unverifiedIds` from the
  // review, not a filtered list of findings — an earlier version looked for `ok === null` inside
  // `findings`, but unverified rules are never pushed there, so it always reported an empty list.
  out.unverified = review.unverifiedIds ?? [];

  const measuredGaps = (review.gaps ?? []).map(g => Number(g.toFixed(1)));
  out.summary = review.failed.length === 0
    ? `${review.findings.length} design rules evaluated, all pass${review.unverified ? `, ${review.unverified} not judgeable from this render` : ''}`
    : `${review.failed.length} of ${review.findings.length} design rules fail: ${review.failed.map(f => f.id).join(', ')}`;
  out.measuredGaps = measuredGaps;
  out.spacingScale = review.scale;

  return out;
}

/**
 * Estimate the pixel scale of a capture.
 *
 * UIH captures are in physical pixels while the design rules reason in logical units, and a
 * mobile capture is typically 2-3x. We take the ratio of the capture's width to the scenario's
 * declared logical width when both are known, which is exactly what the runtime reports as
 * `pixelRatio` when it can. Falls back to 1 so the rules still run, conservatively.
 */
export function scaleFromCapture(capture, scenario) {
  if (Number.isFinite(capture?.pixelRatio) && capture.pixelRatio > 0) return capture.pixelRatio;
  if (scenario?.width && capture?.width) return capture.width / scenario.width;
  return 1;
}
