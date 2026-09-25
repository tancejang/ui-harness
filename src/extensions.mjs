import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { command, exists, inside, json, treeHash, writeJSON, files } from './util.mjs';

const validName = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x);
export async function install(root, kind, source) {
  if (!['plugin', 'skill'].includes(kind)) throw new Error('Expected plugin or skill');
  source = path.resolve(source);
  const manifest = await json(path.join(source, `${kind}.json`));
  if (manifest.apiVersion !== 1 || !validName(manifest.name) || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid extension manifest/version');
  if (kind === 'plugin') {
    if (!Array.isArray(manifest.capabilities) || !manifest.capabilities.length || manifest.capabilities.some(c => !['auth-status', 'generate', 'design-review', 'plan', 'build', 'critic', 'judge', 'capture', 'check'].includes(c))) throw new Error('Invalid capabilities');
    if (!Array.isArray(manifest.permissions) || manifest.permissions.some(p => !['network', 'process', 'project-read', 'device'].includes(p))) throw new Error('Invalid permissions');
    if (!(await exists(inside(source, manifest.entry)))) throw new Error('Missing plugin entry');
  } else if (!(await exists(path.join(source, 'SKILL.md')))) throw new Error('Skill needs SKILL.md');
  const digest = await treeHash(source);
  const dest = path.join(root, '.uih', 'extensions', kind, `${manifest.name}-${manifest.version}-${digest.slice(0,12)}`);
  if (path.resolve(dest).startsWith(source + path.sep)) throw new Error('Extension source cannot contain its installation directory');
  if (!(await exists(dest))) { await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.cp(source, dest, { recursive: true }); }
  if (await treeHash(dest) !== digest) throw new Error('Extension copy integrity mismatch');
  const lockPath = path.join(root, 'uih.lock.json');
  const lock = await exists(lockPath) ? await json(lockPath) : { version: 1, plugins: {}, skills: {} };
  lock[kind + 's'][manifest.name] = { version: manifest.version, hash: digest, path: path.relative(root, dest).split(path.sep).join('/'), manifest };
  await writeJSON(lockPath, lock);
  return { name: manifest.name, version: manifest.version, hash: digest, permissions: manifest.permissions ?? [] };
}
export async function loadExtensions(root) {
  const lock = await json(path.join(root, 'uih.lock.json'));
  if (lock.version !== 1) throw new Error('Unsupported extension lock');
  for (const collection of [lock.plugins, lock.skills]) for (const entry of Object.values(collection)) {
    if (await treeHash(inside(root, entry.path)) !== entry.hash) throw new Error('Extension integrity check failed; reinstall the extension');
  }
  return lock;
}
export async function skillContext(root, lock) {
  const result = [];
  for (const [name, entry] of Object.entries(lock.skills)) {
    const dir = inside(root, entry.path);
    const resources = {};
    for (const file of await files(dir)) if (/\.(md|txt|json)$/.test(file)) {
      const data = await fs.readFile(inside(dir, file), 'utf8');
      if (data.length > 64000) throw new Error(`Skill resource too large: ${name}/${file}`);
      resources[file] = data;
    }
    result.push({ name, resources });
  }
  if (JSON.stringify(result).length > 200000) throw new Error('Installed skill context exceeds 200KB');
  return result;
}
export async function invoke(root, lock, provider, operation, request, timeoutMs) {
  const entry = lock.plugins[provider.plugin];
  if (!entry?.manifest.capabilities.includes(operation)) throw new Error(`Plugin ${provider.plugin} does not support ${operation}`);
  const directory = inside(root, entry.path);
  if(await treeHash(directory)!==entry.hash)throw new Error('Extension integrity changed before dispatch');
  const host=fileURLToPath(new URL('./plugin-host.mjs',import.meta.url));
  const raw = await command([process.execPath, host, inside(directory, entry.manifest.entry)], {
    cwd: request.workspace ?? root,
    timeoutMs,
    input: JSON.stringify({ protocol: 1, operation, ...request, options: provider.options ?? {} })
  });
  if(await treeHash(directory)!==entry.hash)throw new Error('Extension integrity changed during call');
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error(`Plugin ${provider.plugin} returned invalid JSON`); }
  if (result.protocol !== 1 || !result.result || typeof result.result !== 'object') throw new Error('Invalid plugin response envelope');
  return result.result;
}
