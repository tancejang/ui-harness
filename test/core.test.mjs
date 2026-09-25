import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.mjs';
import { run } from '../src/runner.mjs';
import { inside, hash, json, writeJSON, git, command } from '../src/util.mjs';
import { applyEdits } from '../src/project.mjs';
import { loadExtensions } from '../src/extensions.mjs';
import { accepted, validatePlan, validateEvaluation } from '../src/visual.mjs';

test('hierarchical loop accepts improvement, rolls back regression, preserves original and exports patch', async () => {
  const { root } = await fixture();
  const state = await run(root);
  assert.equal(state.status, 'passed', state.error);
  assert.deepEqual(state.history.map(h => h.accepted), [true, false, true]);
  assert.deepEqual(state.history.map(h => h.component), ['screen', 'hero', 'screen']);
  assert.equal(state.bestEvaluation.fidelity, 95);
  assert.match(await fs.readFile(path.join(root, 'src/Home.tsx'), 'utf8'), /value = 0/);
  assert.match(await fs.readFile(path.join(state.workspace, 'src/Home.tsx'), 'utf8'), /value = 3/);
  const dir = path.dirname(state.workspace);
  assert.match(await fs.readFile(path.join(dir, 'changes.patch'), 'utf8'), /value = 3/);
  assert.match(await fs.readFile(path.join(dir, 'report.html'), 'utf8'), /Rejected/);
  assert.ok((await fs.stat(path.join(dir, 'reference-hero.png'))).size > 0);
});
test('budget is persisted before call and resume retains reservations', async () => {
  const { root } = await fixture();
  const state = await run(root, { maxUSD: 0.1 });
  assert.equal(state.status, 'budget-limit');
  assert.equal(state.reservedUSD, 0.1);
  assert.ok(state.plan);
  const resumed = await run(root, { maxUSD: 20 }, state.id);
  assert.equal(resumed.status, 'passed', resumed.error);
  assert.ok(resumed.reservedUSD > state.reservedUSD);
});
test('reference tampering prevents resume', async () => {
  const { root } = await fixture();
  const state = await run(root, { maxUSD: 0.1 });
  await fs.writeFile(path.join(path.dirname(state.workspace), 'reference.png'), 'tampered');
  const resumed = await run(root, { maxUSD: 20 }, state.id);
  assert.equal(resumed.status, 'failed'); assert.match(resumed.error, /reference was modified/);
});
test('extension integrity failure is detected', async () => {
  const { root } = await fixture();
  const lock = await loadExtensions(root);
  await fs.appendFile(path.join(root, lock.plugins.fixture.path, 'index.mjs'), '\n//tamper');
  await assert.rejects(loadExtensions(root), /integrity/);
});
test('edits are prevalidated atomically for stale content and ownership', async () => {
  const { root, config } = await fixture();
  const source = await fs.readFile(path.join(root, 'src/Home.tsx'), 'utf8');
  await assert.rejects(applyEdits(root, config, [{ path:'src/Home.tsx', beforeSha256:'wrong', content:'bad' }]), /Stale/);
  await assert.rejects(applyEdits(root, config, [{ path:'src/Home.tsx', beforeSha256:hash(source), content:'bad' }], ['src/Other.tsx']), /ownership/);
  assert.equal(await fs.readFile(path.join(root, 'src/Home.tsx'), 'utf8'), source);
});
test('paths cannot escape roots and quality cannot compensate for lost fidelity', () => {
  for (const name of ['../outside', '/absolute', 'C:/escape', '..\\outside']) assert.throws(() => inside('root', name));
  assert.equal(accepted({ visualQuality: 70, fidelity: 80 }, { visualQuality: 95, fidelity: 79, blocking: false }, { minImprovement: 1 }), false);
  assert.throws(() => validateEvaluation({ visualQuality: NaN, fidelity: 90 }), /Invalid/);
});
test('failed functional baseline never receives a passing judgment', async () => {
  const { root, config } = await fixture();
  config.runtime.options.failChecks = true;
  await writeJSON(path.join(root, 'uih.json'), config);
  await git(root, 'add', 'uih.json'); await git(root, 'commit', '-m', 'failing checks');
  const state = await run(root);
  assert.equal(state.status, 'failed'); assert.match(state.error, /Baseline functional/);
  assert.equal(state.bestEvaluation, undefined);
});
test('failed provider retains reservation and source checkpoint', async () => {
  const { root, config } = await fixture();
  config.roles.builder.options.failOperation = 'build';
  await writeJSON(path.join(root, 'uih.json'), config);
  await git(root, 'add', 'uih.json'); await git(root, 'commit', '-m', 'failing builder');
  const state = await run(root);
  assert.equal(state.status, 'failed'); assert.match(state.error, /Injected plugin failure/);
  assert.ok(state.reservedUSD >= 0.4);
  assert.match(await fs.readFile(path.join(state.workspace, 'src/Home.tsx'), 'utf8'), /value = 0/);
});
test('subprocess timeout is enforced', async () => {
  await assert.rejects(command([process.execPath, '-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 100 }), /timed out/);
});
test('planner rejects invented ownership and out-of-bounds crops', () => {
  const config = { scenario: { width: 8, height: 8 } };
  const project = { files: [{ path: 'src/A.tsx', editable: true }] };
  const component = { id: 'a', files: ['src/Missing.tsx'], region: { left:0, top:0, width:8, height:8 }, constraints:'layout' };
  assert.throws(() => validatePlan({ components: [component] }, project, config), /ownership/);
  component.files = ['src/A.tsx']; component.region.width = 9;
  assert.throws(() => validatePlan({ components: [component] }, project, config), /region/);
});
