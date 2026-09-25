export function nativeElements(xml=''){
  const decode=s=>s.replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(m=>{
    const a=Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],decode(x[2])]));
    const b=a.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)?.slice(1).map(Number);
    return {id:a['resource-id'],label:a['content-desc'],text:a.text,clickable:a.clickable==='true',bounds:b?{x:b[0],y:b[1],width:b[2]-b[0],height:b[3]-b[1]}:null};
  }).filter(x=>x.bounds);
}
export function validateMeasurements(checks=[]){
  if(!Array.isArray(checks))throw new Error('visualChecks must be an array');
  const ids=new Set();
  for(const c of checks){if(!c.key||ids.has(c.key)||!/^((id|label|text):).+/.test(c.selector??'')||!['x','y','width','height','aspectRatio','gap','fontSize','touchSize'].includes(c.metric)||!Number.isFinite(c.expected)||!Number.isFinite(c.tolerance)||c.tolerance<0||!['critical','major','minor'].includes(c.severity))throw new Error('Invalid visual measurement contract');ids.add(c.key);}
  return checks;
}
export function measure(checks,capture,scenario){
  const elements=capture.elements??nativeElements(capture.hierarchy??'');
  const find=selector=>{const at=selector.indexOf(':');const key=selector.slice(0,at),value=selector.slice(at+1);const matches=elements.filter(e=>['id','label','text'].includes(key)&&e[key]===value);return matches.length===1?matches[0]:null;};
  return validateMeasurements(checks).map(c=>{
    const e=find(c.selector),b=e?.bounds;let actual=null;
    if(b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0){if(['x','width'].includes(c.metric))actual=b[c.metric]/scenario.width;
      if(['y','height'].includes(c.metric))actual=b[c.metric]/scenario.height;
      if(c.metric==='aspectRatio'&&b.height)actual=b.width/b.height;
      if(c.metric==='gap'){const other=find(c.relativeTo??'')?.bounds;if(other)actual=(b.y-other.y-other.height)/scenario.height;}
      if(c.metric==='fontSize'&&Number.isFinite(e.fontSize))actual=e.fontSize;
      if(c.metric==='touchSize'&&capture.pixelRatio>0)actual=Math.min(b.width,b.height)/capture.pixelRatio;
    }
    const status=actual===null?'unverified':(c.metric==='touchSize'?actual>=c.expected-c.tolerance:Math.abs(actual-c.expected)<=c.tolerance)?'resolved':'open';
    return {...c,key:`measurement:${c.key}`,component:c.component??'screen',category:c.metric==='touchSize'?'usability':c.metric==='fontSize'?'typography':c.metric==='gap'?'spacing':'geometry',kind:c.metric==='touchSize'?'constraint':'layout',status,actual,description:`${c.selector} ${c.metric}`,evidence:actual===null?'Missing or ambiguous runtime measurement':`Expected ${c.expected} ± ${c.tolerance}; observed ${actual}`,remedy:'Match the frozen contract while preserving behavior'};
  });
}
export function mergeMeasurements(issues,measured,revision){return [...issues.filter(x=>!x.key.startsWith('measurement:')),...measured.map(x=>({...x,verifiedRevision:revision}))];}
