import fs from 'node:fs/promises';
import path from 'node:path';
import { invoke, loadExtensions, skillContext } from './extensions.mjs';
import { decodeImage, imageInput } from './visual.mjs';
import { exists, hash, writeJSON } from './util.mjs';
import { readPNG } from './reference.mjs';

// Design refinement is intentionally separate from implementation acceptance.
export async function generateCandidates(root, config, { brief, output, count = 1, maxUSD = config.budgets.maxUSD, maxCalls = config.budgets.maxCalls ?? 100 }) {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('Candidate count must be 1–20');
  if (!Number.isFinite(maxUSD) || maxUSD <= 0) throw new Error('Invalid design budget');
  if (!Number.isInteger(maxCalls) || maxCalls < 1) throw new Error('Invalid call budget');
  if (await exists(output) || await exists(output + '.design.json')) throw new Error('Output already exists');
  const lock = await loadExtensions(root), skills = await skillContext(root, lock);
  const designer = config.roles.designer, judge = config.roles.judge;
  if (!lock.plugins[designer.plugin]?.manifest.capabilities.includes('generate') || !lock.plugins[judge.plugin]?.manifest.capabilities.includes('design-review')) throw new Error('Design stage requires generate and design-review capabilities');
  const record = { version: 1, status: 'running', brief, candidates: [], calls: 0, usage: [], reservedUSD: 0, extensions: lock, approved: false };
  const ledger = output + '.design.json', start = Date.now();
  const save = () => writeJSON(ledger, record);
  async function call(provider, operation, request) {
    const remaining = config.budgets.maxMinutes * 60000 - (Date.now() - start);
    if (remaining <= 0 || record.calls >= maxCalls || record.reservedUSD + provider.reserveUSD > maxUSD + 1e-9) throw new Error('Design budget exhausted');
    record.calls++; record.reservedUSD += provider.reserveUSD; await save();
    const result = await invoke(root, lock, provider, operation, { scenario: config.scenario, skills, ...request }, Math.min(remaining, config.budgets.callTimeoutSeconds * 1000));
    record.usage.push({ operation, usage: result.usage ?? null, authMethod: result.authMethod ?? null }); await save();
    return result;
  }
  try {
    for (let i = 0; i < count; i++) {
      const file = output.replace(/\.png$/i, '') + `.candidate-${i + 1}.png`;
      if (await exists(file)) throw new Error(`Candidate already exists: ${file}`);
      const previous = record.candidates.at(-1)?.evaluation;
      const refinedBrief = brief + (previous ? `\nImprove on these findings from the previous candidate: ${JSON.stringify(previous.findings)}` : '');
      const generated = await call(designer, 'generate', { brief: refinedBrief });
      await fs.mkdir(path.dirname(file), { recursive: true });
      if (typeof generated.pngBase64 !== 'string' || generated.pngBase64.length > 24 * 1024 * 1024) throw new Error('Invalid generated image');
      await fs.writeFile(file, Buffer.from(generated.pngBase64, 'base64'), { flag: 'wx' });
      const native = await readPNG(file);
      const evaluation = await call(judge, 'design-review', { brief, images: { candidate: await imageInput(file) } });
      if (!Number.isFinite(evaluation.visualQuality) || evaluation.visualQuality < 0 || evaluation.visualQuality > 100 || typeof evaluation.blocking !== 'boolean' || !Array.isArray(evaluation.findings) || evaluation.findings.some(f => typeof f !== 'string') || typeof evaluation.rationale !== 'string') throw new Error('Invalid design evaluation');
      record.candidates.push({ file, sha256: native.sha256, dimensions: { width: native.width, height: native.height }, requestedDimensions: { width: config.scenario.width, height: config.scenario.height }, evaluation, usage: generated.usage ?? null });
      await save();
    }
    const best = record.candidates.filter(c => !c.evaluation.blocking).sort((a,b) => b.evaluation.visualQuality - a.evaluation.visualQuality)[0];
    if (!best) throw new Error('All design candidates have blocking issues; inspect the design ledger');
    await fs.copyFile(best.file, output);
    record.best = best.file; record.status = 'needs-review';
  } catch (error) { record.status = 'failed'; record.error = error.message; throw error; }
  finally { record.elapsedMs = Date.now() - start; await save(); }
  return record;
}
