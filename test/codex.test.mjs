import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { command, json } from '../src/util.mjs';
import { oauthEnvironment } from '../plugins/codex/process.mjs';
import { fixture } from './helpers.mjs';
import { run } from '../src/runner.mjs';
import { generateCandidates } from '../src/design.mjs';
import { defaults } from '../src/config.mjs';

const plugin = fileURLToPath(new URL('../plugins/codex/index.mjs', import.meta.url));
const fake = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
async function call(operation, mode='success', extra={}) {
  const request = { protocol:1, operation, ...extra, options:{ command:[process.execPath, fake, `--mode=${mode}`, `--png=${extra.png ?? ''}`] } };
  const raw = await command([process.execPath, plugin], { input:JSON.stringify(request), env:{ OPENAI_API_KEY:'must-not-reach-codex', CODEX_API_KEY:'must-not-reach-codex', CODEX_ACCESS_TOKEN:'must-not-reach-codex' } });
  return JSON.parse(raw).result;
}
test('all default model roles use saved Codex OAuth and zero dollar reservations', () => {
  for (const role of Object.values(defaults.roles)) { assert.equal(role.plugin,'codex'); assert.equal(role.reserveUSD,0); }
  assert.equal(defaults.budgets.maxCalls,100);
  assert.deepEqual(oauthEnvironment({ OPENAI_API_KEY:'x', CODEX_API_KEY:'x', CODEX_ACCESS_TOKEN:'x', CODEX_HOME:'keep', Path:'keep' }), { CODEX_HOME:'keep', Path:'keep' });
});
test('Codex auth checks reject API login without starting a model turn', async () => {
  assert.equal((await call('auth-status')).authenticated,true);
  assert.equal((await call('auth-status','api-login')).authenticated,false);
  await assert.rejects(call('judge','api-login'), /does not accept API-key/);
});
test('Codex adapter attaches image files, enforces schema and returns usage', async () => {
  const { images } = await fixture();
  const value = await call('judge','success',{ images:{ reference:{mimeType:'image/png',base64:images[0]}, actual:{mimeType:'image/png',base64:images[1]} } });
  assert.equal(value.fidelity,91); assert.equal(value.authMethod,'chatgpt'); assert.equal(value.usage.output_tokens,20);
});
test('Codex errors and incomplete responses never fabricate success', async () => {
  await assert.rejects(call('judge','turn-failed'), /turn failed/);
  await assert.rejects(call('judge','incomplete'), /no completed turn/);
  await assert.rejects(call('judge','missing-result'), /no valid structured/);
});
test('Codex generation reads a real PNG artifact and has no API fallback', async () => {
  const { images } = await fixture();
  const value = await call('generate','success',{ png:images[0],brief:'Home' });
  assert.equal(value.pngBase64,images[0]);
  await assert.rejects(call('generate','no-image',{ brief:'Home' }), /Tool unavailable/);
  await assert.rejects(call('generate','stale-image',{png:images[0],brief:'Home'}),/predates this turn/);
});
test('run call budgets persist across resume', async () => {
  const { root } = await fixture();
  const state = await run(root,{maxCalls:1});
  assert.equal(state.status,'budget-limit'); assert.equal(state.calls,1);
  const again = await run(root,{},state.id);
  assert.equal(again.calls,1); assert.equal(again.status,'budget-limit');
  const resumed = await run(root,{maxCalls:100},state.id);
  assert.equal(resumed.status,'passed',resumed.error);
});
test('design call budget counts generation before attempting critique', async () => {
  const { root,config } = await fixture();
  const output = path.join(root,'limited.png');
  await assert.rejects(generateCandidates(root,config,{brief:'Home',output,maxCalls:1}),/budget exhausted/);
  const ledger = await json(output+'.design.json');
  assert.equal(ledger.calls,1); assert.equal(ledger.status,'failed');
});
