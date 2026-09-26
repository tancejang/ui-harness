// Verify the design-knowledge bridge end to end.
//
// This is the test that would have caught the gap: it asserts that a rendered candidate actually
// produces designFindings that reach a review request, so the knowledge base cannot silently
// become disconnected from the runtime again.
//
// Run: node --test test/design-bridge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { cleanSpec, renderSpec, RENDER_SCALE } from '../bench/fixture.mjs';
import { designFindingsFor, scaleFromCapture } from '../bench/design-findings.mjs';
import { REVIEW_RULES } from '../bench/review-knowledge.mjs';

test('a compliant render yields no failing design findings', async () => {
  const png = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uih-bridge-'));
  const file = path.join(dir, 'candidate.png');
  await fs.writeFile(file, png);

  const res = await designFindingsFor({ imagePath: file, scale: RENDER_SCALE });
  assert.equal(res.findings.length, 0, `unexpected findings: ${JSON.stringify(res.findings)}`);
  assert.ok(res.rulesChecked > 0, 'rules must actually be evaluated, not skipped');
  assert.match(res.summary, /all pass/);
});

test('an off-scale layout produces a cited SP-2 finding', async () => {
  const spec = cleanSpec();
  // Introduce a 20px gap, which is not on Refactoring UI's scale.
  const shiftFrom = (y0, dy) => { for (const p of spec.prims) if (p.box[1] >= y0) p.box[1] += dy; };
  shiftFrom(430, 4);
  const png = await renderSpec(spec, { scale: RENDER_SCALE });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uih-bridge-'));
  const file = path.join(dir, 'candidate.png');
  await fs.writeFile(file, png);

  const res = await designFindingsFor({ imagePath: file, scale: RENDER_SCALE });
  const sp2 = res.findings.find(f => f.rule === 'SP-2');
  assert.ok(sp2, `SP-2 not reported; got ${res.findings.map(f => f.rule).join(', ') || 'nothing'}`);
  assert.equal(sp2.page, 73);
  assert.ok(sp2.evidence.length > 0, 'a finding must carry measured evidence');
  assert.ok(sp2.suggestedFix, 'a finding must carry an actionable fix');
  // Every finding must be citable: an id, a page, and a measurement.
  for (const f of res.findings) {
    assert.ok(f.rule && Number.isInteger(f.page) && f.measured, `finding ${f.rule} is not citable`);
  }
});

test('a broken image path degrades to a note instead of throwing', async () => {
  const res = await designFindingsFor({ imagePath: path.join(os.tmpdir(), 'does-not-exist-xyz.png') });
  assert.equal(res.findings.length, 0);
  assert.match(res.summary, /not readable|not evaluated/);
});

test('a corrupt image degrades to a note instead of failing the run', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uih-bridge-'));
  const file = path.join(dir, 'corrupt.png');
  await fs.writeFile(file, 'this is not a png');
  const res = await designFindingsFor({ imagePath: file, scale: 1 });
  assert.equal(res.findings.length, 0);
  assert.match(res.summary, /could not be evaluated/);
});

test('scaleFromCapture prefers the runtime reported pixelRatio', () => {
  assert.equal(scaleFromCapture({ pixelRatio: 3 }, { width: 100 }), 3);
  assert.equal(scaleFromCapture({ width: 1080 }, { width: 360 }), 3);
  assert.equal(scaleFromCapture({}, {}), 1);
  assert.equal(scaleFromCapture(null, null), 1);
});

test('every reviewable rule is citable and has a measure function', () => {
  assert.ok(REVIEW_RULES.length >= 5);
  for (const r of REVIEW_RULES) {
    assert.match(r.id, /^[A-Z]{2}-\d+$/, `bad rule id: ${r.id}`);
    assert.ok(Number.isInteger(r.page) && r.page > 0, `${r.id} has no source page`);
    assert.ok(r.statement?.length > 10, `${r.id} has no statement`);
    assert.equal(typeof r.measure, 'function', `${r.id} has no measure()`);
    assert.ok(['prose', 'figure'].includes(r.source), `${r.id} does not declare its source`);
  }
});

/**
 * THE GAP THIS FILE EXISTS TO PREVENT.
 *
 * The rules were previously unreachable from a live run: `bench/` and `src/` had no connection at
 * all, so enriching the rubric could not change any review. This asserts the wiring is present in
 * the runner source, so removing it fails a test rather than quietly reverting to an ungrounded
 * reviewer.
 */
test('REGRESSION: the runner actually loads and sends design findings', async () => {
  const runner = await fs.readFile(new URL('../src/runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /designFindingsFor/, 'src/runner.mjs must import the design-findings bridge');
  assert.match(runner, /designFindings/, 'the review request must carry designFindings');
  const contracts = await fs.readFile(new URL('../plugins/codex/contracts.mjs', import.meta.url), 'utf8');
  assert.match(contracts, /designFindings/, 'the reviewer prompt must describe the field');
  const skill = await fs.readFile(new URL('../skills/visual-quality/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /SP-2 \(p\.73\)/, 'the installed skill must carry the sourced spacing rule');
  assert.match(skill, /4\.5:1/, 'the installed skill must carry the measured contrast threshold');
});
