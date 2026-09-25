import fs from 'node:fs/promises';
import path from 'node:path';
import { git, hash, inside, noSymlinks } from './util.mjs';

export function editable(config, file) {
  return !/(^|\/)(\.git|\.uih|node_modules)(\/|$)/.test(file) && !/(^|\/)(\.env[^/]*|uih\.json|uih\.lock\.json)$|\.(pem|p8|key|keystore)$/i.test(file) && config.editable.some(p => p.endsWith('/') ? file.startsWith(p) : file === p);
}
export async function inspect(workspace, config) {
  const tracked = (await git(workspace, 'ls-files', '-z')).split('\0').filter(Boolean);
  const sources = [];
  let bytes = 0;
  for (const file of tracked.sort()) {
    if (!config.sourceRoots.some(p => file === p || file.startsWith(p.replace(/\/$/, '') + '/'))) continue;
    if (!/\.(tsx?|jsx?|css|scss|json|dart|swift|kt)$/.test(file) || /(^|\/)(package-lock|.*lock)\.json$/.test(file)) continue;
    const target = await noSymlinks(workspace, file);
    const content = await fs.readFile(target, 'utf8');
    bytes += Buffer.byteLength(content);
    if (bytes > config.maxContextBytes) throw new Error('Source context limit exceeded; narrow sourceRoots or raise maxContextBytes. No silent truncation.');
    const imports = [...content.matchAll(/(?:from\s+|require\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)].map(m => m[1]);
    sources.push({ path: file, sha256: hash(content), imports, editable: editable(config, file), content });
  }
  if (!sources.length) throw new Error('No tracked UI sources found under sourceRoots');
  return { framework: config.platform, discovery: 'Tracked source inventory with heuristic import edges; planner resolves ownership.', files: sources };
}
export async function applyEdits(workspace, config, edits, allowed) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 30) throw new Error('Builder must return 1–30 edits');
  const seen = new Set(), pending = [];
  for (const edit of edits) {
    if (typeof edit.path !== 'string' || !editable(config, edit.path) || (allowed && !allowed.includes(edit.path)) || seen.has(edit.path)) throw new Error(`Edit outside ownership or duplicate: ${edit.path}`);
    seen.add(edit.path);
    const target = await noSymlinks(workspace, edit.path);
    if (typeof edit.content !== 'string' || Buffer.byteLength(edit.content) > 300000 || typeof edit.beforeSha256 !== 'string') throw new Error('Invalid edit');
    // v1 edits existing files only. Assets/dependencies are explicit project setup.
    if (hash(await fs.readFile(target)) !== edit.beforeSha256) throw new Error(`Stale edit: ${edit.path}`);
    pending.push({ target, content: edit.content });
  }
  for (const edit of pending) await fs.writeFile(edit.target, edit.content);
}
export async function createWorkspace(project, dir) {
  const root = (await git(project, 'rev-parse', '--show-toplevel')).trim();
  if (path.resolve(root).toLowerCase() !== path.resolve(project).toLowerCase()) throw new Error('Run from the Git repository root');
  if ((await git(project, 'diff', '--name-only', 'HEAD')).trim()) throw new Error('Commit or stash tracked changes before running; the harness snapshots HEAD');
  const base = (await git(project, 'rev-parse', 'HEAD')).trim();
  await git(project, 'clone', '--no-hardlinks', '--no-checkout', '--', project, dir);
  await git(dir, 'checkout', '--detach', base);
  await fs.writeFile(path.join(dir, '.git', 'UIH_WORKSPACE'), path.resolve(dir));
  await git(dir, 'config', 'user.name', 'UIH');
  await git(dir, 'config', 'user.email', 'uih@localhost');
  return base;
}
export async function restore(workspace, commit) {
  const marker = await fs.readFile(path.join(workspace, '.git', 'UIH_WORKSPACE'), 'utf8');
  if (marker !== path.resolve(workspace)) throw new Error('Refusing restore outside owned UIH workspace');
  await git(workspace, 'reset', '--hard', commit);
  await git(workspace, 'clean', '-fd');
}
export async function checkpoint(workspace, config) {
  const changed = (await git(workspace, 'diff', '--name-only', '-z')).split('\0').filter(Boolean);
  if (!changed.length) throw new Error('Builder produced no source change');
  if (changed.some(f => !editable(config, f))) throw new Error('Runtime or plugin changed files outside editable scope');
  await git(workspace, 'add', '--', ...changed);
  await git(workspace, 'commit', '-m', 'UIH accepted candidate');
  return (await git(workspace, 'rev-parse', 'HEAD')).trim();
}
