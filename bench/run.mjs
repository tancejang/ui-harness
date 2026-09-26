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

import { generateCases, renderSpec, cleanSpec } from './fixture.mjs';
import { classify, measurePair, decide } from './judge.mjs';

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
      if (cls === 'clean') {
        out.push({ id: `${seed}-${String(n).padStart(3, '0')}`, label: 'clean', mag: 0, spec: { W: base.W, H: base.H, prims: base.prims.map(p => ({ ...p, box: [...p.box] })) } });
        continue;
      }
      const mag = band[0] + rand() * (band[1] - band[0]);
      const { spec, label } = perturb(base, cls, mag);
      out.push({ id: `${seed}-${String(n).padStart(3, '0')}`, label, mag: +mag.toFixed(3), spec });
    }
  }
  return out;
}

// Re-implement perturbations locally so the bands are independent of fixture.mjs defaults.
function perturb(base, cls, mag) {
  const s = { W: base.W, H: base.H, prims: base.prims.map(p => ({ ...p, box: [...p.box] })) };
  const sel = k => s.prims.filter(p => p.kind === k);
  const move = (k, dx, dy) => { for (const p of sel(k)) { p.box[0] += Math.round(dx); p.box[1] += Math.round(dy); } };
  switch (cls) {
    case 'geometry':
      move('hero-panel', 18 * mag, 14 * mag); move('hero-text', 18 * mag, 14 * mag); move('hero-sub', 18 * mag, 14 * mag);
      break;
    case 'typography':
      for (const p of sel('header-text')) p.size = Math.round(p.size * (1 - 0.30 * mag));
      for (const p of sel('stat-value')) p.size = Math.round(p.size * (1 - 0.35 * mag));
      for (const p of sel('hero-text')) p.size = Math.round(p.size * (1 - 0.30 * mag));
      for (const p of sel('row-text-0')) p.size = Math.round(p.size * (1 - 0.25 * mag));
      break;
    case 'spacing': {
      const y0 = sel('button-primary')[0].box[1];
      for (const p of s.prims) if (p.box[1] >= y0) p.box[1] += Math.round(14 * mag);
      break;
    }
    case 'color':
      for (const p of sel('header-band')) p.fill = '#dc2626';
      for (const p of sel('hero-panel')) p.fill = '#d97706';
      break;
    case 'imagery':
      for (const p of sel('hero-panel')) p.fill = mag >= 0.85 ? '#ffffff' : '#e5e7eb';
      for (const p of sel('hero-text')) p.fill = mag >= 0.85 ? '#ffffff' : '#9ca3af';
      for (const p of sel('hero-sub')) p.fill = mag >= 0.85 ? '#ffffff' : '#9ca3af';
      break;
    default: throw new Error('bad class ' + cls);
  }
  return { spec: s, label: cls };
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

async function evaluate(pairs) {
  const out = [];
  for (const c of pairs) {
    const png = await renderSpec(c.spec);
    const r = await classify(c.refPng, png);
    out.push({ ...c, truth: c.label, png, pred: r.label, confidence: r.confidence, reason: r.reason, features: r.features });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const handCheck = args.includes('--hand');

  const refPng = await renderSpec(cleanSpec());

  // TRAIN: 4 per class, HIGH severity 0.75..1.00 — the "obvious defect" regime.
  //   Thresholds in judge.mjs were tuned against this split only.
  // EVAL (held out): 4 per class, LOW severity 0.06..0.11 — a different regime entirely.
  //   Chosen from bench/difficulty.mjs: below mag 0.12 the judge measurably breaks —
  //   spacing under-detects to `clean`, geometry drifts to `typography`, and typography
  //   drifts to `geometry`. That gradient is what improvement cycles push against.
  const trainRaw = buildSplit(4, [0.75, 1.0], 11).map(c => ({ ...c, refPng }));
  const evalRaw = buildSplit(4, [0.06, 0.11], 97).map(c => ({ ...c, refPng }));

  const train = await evaluate(trainRaw);
  const evalSet = await evaluate(evalRaw);

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

  // ---------------------------------------------------------------- report
  const lines = [];
  lines.push(`benchmark: ui-defect-classification  classes=${LABELS.length}  train_n=${train.length}  eval_n=${evalSet.length}`);
  lines.push('');
  lines.push('REQUIRED SINGLE-LINE REPORT (model / constant / random / train dist / eval dist)');
  lines.push(`TRAIN model=${trainAcc.toFixed(4)} const=${trainConst.score.toFixed(4)} rand=${trainRand.score.toFixed(4)} train_dist=${fmtDist(trainDist)} eval_dist=${fmtDist(evalDist)} split=train`);
  lines.push(`EVAL  model=${evalAcc.toFixed(4)} const=${evalConst.score.toFixed(4)} rand=${evalRand.score.toFixed(4)} train_dist=${fmtDist(trainDist)} eval_dist=${fmtDist(evalDist)} split=eval`);
  lines.push('');

  // Degeneracy gate — the brief's hard requirement.
  const trainClasses = LABELS.filter(l => trainDist[l] > 0).length;
  const evalClasses = LABELS.filter(l => evalDist[l] > 0).length;
  const minShare = Math.min(...LABELS.map(l => evalDist[l] / evalSet.length));
  lines.push(`degeneracy: train_classes=${trainClasses} eval_classes=${evalClasses} eval_least_frequent_share=${minShare.toFixed(4)}`);
  if (trainClasses < 2 || evalClasses < 2) lines.push('*** STOP: a split collapsed to a single label — labelling is broken ***');
  lines.push('');

  // Constant-predictor sanity: must never beat the least-frequent class share.
  lines.push('baseline sanity:');
  lines.push(`  constant predictor emits "${trainConst.label}" (train) / "${evalConst.label}" (eval)`);
  lines.push(`  constant eval score ${evalConst.score.toFixed(4)} >= least-frequent share ${minShare.toFixed(4)} -> ${evalConst.score >= minShare - 1e-9 ? 'OK' : 'BUG'}`);
  lines.push(`  random eval score  ${evalRand.score.toFixed(4)} ~= 1/${LABELS.length} = ${(1 / LABELS.length).toFixed(4)}`);
  lines.push('');

  // Verdict
  const beatsConst = evalAcc > evalConst.score;
  lines.push(`VERDICT: eval model ${evalAcc.toFixed(4)} vs constant ${evalConst.score.toFixed(4)} -> ${beatsConst ? 'MODEL BEATS CONSTANT' : 'FAILED ROUND (does not beat constant)'}`);
  lines.push('');

  // Confusion
  lines.push('confusion (rows=truth, cols=pred):');
  const cm = confusion(evalSet);
  lines.push('  ' + 'truth\\pred'.padEnd(12) + LABELS.map(l => l.slice(0, 8).padEnd(10)).join(''));
  for (const t of LABELS) lines.push('  ' + t.padEnd(12) + LABELS.map(p => String(cm[t][p]).padEnd(10)).join(''));
  lines.push('');

  if (evalAcc < 1) {
    lines.push('eval errors:');
    for (const p of evalSet.filter(x => x.pred !== x.truth)) {
      lines.push(`  ${p.id} truth=${p.truth} pred=${p.pred} conf=${p.confidence} :: ${p.reason}`);
    }
    lines.push('');
  }

  const report = lines.join('\n');
  if (asJson) {
    console.log(JSON.stringify({
      trainAcc, evalAcc,
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
