import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {prepareReference} from '../src/reference.mjs';
import {fixture} from './helpers.mjs';
import {json,writeJSON,git,killTree} from '../src/util.mjs';
import {run,Session} from '../src/runner.mjs';
import {aggregateJudgments} from '../src/evaluation.mjs';
import {calibrate} from '../src/calibration.mjs';

test('evaluation uses conservative scores and blocks unstable judgments',()=>{
  const a={visualQuality:90,fidelity:95,blocking:false,findings:[],rationale:'Observed'},b={...a,visualQuality:80,fidelity:91};
  const result=aggregateJudgments([a,b]);assert.equal(result.visualQuality,80);assert.equal(result.fidelity,91);assert.equal(result.blocking,false);
  assert.equal(aggregateJudgments([a,{...b,fidelity:60}]).blocking,true);
});

test('required component cycle continues after early quality success',async()=>{
  const {root,config}=await fixture();
  Object.assign(config.acceptance,{visualQuality:60,fidelity:60,requireComponentCycle:true});
  await writeJSON(path.join(root,'uih.json'),config);await git(root,'add','uih.json');await git(root,'commit','-m','require real component reviews');
  const state=await run(root);assert.equal(state.status,'passed',state.error);
  assert.deepEqual(state.history.map(h=>h.component),['screen','hero','screen']);
  assert.ok(state.history[1].localAfter);assert.ok(state.history[1].evaluation);
});

test('blocked candidates are repaired globally before the complete local cycle',async()=>{
  const {root,config}=await fixture();
  config.budgets.maxIterations=4;
  config.acceptance.requireComponentCycle=true;
  config.roles.judge.options.blockIndices=[0,1];
  config.roles.builder.options.requireRejectedProposal=true;
  await writeJSON(path.join(root,'uih.json'),config);await git(root,'add','uih.json');await git(root,'commit','-m','blocking screen fixture');
  const state=await run(root);
  assert.equal(state.status,'passed',state.error);
  assert.deepEqual(state.history.map(h=>h.component),['screen','screen','hero','screen']);
  assert.equal(state.history[0].accepted,false);
  assert.equal(state.history[1].accepted,true);
  assert.equal(state.iterations,4);
  assert.equal(state.bestEvaluation.blocking,false);
});

test('missing candidate content requests diagnostic rejection but infrastructure errors stop',async()=>{
  const s=new Session('', '',{config:{runtime:{plugin:'metro-android'}}},{},[]);
  s.call=async()=>{throw new Error('Command failed (1): node\nExpected screen content missing\n');};
  const result=await s.checks();assert.equal(result.passed,false);assert.equal(result.captureDiagnostic,true);
  s.call=async()=>{throw new Error('Android device unavailable');};
  await assert.rejects(s.checks(),/device unavailable/);
});
test('calibration checks hidden expected rankings and repeated stability',async()=>{
  const {root,images}=await fixture();await fs.writeFile(path.join(root,'reference.png'),Buffer.from(images[3],'base64'));await fs.writeFile(path.join(root,'bad.png'),Buffer.from(images[0],'base64'));
  const suite={reference:'reference.png',cases:[{id:'good',image:'reference.png'},{id:'bad',image:'bad.png'}],rankings:[{better:'good',worse:'bad',metric:'fidelity',minMargin:20}]};
  await writeJSON(path.join(root,'calibration.json'),suite);
  const result=await calibrate(root,path.join(root,'calibration.json'),{repeats:2,maxCalls:4});assert.equal(result.status,'passed',result.error);assert.equal(result.calls,4);assert.equal(result.rankings[0].observedConservativeMargin,55);assert.equal(result.humanReviewed,false);
  const limited=await calibrate(root,path.join(root,'calibration.json'),{repeats:2,maxCalls:1});assert.equal(limited.status,'failed');assert.equal(limited.calls,1);
});

test('native mockup dimensions are uniformly mapped and original is preserved',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'uih-reference-'));
  const source=path.join(dir,'native.png'),target=path.join(dir,'approved.png');
  await sharp({create:{width:1254,height:1254,channels:3,background:'#334455'}}).png().toFile(source);
  const manifest=await prepareReference(source,target,{width:1024,height:1024});
  assert.equal(manifest.fit,'uniform-scale');assert.equal(manifest.transform.cropped,false);assert.equal(manifest.target.width,1024);
  assert.deepEqual(await fs.readFile(source),await fs.readFile(target+'.original.png'));
  assert.equal((await sharp(target).metadata()).width,1024);
  await assert.rejects(prepareReference(source,path.join(dir,'portrait.png'),{width:360,height:640}),/aspect ratio/);
  await assert.rejects(prepareReference(source,path.join(dir,'strict.png'),{width:1024,height:1024},'strict'),/identical/);
  const contained=await prepareReference(source,path.join(dir,'contain.png'),{width:360,height:640},'contain');
  assert.equal(contained.transform.offsetY,140);
});
test('stale runtime screenshot cannot pass a baseline',async()=>{
  const {root,config}=await fixture();config.runtime.options.staleRevision=true;
  await writeJSON(path.join(root,'uih.json'),config);await git(root,'add','uih.json');await git(root,'commit','-m','stale device fixture');
  const state=await run(root);assert.equal(state.status,'failed');assert.match(state.error,/revision evidence mismatch/);assert.equal(state.bestEvaluation,undefined);
});
test('hard-killed coordinator restores source and preserves budget on resume',{timeout:60000},async()=>{
  const {root,config}=await fixture();config.roles.builder.options.crashPauseOnce=true;
  await writeJSON(path.join(root,'uih.json'),config);await git(root,'add','uih.json');await git(root,'commit','-m','crash injection');
  const cli=fileURLToPath(new URL('../bin/uih.mjs',import.meta.url));
  const child=spawn(process.execPath,[cli,'run','--project',root],{stdio:'ignore',windowsHide:true,detached:process.platform!=='win32'});
  const closed=new Promise(resolve=>child.once('close',resolve));
  let state,dir,worker;
  try{
    const deadline=Date.now()+25000;
    while(Date.now()<deadline){
      try{const names=await fs.readdir(path.join(root,'.uih/runs'));dir=path.join(root,'.uih/runs',names[0]);state=await json(path.join(dir,'state.json'));if(await fs.readFile(path.join(state.workspace,'.uih/crash-injected'),'utf8'))break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(state?.workspace);assert.equal(await fs.readFile(path.join(state.workspace,'src/Home.tsx'),'utf8'),'partial write during interrupted plugin\n');
    worker=Number(await fs.readFile(path.join(state.workspace,'.uih/crash-injected'),'utf8'));
  }finally{child.kill('SIGKILL');await closed;}
  // Kill only the coordinator: its plugin watchdog must clean up independently.
  let alive=true;
  for(let i=0;i<50;i++){try{process.kill(worker,0);}catch(e){if(e.code==='ESRCH'){alive=false;break;}throw e;}await new Promise(resolve=>setTimeout(resolve,100));}
  if(alive)killTree({pid:worker});
  assert.equal(alive,false,'orphaned plugin should terminate after parent crash');
  const before=await json(path.join(dir,'state.json'));
  const resumed=await run(root,{maxIterations:5,maxCalls:100},before.id);
  assert.equal(resumed.status,'passed',resumed.error);assert.ok(resumed.calls>before.calls);assert.ok(resumed.iterations>before.iterations);
  assert.match(await fs.readFile(path.join(resumed.workspace,'src/Home.tsx'),'utf8'),/value = 3/);
  assert.match(await fs.readFile(path.join(root,'src/Home.tsx'),'utf8'),/value = 0/);
});
