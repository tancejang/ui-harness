import fs from 'node:fs/promises';
import path from 'node:path';
import {git,hash} from './util.mjs';
export async function sourceRevision(root){
  const files=[...new Set((await git(root,'ls-files','--cached','--others','--exclude-standard','-z')).split('\0').filter(Boolean))].sort();
  const manifest=[];
  for(const file of files){
    if(/(^|\/)(\.git|\.uih|node_modules|\.env[^/]*)(\/|$)|\.(pem|key)$/i.test(file))continue;
    try{const stat=await fs.lstat(path.join(root,file));manifest.push([file,stat.isSymbolicLink()?hash(await fs.readlink(path.join(root,file))):hash(await fs.readFile(path.join(root,file)))]);}catch(e){if(e.code==='ENOENT')manifest.push([file,'deleted']);else throw e;}
  }
  return hash(JSON.stringify(manifest));
}
export async function approvalStatus(state){
  const a=state.attestation;
  if(!a)return {status:state.status==='passed'?'unverified':state.status,deliveryReady:false};
  let evidenceFresh=false;
  try{evidenceFresh=hash(await fs.readFile(path.join(path.dirname(state.finalReview.image),'reference.png')))===a.referenceHash&&hash(await fs.readFile(state.finalReview.image))===a.imageHash&&hash(await fs.readFile(state.finalReview.image.replace(/\.png$/,'.capture.json')))===a.captureHash;}catch{}
  const fresh=evidenceFresh&&a.configHash===hash(JSON.stringify(state.config))&&a.revision===await sourceRevision(state.workspace)&&a.referenceHash===state.referenceHash&&a.contractHash===hash(JSON.stringify(state.visualChecks??[]));
  return {status:fresh?state.status:'stale',deliveryReady:fresh&&state.status==='passed'};
}
