import {approvalStatus} from './provenance.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { init, loadConfig } from './config.mjs';
import { install, loadExtensions, invoke } from './extensions.mjs';
import { run, verify } from './runner.mjs';
import { generateCandidates } from './design.mjs';
import { prepareReference } from './reference.mjs';
import {calibrate} from './calibration.mjs';
import { inspect } from './project.mjs';
import { decodeImage, validateImage } from './visual.mjs';
import { exists, inside, json, writeJSON, hash } from './util.mjs';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const help = `UIH — visual UI refinement harness (0.3.0)

uih init [--platform react-native|web|flutter|native]
uih inspect
uih doctor
uih plugin install <directory|builtin:codex|builtin:metro-android|builtin:android|builtin:command-runtime>
uih auth status
uih skill install <directory|builtin:visual-quality>
uih extensions
uih reference import <image.png> [--fit uniform-scale|strict|contain]
uih reference generate --brief <file> --out <image.png> [--candidates 3] [--calls 10]
uih run [--iterations 12] [--local-iterations 2] [--minutes 30] [--calls 100]
uih resume <run-id> [same budget options]
uih review [run-id|latest]
uih verify <run-id> [--workspace <directory>]
uih calibrate <suite.json> [--repeats 3] [--calls 30] [--minutes 20]

All commands accept --project <directory>. Configure uih.json before running.
Codex uses your saved ChatGPT OAuth login. No API credentials are required.
--calls caps plugin calls; --budget-usd remains an optional custom-provider reservation limit.
Exit: 0=passed/success, 1=error, 2=quality target not reached.
`;
export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    workspace:{type:'string'}, help: { type: 'boolean', short: 'h' }, project: { type: 'string' }, platform: { type: 'string' },
    iterations: { type: 'string' }, 'local-iterations': { type: 'string' }, minutes: { type: 'string' }, calls: { type: 'string' }, 'budget-usd': { type: 'string' },
    brief: { type: 'string' }, out: { type: 'string' }, candidates: { type: 'string' }, fit: { type: 'string' }, repeats:{type:'string'}
  } });
  const [action, sub, arg] = positionals, root = path.resolve(values.project ?? process.cwd());
  const print = value => process.stdout.write(typeof value === 'string' ? value + '\n' : JSON.stringify(value, null, 2) + '\n');
  if (!action || values.help) return print(help);
  if (action === 'init') { await init(root, values.platform); return print('Created uih.json. Configure source roots, reference, model roles, and runtime; install extensions.'); }
  if (action === 'plugin' || action === 'skill') {
    if (sub !== 'install' || !arg) throw new Error(`Usage: uih ${action} install <directory|builtin:name>`);
    const source = arg.startsWith('builtin:') ? inside(path.join(packageRoot, action + 's'), arg.slice(8)) : path.resolve(arg);
    return print(await install(root, action, source));
  }
  if (action === 'extensions') return print(await loadExtensions(root));
  if(action==='calibrate'){
    if(!sub)throw new Error('Provide a calibration suite JSON path');
    const result=await calibrate(root,path.resolve(sub),{repeats:Number(values.repeats??3),maxCalls:Number(values.calls??30),maxMinutes:Number(values.minutes??20)});
    print({status:result.status,calls:result.calls,rankings:result.rankings,report:result.report,error:result.error,note:result.note});if(result.status!=='passed')process.exitCode=2;return;
  }
  if (action === 'auth') {
    if (sub !== 'status') throw new Error('Use uih auth status; sign in through codex login');
    const config = await loadConfig(root), lock = await loadExtensions(root);
    const provider = Object.values(config.roles).find(p => p.plugin === 'codex');
    if (!provider) throw new Error('Configure the codex provider first');
    const status = await invoke(root, lock, provider, 'auth-status', {}, 20000);
    print(status); if (!status.authenticated) process.exitCode = 1; return;
  }
  if (action === 'inspect') return print(await inspect(root, await loadConfig(root)));
  if (action === 'doctor') {
    const config = await loadConfig(root), lock = await loadExtensions(root), issues = [];
    for (const [role, provider] of Object.entries(config.roles)) {
      if (!lock.plugins[provider.plugin]) issues.push(`${role}: plugin ${provider.plugin} not installed`);
      if (provider.plugin === 'openai') issues.push(`${role}: API provider retired; install builtin:codex and set plugin to codex, options to {}, reserveUSD to 0`);
    }
    const providers = Object.values(config.roles).filter(p => p.plugin === 'codex');
    const seen = new Set();
    for (const provider of providers) {
      const key = JSON.stringify(provider.options?.command ?? ['codex']);
      if (seen.has(key) || !lock.plugins.codex) continue;
      seen.add(key);
      try { const status = await invoke(root, lock, provider, 'auth-status', {}, 20000); if (!status.authenticated) issues.push(status.guidance); }
      catch { issues.push('Codex CLI authentication check failed. Install the CLI and run codex login.'); }
    }
    if (!lock.plugins[config.runtime.plugin]) issues.push(`Runtime ${config.runtime.plugin} not installed`);
    if (config.runtime.plugin === 'android') for (const field of ['prepare', 'checks', 'expectedTexts']) if (!config.runtime.options?.[field]?.length) issues.push(`Android ${field} not configured`);
    if(config.runtime.plugin==='metro-android')for(const field of ['serial','dependenciesPath','interactions'])if(!config.runtime.options?.[field]?.length)issues.push(`Managed Metro ${field} not configured`);
    try { await validateImage(inside(root, config.reference), config.scenario); } catch (e) { issues.push(e.message); }
    try { await inspect(root, config); } catch (e) { issues.push(e.message); }
    print({ ready: !issues.length, issues, note: 'Configuration and saved Codex OAuth status checked; model access, device connectivity and runtime freshness require a real run.' });
    if (issues.length) process.exitCode = 1; return;
  }
  if (action === 'reference') {
    const config = await loadConfig(root);
    if (sub === 'import') {
      if (!arg) throw new Error('Provide a PNG path');
      const source = path.resolve(arg), dest = inside(root, config.reference);
      const manifest = await prepareReference(source, dest, config.scenario, values.fit ?? 'uniform-scale');
      return print({ reference: dest, ...manifest, next: manifest.requiresReview ? 'Review the normalized reference before running. The native original is preserved alongside it.' : 'Reference ready.' });
    }
    if (sub === 'generate') {
      if (!values.brief || !values.out) throw new Error('Provide --brief and --out. Generation creates an unapproved candidate.');
      const output = inside(root, values.out);
      if (await exists(output)) throw new Error('Output already exists');
      if (!output.endsWith('.png')) throw new Error('Output must end in .png');
      await generateCandidates(root, config, { brief: await fs.readFile(path.resolve(values.brief), 'utf8'), output, count: Number(values.candidates ?? 1), maxUSD: Number(values['budget-usd'] ?? config.budgets.maxUSD), maxCalls: Number(values.calls ?? config.budgets.maxCalls ?? 100) });
      return print(`Generated candidate: ${output}. Review it, then use reference import to select it.`);
    }
    throw new Error('Expected reference import or generate');
  }
  if (action === 'run' || action === 'resume') {
    if (action === 'resume' && !sub) throw new Error('Provide a run id');
    const overrides = {};
    for (const [flag, key] of Object.entries({ iterations: 'maxIterations', 'local-iterations': 'localIterations', minutes: 'maxMinutes', calls: 'maxCalls', 'budget-usd': 'maxUSD' })) if (values[flag] !== undefined) overrides[key] = Number(values[flag]);
    const state = await run(root, overrides, action === 'resume' ? sub : undefined);
    print({ id: state.id, status: state.status, best: state.bestEvaluation, calls: state.calls, reservedUSD: state.reservedUSD, error: state.error, report: path.join(root, '.uih', 'runs', state.id, 'report.html') });
    if (state.status !== 'passed') process.exitCode = state.status === 'failed' ? 1 : 2; return;
  }
  if(action==='verify'){if(!sub)throw new Error('Provide a run id');const result=await verify(root,sub,values.workspace);print({status:result.status,deliveryReady:result.deliveryReady,issues:result.issues,report:result.report,error:result.error});if(!result.deliveryReady)process.exitCode=2;return;}
  if (action === 'review') {
    const runs = path.join(root, '.uih', 'runs');
    const id = !sub || sub === 'latest' ? (await fs.readdir(runs)).sort().at(-1) : sub;
    if (!id) throw new Error('No runs found');
    const dir = inside(runs, id), state = await json(path.join(dir, 'state.json'));
    return print({ id, ...await approvalStatus(state), issues:state.issues??[], best: state.bestEvaluation, report: path.join(dir, 'report.html'), patch: path.join(dir, 'changes.patch'), workspace: state.workspace });
  }
  throw new Error(`Unknown command: ${action}. Use --help.`);
}
