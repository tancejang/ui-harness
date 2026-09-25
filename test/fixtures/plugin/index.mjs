// Deterministic test double, not an AI or real mobile adapter.
import fs from 'node:fs/promises';
import path from 'node:path';
const r = JSON.parse(await new Promise(resolve => { let s = ''; process.stdin.on('data', b => s += b); process.stdin.on('end', () => resolve(s)); }));
let result;
async function count(operation){const dir=path.join(r.workspace,'.uih');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,`fixture-${operation}-count`);let n=0;try{n=Number(await fs.readFile(file,'utf8'));}catch{}await fs.writeFile(file,String(n+1));return n+1;}

if (r.options.failOperation === r.operation) throw new Error('Injected plugin failure');
switch (r.operation) {
  case 'design-review': result = { visualQuality: 92, blocking: false, findings: ['Refine spacing'], rationale: 'Fixture design judgment' }; break;
  case 'generate': result = { pngBase64: r.options.images[3] }; break;
  case 'plan': result = { components: [{ id: 'hero', files: ['src/Home.tsx'], region: { left: 0, top: 0, width: 8, height: 8 }, constraints: 'Preserve the screen container' }] }; break;
  case 'build': {
    if(r.options.crashPauseOnce){
      const marker=path.join(r.workspace,'.uih/crash-injected');
      let seen=false;try{await fs.access(marker);seen=true;}catch{}
      if(!seen){await fs.mkdir(path.dirname(marker),{recursive:true});await fs.writeFile(path.join(r.workspace,'src/Home.tsx'),'partial write during interrupted plugin\n');await fs.writeFile(marker,String(process.pid));await new Promise(resolve=>setTimeout(resolve,60000));}
    }
    const file = r.project.files.find(f => f.path === 'src/Home.tsx');
    const attempt = r.previousFailures.length;
    if(r.options.requireRejectedProposal&&attempt>0&&!r.previousFailures.some(h=>h.rejectedProposal))throw new Error('Rejected proposal feedback missing');
    result = { edits: [{ path: 'src/Home.tsx', beforeSha256: file.sha256, content: `export const value = ${attempt === 0 ? 1 : attempt === 1 ? 2 : 3};\n` }] }; break;
  }
  case 'critic': result = { findings: ['Hero differs from reference; adjust its appearance.'] }; break;
  case 'judge': {
    const index = r.options.images.indexOf(r.images.actual.base64);
    if (index < 0) throw new Error('Unknown fixture image');
    const score = [40, 70, 60, 95][index];
    result = { visualQuality: score, fidelity: score, blocking: (r.options.blockIndices??[]).includes(index), findings: score < 90 ? ['Visible mismatch'] : [], rationale: 'Deterministic fixture score for orchestration tests, not real visual evaluation.' }; break;
  }
  case 'capture': {
    const number=await count('capture');
    const source = await fs.readFile(path.join(r.workspace, 'src/Home.tsx'), 'utf8');
    const value = Number(source.match(/value = (\d)/)[1]);
    result = { pngBase64: r.options.images[value], stateEvidence: `Fixture source value=${value}; capture=${number}`, observedRevision: r.options.staleRevision ? 'stale' : r.expectedRevision }; break;
  }
  case 'check': {const failed=r.options.failChecks||(r.options.failCheckAfter&&await count('check')>r.options.failCheckAfter);result = { passed: !failed, observedRevision:r.expectedRevision, checks: [{ name: 'fixture functionality', passed: !failed }] }; break;}
  default: throw new Error('Unknown operation');
}
if(['critic','judge'].includes(r.operation)){
  result.coverage=['geometry','typography','spacing','imagery','color','icons','usability'].map(category=>({category,status:'reviewed',evidence:'Synthetic fixture comparison'}));
  result.issues=(r.options.openIssue||(r.options.finalIssue&&r.nativeEvidence?.stateEvidence.includes('capture=2')))?[{key:'hero-proportions',component:'hero',category:'geometry',severity:'major',kind:'layout',description:'Hero is too shallow',expected:'Portrait framing',actual:'Square framing',evidence:'Observed reference and actual bounds differ',remedy:'Increase image aspect ratio'}]:[];
  result.resolutions=[];
  if(r.options.malformedReview)delete result.coverage;
}
process.stdout.write(JSON.stringify({ protocol: 1, result }));
