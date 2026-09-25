export const categories=['geometry','typography','spacing','imagery','color','icons','usability'];
export function validateReview(r){
  if(!Array.isArray(r.issues)||!Array.isArray(r.resolutions)||!Array.isArray(r.coverage))throw new Error('Structured issues, resolutions and coverage are required');
  for(const c of categories)if(!r.coverage.some(x=>x.category===c&&['reviewed','unverified','not-applicable'].includes(x.status)&&x.evidence?.trim()))throw new Error(`Missing review coverage: ${c}`);
  for(const i of r.issues)if(!i.key||!i.component||!categories.includes(i.category)||!['critical','major','minor'].includes(i.severity)||!['layout','asset','constraint'].includes(i.kind)||['description','expected','actual','evidence','remedy'].some(k=>!i[k]?.trim()))throw new Error('Invalid structured discrepancy');
  for(const x of r.resolutions)if(!x.key||!['resolved','open','unverified'].includes(x.status)||!x.evidence?.trim())throw new Error('Invalid issue resolution');
  return r;
}
export function reconcile(ledger,samples,revision,{resolve=true,component=null}={}){
  if(!Array.isArray(samples)||!samples.length)throw new Error('At least one structured review required');
  const result=structuredClone(ledger??[]),seen=new Set();
  for(const sample of samples){validateReview(sample);for(const issue of sample.issues){seen.add(issue.key);let row=result.find(x=>x.key===issue.key);if(!row){row={key:issue.key,history:[]};result.push(row);}const rank={minor:0,major:1,critical:2};const severity=row.status!=='resolved'&&rank[row.severity]>rank[issue.severity]?row.severity:issue.severity;Object.assign(row,issue,{severity,status:'open',lastSeenRevision:revision});row.history.push({revision,status:'open',evidence:issue.evidence});}
    for(const c of sample.coverage.filter(x=>x.status==='unverified')){const key=`coverage:${component??'screen'}:${c.category}`;seen.add(key);let row=result.find(x=>x.key===key);if(!row){row={key,component:component??'screen',category:c.category,severity:'major',kind:'constraint',history:[]};result.push(row);}Object.assign(row,{status:'unverified',description:`Unverified ${c.category}`,evidence:c.evidence,lastSeenRevision:revision});}
  }
  for(const row of result){if(seen.has(row.key)||component&&row.component!==component)continue;
    const decisions=samples.map(s=>s.resolutions.find(x=>x.key===row.key));
    if(resolve&&decisions.every(x=>x?.status==='resolved')){row.status='resolved';row.verifiedRevision=revision;row.history.push({revision,status:'resolved',evidence:decisions.map(x=>x.evidence).join('; ')});}
    else if(row.status==='resolved'&&row.verifiedRevision!==revision)row.status='unverified';
  }
  return result;
}
export const blockers=issues=>(issues??[]).filter(i=>i.severity!=='minor'&&i.status!=='resolved');
