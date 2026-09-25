// Adapter for existing Playwright, Maestro, simulator, Flutter, or custom runners.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
const r = JSON.parse(await new Promise(resolve => { let s = ''; process.stdin.on('data', b => s += b); process.stdin.on('end', () => resolve(s)); }));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uih-capture-'));
const screenshot = path.join(dir, 'screen.png'), evidence = path.join(dir, 'evidence.json');
async function exec(args) {
  if (!Array.isArray(args) || !args.length || args.some(x => typeof x !== 'string')) throw new Error('Expected command argument array');
  const argv = args.map(x => x.replaceAll('{workspace}', r.workspace).replaceAll('{screenshot}', screenshot).replaceAll('{evidence}', evidence).replaceAll('{revision}', r.expectedRevision ?? ''));
  return new Promise((resolve, reject) => {
    const p = spawn(argv[0], argv.slice(1), { cwd: r.workspace, shell: false, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    let message = '';
    p.stdout.on('data', () => {}); p.stderr.on('data', b => { message = (message + b).slice(-4000); });
    p.on('error', reject); p.on('close', c => c === 0 ? resolve() : reject(new Error(`Command failed (${c}): ${message}`)));
  });
}
try {
  let result;
  if (r.operation === 'capture') {
    if (!r.options.capture?.length) throw new Error('Configure capture command arrays');
    for (const command of r.options.capture) await exec(command);
    const proof = JSON.parse(await fs.readFile(evidence, 'utf8'));
    if (typeof proof.stateEvidence !== 'string' || !proof.stateEvidence.trim()) throw new Error('Capture runner must write evidence.json with stateEvidence');
    result = { pngBase64: (await fs.readFile(screenshot)).toString('base64'), stateEvidence: proof.stateEvidence, hierarchy: proof.hierarchy ?? null, observedRevision:proof.observedRevision };
  } else if (r.operation === 'check') {
    if (!r.options.checks?.length) throw new Error('Configure functional checks');
    const checks = [];
    for (const item of r.options.checks) {
      if (!item.name || !item.command) throw new Error('Checks require name and command');
      try { await exec(item.command); checks.push({ name: item.name, passed: true }); }
      catch (error) { checks.push({ name: item.name, passed: false, detail: error.message }); }
    }
    let proof = {}; try { proof=JSON.parse(await fs.readFile(evidence,'utf8')); } catch {}
    result = { passed: checks.every(x => x.passed), checks, observedRevision:proof.observedRevision };
  } else throw new Error('Unsupported operation');
  process.stdout.write(JSON.stringify({ protocol: 1, result }));
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
finally {
  // Exact, process-created files only; no recursive removal or user-provided paths.
  for (const file of [screenshot, evidence]) try { await fs.unlink(file); } catch {}
  try { await fs.rmdir(dir); } catch {}
}
