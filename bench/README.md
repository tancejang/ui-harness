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

The band lives in **`eval-band.json`**, which is the single source of truth read by `run.mjs`
and `seed-sweep.mjs`. They used to carry independent copies and silently drifted apart.

| Split | Severity `mag` | Cases | Purpose |
|---|---|---|---|
| TRAIN | 0.75 – 1.00 | 24 | Obvious defects. Judge thresholds were set against this regime. |
| EVAL (held out) | **0.03 – 0.06** | 24 | The regime where the judge measurably breaks. |

### The band moves when it saturates — and one class cannot be graded by a band

A band that scores 1.0000 cannot distinguish a better judge from the current one. The band has
been lowered three times using `difficulty.mjs`:

| Band | Outcome |
|---|---|
| `[0.06, 0.11]` | First band after de-quantization. Solved to **30/30 perfect seeds**, retired. |
| `[0.03, 0.06]` | Second. Also solved to saturation, retired. |
| `[0.01, 0.02]` | Third. **Retired as unsound** — see the cliff below. |
| `[0.015, 0.0195]` | **Current.** Sits entirely above the cliff; the score is a regression gate. |

### The typography cliff (why the current band is not a "gradient")

`typography` has an **irreducible detection cliff at magnitude ≈ 0.0148**. Measured at 0.00025
resolution, `changedRows` jumps **12 → 25 in a single step**, so the class flips from
always-wrong to always-right across a transition narrower than 0.001.

This is **not** a threshold artefact. Replacing the binary gate with a continuous comparative
predicate (`changedRows > 22 × geoEnergy`) left the cliff unchanged. The cause is **glyph
hinting in the rasterizer**: the spec's font size is continuous (25.89 → 25.88) while the
rendered glyph grid is not, so crossing a pixel boundary re-snaps every row the glyph occupies.

Consequently **every band that yields an intermediate typography score straddles the cliff**, and
its score measures band placement rather than judge quality:

| band | typography | status |
|---|---|---|
| `[0.0100, 0.0145]` | 0/5 | below the cliff — degenerate |
| `[0.0150, 0.0195]` | 5/5 | above the cliff — saturated |
| `[0.0140, 0.0175]` | 4/5 | straddles the cliff — score is a step |
| `[0.0125, 0.0165]` | 2/5 | straddles the cliff — score is a step |

So the current band is placed **above** the cliff and the score is reported as a **regression
gate**, not a capability gradient. `seed-sweep.mjs` exits 3 when the band saturates, which is now
the expected steady state. See [`docs/STALL-LOG.md`](../docs/STALL-LOG.md) for the full diagnosis
and the suggested escape (use typography defects that do not depend on sub-pixel *size* changes,
such as weight, letter-spacing or line-height).

### Rendering resolution

Distinct renders across the band, at increasing sample density. `imagery` originally collapsed to
33/80 because its opacity span was too narrow; raising the gain fixed it.

| class | 24 samples | 48 | 80 |
|---|---|---|---|
| geometry | 24/24 | 48/48 | 80/80 |
| spacing | 24/24 | 48/48 | 80/80 |
| color | 24/24 | 48/48 | 80/80 |
| imagery | 24/24 | 48/48 | 80/80 |
| typography | 24/24 | 48/48 | **66/80** ← the hinting cliff |

`run.mjs` probes the band ceiling every run and warns when any non-clean class falls below 90%.


### Detection floors

The judge detects each defect down to these magnitudes (measured, `difficulty.mjs`):

| class | floor | equivalent displacement |
|---|---|---|
| geometry | 0.005 | 0.09 px |
| spacing | 0.005 | 0.07 px |
| imagery | 0.005 | — |
| color | 0.008 | — |
| typography | 0.015 | sub-pixel glyph change |
| clean | correct at every magnitude | — |

Below its floor a class reads as `clean`, which is the honest answer for an invisible edit; it
is never reported as a *different* defect class.

### Current difficulty map

```
mag     geometry   typography  spacing    color      imagery    clean
0.030   5/5        5/5         5/5        5/5        5/5        ok
0.020   5/5        5/5         5/5        5/5        5/5        ok
0.015   5/5        3/5         5/5        5/5        5/5        ok
0.010   5/5        0/5         5/5        5/5        5/5        ok
0.005   5/5        0/5         5/5        0/5        5/5        ok
```

`typography` is the earliest class to break, which is why the current band starts at 0.010.


## Running it

```sh
node bench/run.mjs             # full report, all five required values on one line per split
node bench/run.mjs --json      # machine-readable
node bench/run.mjs --hand      # include the hand-checked worked example
node bench/controls.mjs        # adversarial controls; exits non-zero if any control fails
node bench/seed-sweep.mjs 30   # robustness across seeds; prints SATURATED if the band is solved
node bench/difficulty.mjs      # per-class breakdown point sweep (re-derive the band with this)
node bench/design-rules-smoke.mjs  # [MEASURABLE] rubric rules incl. hand-derived assertions
```

`run.mjs` exits `2` when the eval split fails to beat the constant predictor.

## Required reporting format

Every score line carries all five values:

```
TRAIN model=0.8750 const=0.1667 rand=0.0833 train_dist={...} eval_dist={...} split=train
EVAL  model=1.0000 const=0.1667 rand=0.0833 train_dist={...} eval_dist={...} split=eval
```

The EVAL figure is the **mean over a 12-seed sweep**, not the single seed-97 split. On the
original band seed 97 scored 1.0000 while the 30-seed mean was 0.964; reporting one seed would
repeat exactly the defect this benchmark exists to avoid. The single-split value is printed
alongside as `single_split_seed97=` so it can never be mistaken for the headline.


Baseline sanity is asserted, not assumed: the constant predictor must never fall below the
least-frequent class share, and must never score zero on a populated set.

## Design grounding

Verdicts are meant to cite sourced design rules, not ad-hoc taste. *Refactoring UI*
(Wathan & Schoger, 252pp) was supplied for this purpose and is distilled into
[`docs/DESIGN-RUBRIC.md`](../docs/DESIGN-RUBRIC.md): 57 rules with IDs, source pages, and an
`[MEASURABLE]` marker where a pixel test exists. `design-rules.mjs` implements the measurable
ones, and `design-rules-smoke.mjs` asserts them — including 12 checks whose expected values
were derived by hand from the WCAG formula before any code ran.

Measured against the benchmark fixture, the reference screen itself **fails two rules**:

| Rule | Measurement |
|---|---|
| CO-6 (contrast) | text contrast p05 = 2.55, p50 = 4.39; WCAG body text needs ≥ 4.5 |
| SP-2/3 (spacing system) | gaps `4,12,24,28,32` → `24→28` ratio 1.167, `28→32` ratio 1.143; the book requires ≥ 1.25 |

## Known limitations

These are the findings a critic raised that are **not** yet fixed, plus the structural limits of
the approach. They are listed so nobody mistakes a passing score for more than it is.

### Adversarial cases the judge gets wrong (found by a critic, still open)
- **Pale hero panels defeat `imagery` entirely.** `verify-imagery-pale.mjs` bounds this precisely:
  across 6 panel colours × 5 severities, imagery is detected in 15/30 combinations, and
  **every single miss is on a near-neutral panel** (saturation 0.011–0.033); there are zero
  misses on a saturated panel. For a panel already at the overlay colour, `dSat` is exactly
  `-0.000` — the wash-out is a mathematical no-op, so *no* saturation-based algorithm could
  detect it. This is a limitation of the defect **model**, not a coding bug, and it is not fixed
  by moving a threshold (which would break the saturated cases).
- Washing out the **stat cards** instead of the hero reads as `clean`.
- A hero rendered as a **gradient** (realistic artwork) is ambiguous; it falls to a fallback.
- **Combined defects** (geometry + color, geometry + typography) collapse to a single class. The
  task declares exactly one class per case, so multi-defect screens are unhandled by design —
  but real screens have them.
- `verify-palette.mjs` measures 179/200 across eight accent colours; the 21 misses are the same
  degenerate grey/near-white cases described above, not independent failures.


### Structural limits
- The fixture is synthetic SVG geometry, not real application screenshots. It exercises the
  *measurement* logic honestly, but it is **not** evidence about real rendered app UI.
- One fixture layout (480×720 dashboard). Nothing here generalises across layouts.
- No photography, no blur/shadow, no real font rasterisation, no text of varying length.
- The judge is a hand-written decision tree, not a learned model. It is auditable, which is the
  point at this stage, but it will not generalise to arbitrary UIs. Its constants are documented
  with the measurements that justify them; the critic showed two of them (`satA > 0.05` and
  `churnRatio > 50`) were originally band- or palette-fitted, and both have since been replaced.
- `clean` legitimately renders one distinct image, so the distinct-render gate exempts it.

### What the score does and does not mean
A score of 0.9167 on the current band means the classifier resolves six synthetic defect classes
at sub-pixel magnitudes on one fixture layout. It does **not** mean ui-harness produces better UI,
and it does not measure design quality at all — the defect classes are *detection* categories,
not quality grades. See [DESIGN-RUBRIC.md](../docs/DESIGN-RUBRIC.md) for the mapping between them.


