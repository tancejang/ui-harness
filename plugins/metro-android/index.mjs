// Managed Expo/Metro + Android adapter. Fresh source proof and interaction evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {readFreshHierarchy} from './hierarchy.mjs';

const r=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>resolve(s));}));
const o=r.options;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let metro, deviceLock, lockToken, reversePort;
async function exec(argv,binary=false) {
  return new Promise((resolve,reject)=>{
    const p=spawn(argv[0],argv.slice(1),{cwd:r.workspace,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let stdout=[],stderr='',size=0;
    const timer=setTimeout(()=>{p.kill();reject(new Error(`Command timeout: ${argv[0]}`));},30000);
    p.stdout.on('data',b=>{size+=b.length;if(size>24*1024*1024){p.kill();reject(new Error('Command output too large'));}else stdout.push(b);});
    p.stderr.on('data',b=>stderr=(stderr+b).slice(-2000));
    p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);code===0?resolve(binary?Buffer.concat(stdout):Buffer.concat(stdout).toString()):reject(new Error(`Command failed ${argv[0]} (${code}): ${stderr}`));});
  });
}
const adb=(...args)=>exec([o.adb??'adb','-s',o.serial,...args]);
async function acquireDevice() {
  const locks=path.join(os.tmpdir(),'uih-device-locks');await fs.mkdir(locks,{recursive:true});
  const target=path.join(locks,crypto.createHash('sha256').update(o.serial).digest('hex')+'.json');
  try {
    const old=JSON.parse(await fs.readFile(target,'utf8'));
    try{process.kill(old.pid,0);throw new Error(`Android device is in use by UIH PID ${old.pid}`);}catch(e){if(e.code!=='ESRCH')throw e;await fs.unlink(target);}
  } catch(e){if(e.code!=='ENOENT')throw e;}
  const f=await fs.open(target,'wx');lockToken=crypto.randomUUID();await f.writeFile(JSON.stringify({pid:process.pid,token:lockToken}));await f.close();deviceLock=target;
}
async function freePort() {const server=net.createServer();await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res);});const port=server.address().port;await new Promise(res=>server.close(res));return port;}
async function hierarchy() {
  return readFreshHierarchy(adb);
}
function node(xml,testID) {
  const tags=xml.match(/<node\b[^>]*>/g)??[];
  return tags.find(t=>t.includes(`resource-id="${testID}"`)||t.includes(`content-desc="${testID}"`)||t.includes(`text="${testID}"`));
}
async function tap(testID) {
  const xml=await hierarchy();const tag=node(xml,testID);const m=tag?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if(!m)throw new Error(`Interaction target missing: ${testID}`);
  await adb('shell','input','tap',String(Math.round((+m[1]+ +m[3])/2)),String(Math.round((+m[2]+ +m[4])/2)));await sleep(250);
}
async function waitFor(check,timeout=90000) {
  const start=Date.now();let error;
  while(Date.now()-start<timeout){try{const result=await check();if(result)return result;}catch(e){error=e;}await sleep(600);}
  throw new Error(`Readiness timed out${error?': '+error.message:''}`);
}
try {
  if(!o.serial||!/^[a-f0-9]{64}$/.test(r.expectedRevision??''))throw new Error('Managed Android requires serial and expectedRevision');
  await acquireDevice();
  if((await adb('get-state')).trim()!=='device')throw new Error('Android device unavailable');
  const appPackage=o.appPackage??'host.exp.exponent';
  if(!(await adb('shell','pm','path',appPackage)).includes('package:'))throw new Error(`Install ${appPackage} on this test device first`);
  const modules=path.join(r.workspace,'node_modules');
  try{await fs.access(modules);}catch{
    if(!o.dependenciesPath||!path.isAbsolute(o.dependenciesPath))throw new Error('Configure dependenciesPath to a prepared node_modules directory');
    await fs.symlink(o.dependenciesPath,modules,process.platform==='win32'?'junction':'dir');
  }
  const proofDir=path.join(r.workspace,'.uih','runtime');await fs.mkdir(proofDir,{recursive:true});
  await fs.writeFile(path.join(proofDir,'revision.json'),JSON.stringify({revision:r.expectedRevision}));
  const port=await freePort();
  const cli=path.join(modules,'expo','bin','cli');
  const log=await fs.open(path.join(proofDir,'metro.log'),'w');
  metro=spawn(process.execPath,['--dns-result-order=ipv4first',cli,'start','--go','--no-dev','--localhost','--port',String(port)],{cwd:r.workspace,env:{...process.env,CI:'1',EXPO_NO_TELEMETRY:'1',EXPO_OFFLINE:'1',ANDROID_SERIAL:o.serial},windowsHide:true,detached:process.platform!=='win32',stdio:['ignore',log.fd,log.fd]});
  metro.on('error',()=>{});await log.close();
  await waitFor(async()=>{if(metro.exitCode!==null)throw new Error('Metro exited; inspect .uih/runtime/metro.log');const x=await fetch(`http://127.0.0.1:${port}/status`,{signal:AbortSignal.timeout(2000)});return(await x.text()).includes('packager-status:running');},o.startTimeoutMs??60000);
  await adb('reverse',`tcp:${port}`,`tcp:${port}`);reversePort=port;
  await adb('shell','am','force-stop',appPackage);
  // Opt-in only: dedicated test devices can discard Expo's cached update/state.
  if(o.resetAppData===true) {
    if(o.dedicatedDevice!==true)throw new Error('resetAppData requires dedicatedDevice: true');
    if(!(await adb('shell','pm','clear',appPackage)).includes('Success'))throw new Error('Unable to reset test application data');
  }
  await adb('shell','am','start','-W','-a','android.intent.action.VIEW','-d',`exp://127.0.0.1:${port}`);
  const marker=`uih-revision-${r.expectedRevision}`;
  let xml=await waitFor(async()=>{
    const value=await hierarchy();
    if(value.includes('This is the developer menu')&&node(value,'Continue'))await tap('Continue');
    else if(value.includes('SDK version:')&&node(value,'Close'))await tap('Close');
    return value.includes(marker)?value:null;
  },o.appTimeoutMs??120000);
  if(o.hideToolsButton===true&&node(xml,'Tools')){
    await adb('shell','input','keyevent','82');
    let menu=await hierarchy();
    for(let i=0;i<3&&!node(menu,'Tools button');i++){
      await adb('shell','input','swipe',String(Math.round(r.scenario.width/2)),String(Math.round(r.scenario.height*.9)),String(Math.round(r.scenario.width/2)),String(Math.round(r.scenario.height*.55)),'350');
      menu=await hierarchy();
    }
    if(!node(menu,'Tools button'))throw new Error('Expo Tools visibility setting not found');
    await tap('Tools button');await tap('Close');xml=await hierarchy();
    if(node(xml,'Tools')||!xml.includes(marker))throw new Error('Could not dismiss Expo Tools overlay');
  }
  if((o.expectedTexts??[]).some(t=>!xml.includes(t)))throw new Error('Expected screen content missing');
  let result;
  if(r.operation==='capture') {
    // Require the same source marker in two observations around the screenshot.
    const screenshot=await exec([o.adb??'adb','-s',o.serial,'exec-out','screencap','-p'],true);
    xml=await hierarchy();if(!xml.includes(marker))throw new Error('Source revision changed during capture');
    const densities=[...(await adb('shell','wm','density')).matchAll(/(?:Physical|Override) density:\s*(\d+)/g)];
    const pixelRatio=densities.length?Number(densities.at(-1)[1])/160:null;
    result={pixelRatio,pngBase64:screenshot.toString('base64'),observedRevision:r.expectedRevision,hierarchy:xml,stateEvidence:`Fresh Metro on port ${port}; observed ${marker} on ${o.serial}`};
  } else if(r.operation==='check') {
    if(!o.interactions?.length)throw new Error('Configure at least one interaction scenario');
    const checks=[];
    for(const action of o.interactions){
      try{await tap(action.tap);const observed=await waitFor(async()=>{const value=await hierarchy();return value.includes(action.expectText)?value:null;},10000);checks.push({name:action.name??action.tap,passed:true,evidence:`Observed ${action.expectText}`});xml=observed;}
      catch(error){checks.push({name:action.name??action.tap,passed:false,detail:error.message});break;}
    }
    if(!xml.includes(marker))throw new Error('Source revision missing after interactions');
    result={passed:checks.every(c=>c.passed),checks,observedRevision:r.expectedRevision};
  } else throw new Error('Unsupported operation');
  process.stdout.write(JSON.stringify({protocol:1,result}));
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
finally{
  if(metro?.pid){
    if(process.platform==='win32')await exec(['taskkill','/pid',String(metro.pid),'/T','/F']).catch(()=>{});
    else try{process.kill(-metro.pid,'SIGKILL');}catch{}
  }
  if(reversePort)await adb('reverse','--remove',`tcp:${reversePort}`).catch(()=>{});
  if(deviceLock)try{const current=JSON.parse(await fs.readFile(deviceLock,'utf8'));if(current.token===lockToken)await fs.unlink(deviceLock);}catch{}
}
