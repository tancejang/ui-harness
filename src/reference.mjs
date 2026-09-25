import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { hash, writeJSON, exists } from './util.mjs';

export async function readPNG(file) {
  const bytes = await fs.readFile(file);
  if (bytes.length > 18 * 1024 * 1024) throw new Error('Reference exceeds 18MB');
  const image = sharp(bytes, { limitInputPixels: 8192 * 8192 });
  const meta = await image.metadata();
  if (meta.format !== 'png' || !meta.width || !meta.height || meta.width > 8192 || meta.height > 8192 || (meta.pages ?? 1) !== 1) throw new Error('Reference must be a bounded, single-frame PNG');
  await image.raw().toBuffer(); // Decode fully; truncated headers are not valid images.
  return { bytes, width: meta.width, height: meta.height, sha256: hash(bytes) };
}
export async function prepareReference(source, destination, scenario, fit = 'uniform-scale') {
  if (!['strict', 'uniform-scale', 'contain'].includes(fit)) throw new Error('Reference fit must be strict, uniform-scale or contain');
  if (await exists(destination)) throw new Error('Reference destination already exists');
  const original = await readPNG(source);
  const sameSize = original.width === scenario.width && original.height === scenario.height;
  const scale = Math.min(scenario.width / original.width, scenario.height / original.height);
  const scaledWidth = Math.round(original.width * scale), scaledHeight = Math.round(original.height * scale);
  if (fit === 'strict' && !sameSize) throw new Error('Strict reference fit requires identical dimensions');
  // Rounding by at most a pixel is allowed; no cropping or anisotropic stretching.
  if (fit === 'uniform-scale' && (Math.abs(scaledWidth - scenario.width) > 1 || Math.abs(scaledHeight - scenario.height) > 1)) throw new Error(`Reference aspect ratio differs: ${original.width}x${original.height} versus ${scenario.width}x${scenario.height}. Regenerate for this viewport or explicitly choose --fit contain.`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const output = sameSize ? original.bytes : await sharp(original.bytes).resize({ width: scenario.width, height: scenario.height, fit: 'contain', background: '#ffffff' }).png().toBuffer();
  await fs.writeFile(destination, output, { flag: 'wx' });
  const manifest = { version: 1, fit, source: { width: original.width, height: original.height, sha256: original.sha256 }, target: { width: scenario.width, height: scenario.height, sha256: hash(output) }, transform: { scale: sameSize ? 1 : scale, offsetX: (scenario.width - scaledWidth) / 2, offsetY: (scenario.height - scaledHeight) / 2, cropped: false }, requiresReview: !sameSize };
  await writeJSON(destination + '.reference.json', manifest);
  await fs.writeFile(destination + '.original.png', original.bytes, { flag: 'wx' });
  return manifest;
}
