// Prove the design findings reach the plugin boundary during a real UIH run.
//
// The demo's fixture plugin ignores unknown request fields, so a passing demo does NOT show the
// bridge is connected. This runs the coordinator against a capture plugin that records the
// request it receives, then asserts `designFindings` was present and non-empty.
//
// Run: node examples/design-findings-smoke.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { git, writeJSON } from '../src/util.mjs';
import { defaults } from '../src/config.mjs';
import { install } from '../src/extensions.mjs';
import { run } from '../src/runner.mjs';

// A recorder plugin: behaves like the fixture double but writes every request it is handed.
const recorder = `import fs from 'node:fs/promises';
const r = JSON.parse(await new Promise(res => { let s=''; process.stdin.on('data',b=>s+=b); process.stdin.on('end',()=>res(s)); }));
// Record what the coordinator actually sent, for the roles we care about.
if (['critic','judge'].includes(r.operation)) {
  await fs.mkdir(r.workspace + '/.uih', { recursive: true });
  await fs.appendFile(r.workspace + '/.uih/requests.jsonl', JSON.stringify({
    operation: r.operation,
    hasDesignFindings: Object.prototype.hasOwnProperty.call(r, 'designFindings'),
    designFindings: r.designFindings ?? null,
    skillCount: Array.isArray(r.skills) ? r.skills.length : null
  }) + '\\n');
}
let result;
const file = r.project?.files?.find(f => f.path === 'src/Home.tsx');
switch (r.operation) {
  case 'plan': result = { components: [{ id:'hero', files:['src/Home.tsx'], region:{left:0,top:0,width:8,height:8}, constraints:'Preserve the container' }] }; break;
  case 'build': result = { edits: [{ path:'src/Home.tsx', beforeSha256:file.sha256, content:'export const value = 1;\\n' }] }; break;
  case 'critic': result = { findings:['Inspect spacing against the sourced scale.'] }; break;
  case 'judge': result = { visualQuality: 80, fidelity: 80, blocking:false, findings:[], rationale:'Recorder judgment' }; break;
  case 'capture': result = { pngBase64: r.options.images[1], stateEvidence:'recorder capture', observedRevision: r.expectedRevision }; break;
  case 'check': result = { passed:true, observedRevision:r.expectedRevision, checks:[{name:'recorder check',passed:true}] }; break;
  default: throw new Error('unexpected operation ' + r.operation);
}
if (['critic','judge'].includes(r.operation)) {
  result.coverage = ['geometry','typography','spacing','imagery','color','icons','usability'].map(category => ({ category, status:'reviewed', evidence:'recorder' }));
  result.issues = []; result.resolutions = [];
}
process.stdout.write(JSON.stringify({ protocol: 1, result }));
`;

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uih-design-'));
await fs.mkdir(path.join(root, 'src'));
await fs.mkdir(path.join(root, 'references'));
await fs.writeFile(path.join(root, 'src/Home.tsx'), 'export const value = 0;\n');
await fs.writeFile(path.join(root, '.gitignore'), '.uih/\n');

// Two distinct images so a render is recognizable.
const base = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#2563eb' } }).png().toBuffer();
const alt = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#047857' } }).png().toBuffer();
const images = [base.toString('base64'), alt.toString('base64')];
await fs.writeFile(path.join(root, 'references/home.png'), base);

// Install the recorder as the runtime and every model role.
const pluginDir = path.join(root, 'recorder-plugin');
await fs.mkdir(pluginDir, { recursive: true });
await fs.writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify({
  apiVersion: 1, name: 'recorder', version: '1.0.0', entry: 'index.mjs',
  capabilities: ['plan', 'build', 'critic', 'judge', 'capture', 'check'],
  permissions: ['process']
}, null, 2));
await fs.writeFile(path.join(pluginDir, 'index.mjs'), recorder);

const config = structuredClone(defaults);
config.acceptance.judgeSamples = 1;
config.scenario = { name: 'design-smoke', description: 'Design findings bridge smoke', width: 8, height: 8 };
config.runtime = { plugin: 'recorder', options: { images } };
for (const role of Object.keys(config.roles)) config.roles[role] = { plugin: 'recorder', options: { images }, reserveUSD: 0 };
config.budgets = { maxIterations: 1, localIterations: 1, maxMinutes: 5, maxUSD: 20, callSeconds: 5, callTimeoutSeconds: 5 };
await writeJSON(path.join(root, 'uih.json'), config);
await install(root, 'plugin', pluginDir);
await git(root, 'init');
await git(root, 'config', 'user.name', 'UIH Smoke');
await git(root, 'config', 'user.email', 'smoke@localhost');
await git(root, 'add', '.');
await git(root, 'commit', '-m', 'smoke fixture');

const state = await run(root);
const logPath = path.join(state.workspace, '.uih', 'requests.jsonl');
const lines = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map(l => JSON.parse(l));

const critic = lines.filter(l => l.operation === 'critic');
const judge = lines.filter(l => l.operation === 'judge');

console.log(`run status: ${state.status}`);
console.log(`critic calls recorded: ${critic.length}, judge calls recorded: ${judge.length}`);
console.log(`critic requests carrying designFindings: ${critic.filter(c => c.hasDesignFindings).length}/${critic.length}`);
console.log(`judge  requests carrying designFindings: ${judge.filter(j => j.hasDesignFindings).length}/${judge.length}`);

const sample = critic[0]?.designFindings;
console.log('\nsample payload sent to the critic:');
console.log(JSON.stringify(sample, null, 2)?.slice(0, 900));

const ok = critic.length > 0 && judge.length > 0
  && critic.every(c => c.hasDesignFindings) && judge.every(j => j.hasDesignFindings)
  && sample && typeof sample.summary === 'string' && Array.isArray(sample.findings);

console.log(`\n${ok ? 'PASS' : 'FAIL'}: designFindings reached every critic and judge call`);
process.exitCode = ok ? 0 : 1;
