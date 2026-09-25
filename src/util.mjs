import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const json = async p => JSON.parse(await fs.readFile(p, 'utf8'));
export const exists = async p => { try { await fs.access(p); return true; } catch { return false; } };
export const hash = b => crypto.createHash('sha256').update(b).digest('hex');
export async function writeJSON(p, value) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(tmp, p);
}
export function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes(':')) throw new Error(`Invalid relative path: ${relative}`);
  const dest = path.resolve(root, relative);
  if (!dest.startsWith(path.resolve(root) + path.sep)) throw new Error(`Path escapes root: ${relative}`);
  return dest;
}
export async function noSymlinks(root, relative) {
  const target = inside(root, relative);
  let current = path.resolve(root);
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink not allowed: ${relative}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return target;
}
export function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}
export function command(argv, { cwd, input, timeoutMs = 120000, env = {}, maxBytes = 16 * 1024 * 1024, binary = false } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string')) throw new Error('Command must be a nonempty array of strings');
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = [], stderr = [], size = 0, failure;
    const fail = message => { failure ??= new Error(message); killTree(child); };
    const timer = setTimeout(() => fail(`Command timed out after ${timeoutMs}ms: ${argv[0]}`), timeoutMs);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.stdout.on('data', b => { size += b.length; if (size > maxBytes) fail('Command output limit exceeded'); else stdout.push(b); });
    child.stderr.on('data', b => { size += b.length; if (size > maxBytes) fail('Command output limit exceeded'); else stderr.push(b); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      const out = Buffer.concat(stdout), err = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) return reject(new Error(`Command failed (${code}): ${argv[0]}\n${err.slice(-4000)}`));
      resolve(binary ? out : out.toString('utf8'));
    });
  });
}
export const git = (cwd, ...args) => command(['git', '-c', 'core.hooksPath=/dev/null', ...args], { cwd });
export async function files(root) {
  const out = [];
  async function walk(dir, prefix = '') {
    for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (e.isSymbolicLink()) throw new Error(`Extension contains symlink: ${e.name}`);
      const rel = prefix + e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel + '/');
      else if (e.isFile()) out.push(rel);
    }
  }
  await walk(root); return out;
}
export async function treeHash(root) {
  const entries = [];
  for (const rel of await files(root)) entries.push([rel, hash(await fs.readFile(inside(root, rel)))]);
  return hash(JSON.stringify(entries));
}
