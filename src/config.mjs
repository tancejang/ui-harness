import path from 'node:path';
import fs from 'node:fs/promises';
import { json, writeJSON } from './util.mjs';

export const defaults = {
  version: 1, platform: 'react-native', sourceRoots: ['src'],
  scenario: { name: 'home', description: 'Home screen with fixed test data', width: 1080, height: 1920 },
  reference: 'references/home.png',
  editable: ['src/'],
  runtime: { plugin: 'metro-android', options: { serial: 'emulator-5554', dependenciesPath: '', expectedTexts: [], interactions: [] } },
  roles: {
    planner: { plugin: 'codex', options: {}, reserveUSD: 0 },
    builder: { plugin: 'codex', options: {}, reserveUSD: 0 },
    critic: { plugin: 'codex', options: {}, reserveUSD: 0 },
    judge: { plugin: 'codex', options: {}, reserveUSD: 0 },
    designer: { plugin: 'codex', options: {}, reserveUSD: 0 }
  },
  budgets: { maxIterations: 12, localIterations: 2, maxMinutes: 30, maxCalls: 100, maxUSD: 25, callTimeoutSeconds: 600 },
  acceptance: { visualQuality: 85, fidelity: 90, minImprovement: 1, judgeSamples:2, maxJudgeSpread:12 },
  maxContextBytes: 180000
};
export function validateConfig(c) {
  if (c.version !== 1) throw new Error('Unsupported config version');
  if (!['react-native', 'web', 'flutter', 'native'].includes(c.platform)) throw new Error('Unsupported platform');
  for (const key of ['sourceRoots', 'editable']) if (!Array.isArray(c[key]) || !c[key].length || c[key].some(x => typeof x !== 'string' || !x || x.startsWith('/') || x.includes('..') || x.includes('\\') || x.includes(':'))) throw new Error(`Invalid ${key}`);
  for (const key of ['width', 'height']) if (!Number.isInteger(c.scenario?.[key]) || c.scenario[key] < 1 || c.scenario[key] > 8192) throw new Error(`Invalid scenario ${key}`);
  if (!c.scenario?.name || !c.runtime?.plugin) throw new Error('Scenario and runtime required');
  if (!Number.isFinite(c.runtime.reserveUSD ?? 0) || (c.runtime.reserveUSD ?? 0) < 0) throw new Error('Invalid runtime reserveUSD');
  for (const role of ['planner', 'builder', 'critic', 'judge', 'designer']) {
    if (!c.roles?.[role]?.plugin || !Number.isFinite(c.roles[role].reserveUSD) || c.roles[role].reserveUSD < 0) throw new Error(`Invalid ${role} provider/reserveUSD`);
  }
  for (const key of ['maxIterations', 'localIterations', 'maxMinutes', 'maxUSD', 'callTimeoutSeconds']) if (!Number.isFinite(c.budgets?.[key]) || c.budgets[key] <= 0) throw new Error(`Invalid budget ${key}`);
  for (const key of ['maxIterations', 'localIterations']) if (!Number.isInteger(c.budgets[key])) throw new Error(`Budget ${key} must be an integer`);
  if (c.budgets.maxCalls !== undefined && (!Number.isInteger(c.budgets.maxCalls) || c.budgets.maxCalls < 1)) throw new Error('Invalid budget maxCalls');
  for (const key of ['visualQuality', 'fidelity', 'minImprovement']) if (!Number.isFinite(c.acceptance?.[key]) || c.acceptance[key] < 0 || c.acceptance[key] > 100) throw new Error(`Invalid acceptance ${key}`);
  if(!Number.isInteger(c.acceptance.judgeSamples??2)||(c.acceptance.judgeSamples??2)<1||(c.acceptance.judgeSamples??2)>5)throw new Error('Invalid judgeSamples');
  if(c.acceptance.requireComponentCycle!==undefined&&typeof c.acceptance.requireComponentCycle!=='boolean')throw new Error('Invalid requireComponentCycle');
  if(!Number.isFinite(c.acceptance.maxJudgeSpread??12)||(c.acceptance.maxJudgeSpread??12)<0||(c.acceptance.maxJudgeSpread??12)>100)throw new Error('Invalid maxJudgeSpread');
  if (!Number.isInteger(c.maxContextBytes) || c.maxContextBytes < 100 || c.maxContextBytes > 2000000) throw new Error('Invalid maxContextBytes');
  return c;
}
export async function loadConfig(root) { return validateConfig(await json(path.join(root, 'uih.json'))); }
export async function init(root, platform = 'react-native') {
  const { exists } = await import('./util.mjs');
  if (await exists(path.join(root, 'uih.json'))) throw new Error('uih.json already exists');
  const config = validateConfig({ ...defaults, platform, runtime:platform==='react-native'?defaults.runtime:{plugin:'command-runtime',options:{capture:[],checks:[]}} });
  await writeJSON(path.join(root, 'uih.json'), config);
  const ignore = path.join(root, '.gitignore');
  const previous = await exists(ignore) ? await fs.readFile(ignore, 'utf8') : '';
  if (!previous.split(/\r?\n/).some(line => line === '.uih/' || line === '/.uih/')) await fs.appendFile(ignore, `${previous && !previous.endsWith('\n') ? '\n' : ''}.uih/\n`);
}
