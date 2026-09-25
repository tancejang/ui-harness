import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from './helpers.mjs';
import {run,verify} from '../src/runner.mjs';
import {approvalStatus} from '../src/provenance.mjs';
import {git,writeJSON,command} from '../src/util.mjs';

test('high scores cannot complete a run with an unresolved major discrepancy',async()=>{
  const {root,config}=await fixture();
  config.roles.critic.options.openIssue=true;
  config.roles.judge.options.openIssue=true;
  await writeJSON(path.join(root,'uih.json'),config);await git(root,'add','uih.json');await git(root,'commit','-m','persistent mismatch');
  const s=await run(root);
  assert.notEqual(s.status,'passed');
  assert.ok(s.issues.some(i=>i.key==='hero-proportions'&&i.status==='open'));
});

test('review invalidates passing status after source changes outside model context',async()=>{
  const {root}=await fixture();
  await fs.writeFile(path.join(root,'layout.css'),'body { padding: 10px; }');
  await git(root,'add','layout.css');await git(root,'commit','-m','source outside prompt inventory');
  const s=await run(root);assert.equal(s.status,'passed',s.error);
  await fs.writeFile(path.join(s.workspace,'layout.css'),'body { padding: 99px; }');
  const cli=fileURLToPath(new URL('../bin/uih.mjs',import.meta.url));
  const output=JSON.parse(await command([process.execPath,cli,'review',s.id,'--project',root]));
  assert.equal(output.status,'stale');
  assert.equal(output.deliveryReady,false);
  const audited=await verify(root,s.id,s.workspace);
  assert.equal(audited.status,'passed',audited.error);
  assert.equal(await fs.readFile(path.join(s.workspace,'layout.css'),'utf8'),'body { padding: 99px; }');
  assert.ok(audited.finalReview.image.includes('verifications'));
  assert.equal((await approvalStatus(audited)).deliveryReady,true);
  await fs.appendFile(audited.finalReview.image.replace(/\.png$/,'.capture.json'),' ');
  assert.equal((await approvalStatus(audited)).status,'stale');
});
