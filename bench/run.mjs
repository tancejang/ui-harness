// Held-out UI defect benchmark.
//
// Prints, on ONE line, for each split:
//   model score, constant-predictor score, random-predictor score,
//   TRAIN label distribution, EVAL label distribution
//
// Task: given (reference PNG, candidate PNG), predict the dominant defect class.
// Classes: geometry, typography, spacing, color, imagery, clean  (6 classes)
//
// Splits are disjoint by SEED and by MAGNITUDE BAND, so the eval split is genuinely
// held out: the judge's thresholds were tuned only against the train split.
//
// Usage:
//   node bench/run.mjs            # full report
//   node bench/run.mjs --json     # machine-readable
//   node bench/run.mjs --hand     # hand-check the worked example

import { renderSpec, cleanSpec, applyDefect, clone, RENDER_SCALE } from './fixture.mjs';
import { classify, measurePair, decide } from './judge.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BAND = JSON.parse(await fs.readFile(path.join(HERE, 'eval-band.json'), 'utf8'));

const CLASSES = ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean'];
const LABELS = CLASSES;

/** Deterministic PRNG so a split is reproducible. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a split. `band` controls the magnitude range so train and eval use
 * different severity regimes rather than the same points resampled.
 */
function buildSplit(nCasesPerClass, band, seed) {
  const rand = mulberry32(seed);
  const base = cleanSpec();
  const out = [];
  let n = 0;
  for (let rep = 0; rep < nCasesPerClass; rep++) {
    for (const cls of CLASSES) {
      n++;
      const mag = cls === 'clean' ? 0 : band[0] + rand() * (band[1] - band[0]);
      const { spec, label } = applyDefect(base, cls, mag);
      out.push({ id: `${seed}-${String(n).padStart(3, '0')}`, label, mag: +mag.toFixed(3), spec });
    }
  }
  return out;
}

/** Label distribution as a normalised map over all classes. */
function distribution(labels) {
  const d = Object.fromEntries(LABELS.map(l => [l, 0]));
  for (const l of labels) d[l]++;
  return d;
}

function constantBaseline(labels) {
  const d = distribution(labels);
  let best = LABELS[0];
  for (const l of LABELS) if (d[l] > d[best]) best = l;
  const total = labels.length || 1;
  return { label: best, score: d[best] / total, dist: d };
}

function randomBaseline(labels, seed = 12345) {
  const rand = mulberry32(seed);
  let hits = 0;
  for (const l of labels) {
    const pick = LABELS[Math.floor(rand() * LABELS.length)];
    if (pick === l) hits++;
  }
  return { score: hits / (labels.length || 1) };
}

function accuracy(pairs) {
  const hits = pairs.filter(p => p.pred === p.truth).length;
  return hits / (pairs.length || 1);
}

function confusion(pairs) {
  const m = Object.fromEntries(LABELS.map(t => [t, Object.fromEntries(LABELS.map(p => [p, 0]))]));
  for (const p of pairs) m[p.truth][p.pred]++;
  return m;
}

function fmtDist(d) {
  return '{' + LABELS.map(l => `${l}:${d[l]}`).join(',') + '}';
}

async function evaluate(pairs, scale) {
  const out = [];
  for (const c of pairs) {
    const png = await renderSpec(c.spec, { scale });
    const r = await classify(c.refPng, png);
    out.push({ ...c, truth: c.label, png, pred: r.label, confidence: r.confidence, reason: r.reason, features: r.features });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const handCheck = args.includes('--hand');
  const scaleArg = args.indexOf('--scale');
  const SCALE = scaleArg >= 0 ? Number(args[scaleArg + 1]) : RENDER_SCALE;

  const refPng = await renderSpec(cleanSpec(), { scale: SCALE });

  // The bands live in eval-band.json so run.mjs, seed-sweep.mjs and difficulty.mjs cannot
  // drift apart. Earlier they each carried their own copy, which is how a stale sweep kept
  // reporting a saturated result for a band that had already moved.
  const { band: EVAL_BAND, trainBand: TRAIN_BAND, casesPerClass: PER, sweepSeeds: N_SWEEP } = BAND;

  // TRAIN: HIGH severity — the "obvious defect" regime, where the judge's thresholds were set.
  // EVAL (held out): LOW severity — a different regime, re-derived with bench/difficulty.mjs
  // each time the previous band became saturated. A saturated band cannot drive improvement,
  // so the band is moved down to wherever the judge measurably breaks.
  //
  // The headline eval number is the MEAN over a seed sweep, not a single split. A single
  // split can be a lucky draw: on the original band seed 97 scored 1.0000 while the 30-seed
  // mean was 0.964. Reporting one seed would repeat exactly the mistake this benchmark was
  // built to fix, so the single-split figure is printed alongside the sweep mean, never
  // instead of it.
  const trainRaw = buildSplit(PER, TRAIN_BAND, 11).map(c => ({ ...c, refPng }));
  const evalRaw = buildSplit(PER, EVAL_BAND, 97).map(c => ({ ...c, refPng }));
  const SWEEP_SEEDS = Array.from({ length: N_SWEEP }, (_, i) => (i + 1) * 7 + 90);

  const train = await evaluate(trainRaw, SCALE);
  const evalSet = await evaluate(evalRaw, SCALE);

  const trainTruth = train.map(p => p.truth);
  const evalTruth = evalSet.map(p => p.truth);

  const trainAcc = accuracy(train);
  const evalAcc = accuracy(evalSet);
  const trainConst = constantBaseline(trainTruth);
  const evalConst = constantBaseline(evalTruth);
  const trainRand = randomBaseline(trainTruth, 7);
  const evalRand = randomBaseline(evalTruth, 7);
  const trainDist = distribution(trainTruth);
  const evalDist = distribution(evalTruth);

  // Multi-seed sweep. The headline eval score is the mean over these seeds, because a
  // single split can be a lucky draw (seed 97 alone scores 1.0000).
  const sweepAccs = [];
  const sweepClassFail = Object.fromEntries(LABELS.map(l => [l, 0]));
  const sweepClassTot = Object.fromEntries(LABELS.map(l => [l, 0]));
  for (const seed of SWEEP_SEEDS) {
    const cases = buildSplit(PER, EVAL_BAND, seed).map(c => ({ ...c, refPng }));
    for (const c of cases) {
      const png = await renderSpec(c.spec, { scale: SCALE });
      const r = await classify(refPng, png);
      sweepClassTot[c.label]++;
      if (r.label === c.label) sweepAccs.push({ seed, ok: true });
      else { sweepAccs.push({ seed, ok: false }); sweepClassFail[c.label]++; }
    }
  }
  const sweepMean = sweepAccs.filter(a => a.ok).length / sweepAccs.length;
  const evalAccMean = sweepMean;   // headline: robust across seeds, not one lucky split

  // ---------------------------------------------------------------- report
  const lines = [];
  lines.push(`benchmark: ui-defect-classification  classes=${LABELS.length}  train_n=${train.length}  eval_n=${evalSet.length}  sweep_seeds=${SWEEP_SEEDS.length}`);
  lines.push('');
  lines.push('REQUIRED SINGLE-LINE REPORT (model / constant / random / train dist / eval dist)');
  lines.push(`TRAIN model=${trainAcc.toFixed(4)} const=${trainConst.score.toFixed(4)} rand=${trainRand.score.toFixed(4)} train_dist=${fmtDist(trainDist)} eval_dist=${fmtDist(evalDist)} split=train`);
  lines.push(`EVAL  model=${evalAccMean.toFixed(4)} const=${evalConst.score.toFixed(4)} rand=${evalRand.score.toFixed(4)} train_dist=${fmtDist(trainDist)} eval_dist=${fmtDist(evalDist)} split=eval`);
  lines.push('');

  // Degeneracy gate — the brief's hard requirement.
  const trainClasses = LABELS.filter(l => trainDist[l] > 0).length;
  const evalClasses = LABELS.filter(l => evalDist[l] > 0).length;
  const minShare = Math.min(...LABELS.map(l => evalDist[l] / evalSet.length));
  lines.push(`degeneracy: train_classes=${trainClasses} eval_classes=${evalClasses} eval_least_frequent_share=${minShare.toFixed(4)}`);
  if (trainClasses < 2 || evalClasses < 2) lines.push('*** STOP: a split collapsed to a single label — labelling is broken ***');
  lines.push('');

  // Sweep detail — exposes per-class weakness that a single split hides.
  const sweepFails = LABELS.filter(l => sweepClassFail[l] > 0);
  lines.push(`sweep: mean=${sweepMean.toFixed(4)} single_split_seed97=${evalAcc.toFixed(4)} over ${SWEEP_SEEDS.length} seeds x ${evalSet.length} cases`);
  lines.push(`  per-class failures across sweep: ${LABELS.map(l => l + ':' + sweepClassFail[l] + '/' + sweepClassTot[l]).join(',')}`);
  if (sweepFails.length) lines.push(`  WEAK CLASSES: ${sweepFails.map(l => `${l} (${(100 * sweepClassFail[l] / sweepClassTot[l]).toFixed(1)}% fail)`).join(', ')}`);
  lines.push('');

  // Distinct-render gate. Guards against the failure this benchmark originally had:
  // coordinate quantization collapsed a whole band into a handful of byte-identical
  // images, so the score measured 7 inputs while claiming 24 cases.
  // Distinct-render gate, at two levels of sensitivity.
  //
  // The per-class check (do all 4 cases differ?) is necessary but WEAK: it is trivially
  // satisfied when a class's whole-band ceiling is only ~15 images, which is exactly how the
  // paint-quantization defect hid. So we also probe each class across MANY magnitudes and
  // require most of them to be unique, independent of how many cases the split happens to use.
  const { createHash } = await import('node:crypto');
  const h = buf => createHash('sha256').update(buf).digest('hex');
  const uniqEval = new Set(evalSet.map(p => h(p.png)));
  const perClass = {};
  for (const l of LABELS) perClass[l] = new Set(evalSet.filter(p => p.truth === l).map(p => h(p.png))).size;
  const perClassCount = {};
  for (const l of LABELS) perClassCount[l] = evalSet.filter(p => p.truth === l).length;
  lines.push(`distinct renders: scale=${SCALE} eval_slots=${evalSet.length} distinct_images=${uniqEval.size} per_class=${LABELS.map(l => l + ':' + perClass[l] + '/' + perClassCount[l]).join(',')}`);

  // Band-ceiling probe: 24 magnitudes spanning the band, per class.
  const PROBE_N = 24;
  const ceiling = {};
  for (const l of LABELS) {
    if (l === 'clean') { ceiling[l] = 1; continue; }   // clean is one image by definition
    const s = new Set();
    for (let i = 0; i < PROBE_N; i++) {
      const mag = EVAL_BAND[0] + (i / (PROBE_N - 1)) * (EVAL_BAND[1] - EVAL_BAND[0]);
      s.add(h(await renderSpec(applyDefect(cleanSpec(), l, mag).spec, { scale: SCALE })));
    }
    ceiling[l] = s.size;
  }
  lines.push(`band ceiling (distinct images over ${PROBE_N} magnitudes): ${LABELS.map(l => l + ':' + ceiling[l] + '/' + PROBE_N).join(',')}`);

  const dupClasses = LABELS.filter(l => l !== 'clean' && perClassCount[l] > 1 && perClass[l] < perClassCount[l]);
  // `clean` is exempt: every clean case is by definition the unmodified spec, so a single
  // distinct image there is correct rather than collapsed.
  const lowCeiling = LABELS.filter(l => l !== 'clean' && ceiling[l] < PROBE_N * 0.9);
  if (dupClasses.length) lines.push(`WARNING: quantization is collapsing the split — classes lacking per-case variety: ${dupClasses.join(',')}`);
  if (lowCeiling.length) lines.push(`WARNING: quantization is limiting the band — classes with a low ceiling: ${lowCeiling.map(l => `${l} (${ceiling[l]}/${PROBE_N})`).join(', ')}`);
  lines.push('');

  // Constant-predictor sanity: must never beat the least-frequent class share.
  lines.push('baseline sanity:');
  lines.push(`  constant predictor emits "${trainConst.label}" (train) / "${evalConst.label}" (eval)`);
  lines.push(`  constant eval score ${evalConst.score.toFixed(4)} >= least-frequent share ${minShare.toFixed(4)} -> ${evalConst.score >= minShare - 1e-9 ? 'OK' : 'BUG'}`);
  lines.push(`  random eval score  ${evalRand.score.toFixed(4)} ~= 1/${LABELS.length} = ${(1 / LABELS.length).toFixed(4)}`);
  lines.push('');

  // Verdict — decided on the sweep mean, not the single lucky split.
  const beatsConst = evalAccMean > evalConst.score;
  lines.push(`VERDICT: eval model(sweep mean) ${evalAccMean.toFixed(4)} vs constant ${evalConst.score.toFixed(4)} -> ${beatsConst ? 'MODEL BEATS CONSTANT' : 'FAILED ROUND (does not beat constant)'}`);
  lines.push('');

  // Confusion
  lines.push('confusion (rows=truth, cols=pred) for the single seed-97 split:');
  const cm = confusion(evalSet);
  lines.push('  ' + 'truth\\pred'.padEnd(12) + LABELS.map(l => l.slice(0, 8).padEnd(10)).join(''));
  for (const t of LABELS) lines.push('  ' + t.padEnd(12) + LABELS.map(p => String(cm[t][p]).padEnd(10)).join(''));
  lines.push('');

  if (evalAcc < 1) {
    lines.push('eval errors (seed-97 split):');
    for (const p of evalSet.filter(x => x.pred !== x.truth)) {
      lines.push(`  ${p.id} truth=${p.truth} pred=${p.pred} conf=${p.confidence} :: ${p.reason}`);
    }
    lines.push('');
  }

  const report = lines.join('\n');
  if (asJson) {
    console.log(JSON.stringify({
      trainAcc,
      evalAcc: evalAccMean,          // headline: sweep mean
      evalAccSingleSplit: evalAcc,   // seed-97 split, for transparency
      sweepMean, sweepSeeds: SWEEP_SEEDS.length,
      sweepClassFail, sweepClassTot,
      trainConst: trainConst.score, evalConst: evalConst.score,
      trainRand: trainRand.score, evalRand: evalRand.score,
      trainDist, evalDist, minShare, beatsConst,
      confusion: cm,
      errors: evalSet.filter(x => x.pred !== x.truth).map(x => ({ id: x.id, truth: x.truth, pred: x.pred, conf: x.confidence, reason: x.reason })),
    }, null, 2));
  } else {
    console.log(report);
  }

  // Hand-checked worked example: a single geometry case, measured by hand above.
  if (handCheck) {
    console.log('--- HAND CHECK ---');
    const hc = evalSet.find(p => p.truth === 'geometry');
    const m = await measurePair(hc.refPng, hc.png);
    console.log(`case ${hc.id}: truth=${hc.truth} pred=${hc.pred}`);
    console.log(`  fracMid=${m.fracMid.toFixed(4)} fracBot=${m.fracBot.toFixed(4)} geoEnergy=${m.geoEnergy.toFixed(3)} dHue=${m.dHue.toFixed(1)} dSat=${m.dSat.toFixed(4)} dLum=${m.dLum.toFixed(3)}`);
    console.log(`  work-by-hand: the hero panel is displaced by +18*${hc.mag}=${(18 * hc.mag).toFixed(1)}px x and +14*${hc.mag}=${(14 * hc.mag).toFixed(1)}px y.`);
    console.log(`  The hero band sits in the middle vertical third, so fracMid should dominate -> geometry. Got fracMid=${m.fracMid.toFixed(3)}.`);
  }

  // Non-zero exit if the eval split fails to beat the constant predictor.
  if (!beatsConst) process.exitCode = 2;
}

main().catch(e => { console.error(e); process.exit(1); });
