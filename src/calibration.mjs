import fs from 'node:fs/promises';
import path from 'node:path';
import {loadConfig} from './config.mjs';
import {loadExtensions,invoke,skillContext} from './extensions.mjs';
import {json,writeJSON,inside,hash} from './util.mjs';
import {imageInput,validateImage,validateEvaluation} from './visual.mjs';
import {aggregateJudgments} from './evaluation.mjs';

export async function calibrate(root,suitePath,{repeats=3,maxCalls=30,maxMinutes=20}={}) {
  if(!Number.isInteger(repeats)||repeats<2||repeats>10||!Number.isInteger(maxCalls)||maxCalls<1||!Number.isFinite(maxMinutes)||maxMinutes<=0)throw new Error('Invalid calibration limits');
  const cfg=await loadConfig(root),lock=await loadExtensions(root),skills=await skillContext(root,lock);
  const suite=await json(suitePath),base=path.dirname(path.resolve(suitePath));
  if(!Array.isArray(suite.cases)||suite.cases.length<2||!Array.isArray(suite.rankings)||!suite.rankings.length)throw new Error('Calibration requires cases and predeclared rankings');
  if(suite.cases.some(c=>!/^[a-z][a-z0-9-]*$/.test(c.id))||new Set(suite.cases.map(c=>c.id)).size!==suite.cases.length)throw new Error('Invalid or duplicate case ids');
  for(const pair of suite.rankings)if(!suite.cases.some(c=>c.id===pair.better)||!suite.cases.some(c=>c.id===pair.worse)||!['fidelity','visualQuality'].includes(pair.metric)||!Number.isFinite(pair.minMargin)||pair.minMargin<0)throw new Error('Invalid expected ranking');
  const dir=path.join(root,'.uih','calibration',new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(dir,{recursive:true});
  const record={version:1,status:'running',calls:0,startedAt:new Date().toISOString(),suiteHash:hash(JSON.stringify(suite)),extensions:lock,results:{},rankings:[],humanReviewed:suite.humanReviewed===true};
  const save=()=>writeJSON(path.join(dir,'result.json'),record);
  const reference=inside(base,suite.reference);await validateImage(reference,cfg.scenario);
  const images={reference:await imageInput(reference)},frozenCases=new Map();const start=Date.now();
  await fs.copyFile(reference,path.join(dir,'reference.png'));
  record.imageHashes={reference:hash(await fs.readFile(reference))};
  for(const item of suite.cases){
    const file=inside(base,item.image);await validateImage(file,cfg.scenario);
    const bytes=await fs.readFile(file);record.imageHashes[item.id]=hash(bytes);
    await fs.writeFile(path.join(dir,'case-'+item.id+'.png'),bytes);
    frozenCases.set(item.id,{mimeType:'image/png',base64:bytes.toString('base64')});
  }
  await writeJSON(path.join(dir,'suite.json'),suite);
  try{
    for(let repeat=0;repeat<repeats;repeat++){
      // Reverse case order on alternate passes. Do not reveal case ids or expected ranking to judge.
      const cases=repeat%2?[...suite.cases].reverse():suite.cases;
      for(const item of cases){
        if(record.calls>=maxCalls||Date.now()-start>=maxMinutes*60000)throw new Error('Calibration budget exhausted');
        record.calls++;await save();
        const result=validateEvaluation(await invoke(root,lock,cfg.roles.judge,'judge',{scenario:cfg.scenario,skills,scope:'screen',images:{...images,actual:frozenCases.get(item.id)}},Math.min(cfg.budgets.callTimeoutSeconds*1000,maxMinutes*60000-(Date.now()-start))));
        (record.results[item.id]??=[]).push(result);await save();
      }
    }
    for(const pair of suite.rankings){
      const better=record.results[pair.better].map(x=>x[pair.metric]);const worse=record.results[pair.worse].map(x=>x[pair.metric]);
      const margin=Math.min(...better)-Math.max(...worse);
      record.rankings.push({...pair,observedConservativeMargin:margin,passed:margin>=pair.minMargin});
    }
    record.stability=Object.fromEntries(Object.entries(record.results).map(([id,samples])=>[id,aggregateJudgments(samples,cfg.acceptance.maxJudgeSpread??12)]));
    record.status=record.rankings.every(x=>x.passed)&&Object.values(record.stability).every(x=>!Object.values(x.spread).some(s=>s>(cfg.acceptance.maxJudgeSpread??12)))?'passed':'failed';
    record.note=record.humanReviewed?'Predeclared human-reviewed labels were supplied; verify their provenance separately.':'Automated known-perturbation calibration only. This is not human aesthetic validation or a Codex-app benchmark.';
  }catch(e){record.status='failed';record.error=e.message;}finally{record.elapsedMs=Date.now()-start;await save();}
  return {...record,report:path.join(dir,'result.json')};
}
