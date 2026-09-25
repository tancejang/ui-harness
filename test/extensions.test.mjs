import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers.mjs';
import { command, json, writeJSON } from '../src/util.mjs';
import { install, loadExtensions, skillContext, invoke } from '../src/extensions.mjs';
import { generateCandidates } from '../src/design.mjs';
import { run } from '../src/runner.mjs';

test('design candidates are critiqued and remain unapproved', async () => {
  const { root, config } = await fixture();
  const output = path.join(root, 'draft.png');
  const record = await generateCandidates(root, config, { brief: 'Create a polished home', output, count: 2, maxUSD: 1 });
  assert.equal(record.status, 'needs-review'); assert.equal(record.approved, false);
  assert.equal(record.candidates.length, 2); assert.ok(Math.abs(record.reservedUSD - 0.4) < 0.00001);
  assert.equal((await fs.readFile(output)).toString('base64'), config.runtime.options.images[3]);
});
test('design budget charges interrupted work and does not fabricate a selected result', async () => {
  const { root, config } = await fixture();
  const output = path.join(root, 'budget.png');
  await assert.rejects(generateCandidates(root, config, { brief: 'Home', output, count: 2, maxUSD: 0.1 }), /budget/);
  const record = await json(output + '.design.json');
  assert.equal(record.status, 'failed'); assert.equal(record.reservedUSD, 0.1);
  await assert.rejects(fs.access(output));
});
test('skill installation pins resources and makes instructions available', async () => {
  const { root } = await fixture();
  await install(root, 'skill', fileURLToPath(new URL('../skills/visual-quality', import.meta.url)));
  const skills = await skillContext(root, await loadExtensions(root));
  assert.equal(skills[0].name, 'visual-quality');
  assert.match(skills[0].resources['SKILL.md'], /fidelity independently/);
});
test('project lock refuses concurrent execution', async () => {
  const { root } = await fixture();
  await writeJSON(path.join(root, '.uih/run.lock'), { pid: process.pid });
  await assert.rejects(run(root), /already running/);
});
test('command runtime captures fresh output and check failures are explicit', async () => {
  const { root, images } = await fixture();
  await install(root, 'plugin', fileURLToPath(new URL('../plugins/command-runtime', import.meta.url)));
  const script = `const fs=require('fs');fs.writeFileSync(process.argv[1],Buffer.from(process.argv[3],'base64'));fs.writeFileSync(process.argv[2],JSON.stringify({stateEvidence:'Home label observed'}));`;
  const provider = { plugin: 'command-runtime', options: {
    capture: [[process.execPath, '-e', script, '{screenshot}', '{evidence}', images[0]]],
    checks: [{ name: 'broken behavior', command: [process.execPath, '-e', 'process.exit(1)'] }]
  } };
  const lock = await loadExtensions(root);
  const capture = await invoke(root, lock, provider, 'capture', { workspace: root }, 5000);
  assert.equal(capture.pngBase64, images[0]);
  const checks = await invoke(root, lock, provider, 'check', { workspace: root }, 5000);
  assert.equal(checks.passed, false);
});
test('CLI rejects unknown flags and invalid initialization platforms', async () => {
  const cli = fileURLToPath(new URL('../bin/uih.mjs', import.meta.url));
  await assert.rejects(command([process.execPath, cli, 'run', '--budegt-usd', '1']), /Unknown option/);
  const { root } = await fixture();
  const empty = path.join(root, 'empty'); await fs.mkdir(empty);
  await assert.rejects(command([process.execPath, cli, 'init', '--project', empty, '--platform', 'unknown']), /Unsupported platform/);
  await assert.rejects(fs.access(path.join(empty, 'uih.json')));
});
