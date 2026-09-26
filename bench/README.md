# Held-out UI defect benchmark

This directory is the **improvement signal** for the self-improvement loop. The repo's own
`npm test` suite is deterministic and single-label (95/95), so a constant predictor scores
1.0000 on it; that suite is a *regression gate only* and must never be read as a quality score.

## What the task is

Given two PNGs — an approved **reference** and a candidate **render** — predict the dominant
defect class:

`geometry` · `typography` · `spacing` · `color` · `imagery` · `clean`

Six classes. A random predictor therefore sits at ≈1/6, and the constant predictor at the
majority-class share.

## Why it is not circular

The previous iteration of this repo shipped `test/fixtures/calibration-judge/`, which was a
byte-match lookup table returning hardcoded scores for known PNGs. It "passed" every ranking
because it echoed the labels it was given. It measured nothing.

This benchmark is different by construction:

- `fixture.mjs` renders a UI from a declarative spec, then injects **exactly one** defect class.
  The injected class is the held-out ground truth. Nothing in the renderer tells the judge.
- `judge.mjs` receives **only two PNG buffers**. It never sees the case id, the class, the
  perturbation, or the magnitude. Every verdict is a decision tree over measurements taken from
  the pixels (difference-energy centroids, band structure, gradient text mass, dominant hue,
  region saturation/luminance).

`controls.mjs` proves the point empirically:

| Control | What it shows |
|---|---|
| C1 label shuffle | Permuting the answer key collapses the score **1.0000 → 0.1250** |
| C2 unseen perturbation | A defect shape never tuned on (pure X displacement) is still flagged |
| C3 cross-class swap | Verdicts track pixels, and are bit-for-bit deterministic |
| C4 noise floor | 1px sub-threshold jitter reads as `clean`, not as a defect |
| C5 hand-check | Measured band structure matches geometry derived on paper before running code |

## Splits

| Split | Severity `mag` | Cases | Purpose |
|---|---|---|---|
| TRAIN | 0.75 – 1.00 | 24 | Obvious defects. Thresholds in `judge.mjs` were tuned only here. |
| EVAL (held out) | **0.06 – 0.11** | 24 | The regime where the judge measurably breaks. |

The eval band is not arbitrary. `difficulty.mjs` sweeps magnitude and finds the breakdown
points:

```
mag    geometry   typography  spacing    color      imagery    clean
0.15   ok         ok          ok         ok         ok         ok
0.12   ok         ok          ok         ok         ok         ok
0.10   ->typo     ok          ->clean    ok         ok         ok
0.06   ->typo     ->geo       ->clean    ok         ok         ok
0.04   ->typo     ->clean     ->clean    ok         ok         ok
```

Below `mag 0.12` three classes fail for three different reasons. Setting EVAL inside that band
is what gives the loop a real gradient (currently **eval 0.6667** with four errors in each of
`geometry` and `spacing`).

## Running it

```sh
node bench/run.mjs          # full report, all five required values on one line per split
node bench/run.mjs --json   # machine-readable
node bench/run.mjs --hand   # include the hand-checked worked example
node bench/controls.mjs     # adversarial controls; exits non-zero if any control fails
node bench/difficulty.mjs   # per-class breakdown point sweep
```

`run.mjs` exits `2` when the eval split fails to beat the constant predictor.

## Required reporting format

Every score line carries all five values:

```
TRAIN model=1.0000 const=0.1667 rand=0.0833 train_dist={...} eval_dist={...} split=train
EVAL  model=0.6667 const=0.1667 rand=0.0833 train_dist={...} eval_dist={...} split=eval
```

Baseline sanity is asserted, not assumed: the constant predictor must never fall below the
least-frequent class share, and must never score zero on a populated set.

## Known limitations

- The fixture is synthetic SVG geometry, not real application screenshots. It exercises the
  *measurement* logic honestly, but it is not yet evidence about real rendered app UI.
- `imagery` and `color` are not stressed at low magnitude by the current perturbations, so they
  contribute no gradient. Tightening them is an open improvement.
- The judge is a hand-written decision tree, not a learned model. It is auditable, which is the
  point at this stage, but it will not generalise to arbitrary UIs.
