import sharp from 'sharp';
import fs from 'node:fs/promises';
import { inside } from './util.mjs';

export async function validateImage(file, scenario) {
  const meta = await sharp(file, { limitInputPixels: 8192 * 8192 }).metadata();
  if (meta.format !== 'png' || meta.width !== scenario.width || meta.height !== scenario.height) throw new Error(`Expected PNG ${scenario.width}x${scenario.height}; got ${meta.format} ${meta.width}x${meta.height}`);
  if((meta.pages??1)!==1)throw new Error('Animated screenshots are not supported');
  await sharp(file,{limitInputPixels:8192*8192}).raw().toBuffer();
  return meta;
}
export async function decodeImage(base64, file, scenario) {
  if (typeof base64 !== 'string' || base64.length > 24 * 1024 * 1024 || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) throw new Error('Invalid image payload');
  await fs.writeFile(file, Buffer.from(base64, 'base64'));
  await validateImage(file, scenario);
}
export async function compare(reference, actual, out) {
  const a = await sharp(reference).flatten({ background: '#fff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(actual).flatten({ background: '#fff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) throw new Error('Comparison image sizes differ');
  const diff = Buffer.alloc(a.data.length);
  let sum = 0;
  for (let i = 0; i < diff.length; i++) { const d = Math.abs(a.data[i] - b.data[i]); sum += d; diff[i] = Math.min(255, d * 4); }
  await sharp(diff, { raw: a.info }).png().toFile(out);
  return { meanAbsolutePixelError: sum / diff.length / 255, note: 'Diagnostic only; does not determine visual quality or acceptance.' };
}
export function validatePlan(plan, project, config) {
  if (!Array.isArray(plan.components) || !plan.components.length || plan.components.length > 24) throw new Error('Planner must return 1–24 components');
  const ids = new Set();
  for (const c of plan.components) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(c.id) || ids.has(c.id)) throw new Error('Invalid/duplicate component id');
    ids.add(c.id);
    if (!Array.isArray(c.files) || !c.files.length || c.files.some(f => !project.files.some(p => p.path === f && p.editable))) throw new Error(`Unknown component source ownership: ${c.id}`);
    const r = c.region;
    if (!r || ['left','top','width','height'].some(k => !Number.isInteger(r[k])) || r.left < 0 || r.top < 0 || r.width < 1 || r.height < 1 || r.left + r.width > config.scenario.width || r.top + r.height > config.scenario.height) throw new Error(`Invalid region: ${c.id}`);
    if (typeof c.constraints !== 'string' || !c.constraints.trim()) throw new Error('Component constraints required');
  }
  return plan;
}
export async function crop(file, region, out) { await sharp(file).extract(region).png().toFile(out); }
export async function imageInput(file) { return { mimeType: 'image/png', base64: (await fs.readFile(file)).toString('base64') }; }
export function validateEvaluation(value) {
  for (const metric of ['visualQuality', 'fidelity']) if (!Number.isFinite(value[metric]) || value[metric] < 0 || value[metric] > 100) throw new Error(`Invalid evaluation ${metric}`);
  if (!Array.isArray(value.findings) || value.findings.some(f => typeof f !== 'string') || typeof value.rationale !== 'string' || !value.rationale.trim() || typeof value.blocking !== 'boolean') throw new Error('Evaluation needs findings, rationale, and blocking');
  return value;
}
export function accepted(current, candidate, policy) {
  return !candidate.blocking && candidate.visualQuality >= current.visualQuality && candidate.fidelity >= current.fidelity && (candidate.visualQuality - current.visualQuality >= policy.minImprovement || candidate.fidelity - current.fidelity >= policy.minImprovement);
}
export function meets(value, policy) { return !value.blocking && value.visualQuality >= policy.visualQuality && value.fidelity >= policy.fidelity; }
