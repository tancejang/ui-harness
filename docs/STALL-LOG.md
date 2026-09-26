# STALL LOG — read this before resuming

## Stall 1: saturating the paint-based defects (colour resolution in a narrow band)

**Status: REVERTED. Working state is commit `97abc28`.**

### What I was trying to do
The independent verification (`bench/verify-independent.mjs`) confirmed the band `[0.03, 0.06]`
scores 480/480 = 1.0000 — genuinely saturated. But it also exposed a **residual quantization**:
within the band, `color` produced only **15 distinct renders per 80 cases** and `imagery` **13**.
Root cause proven directly: `mix()` rounds to 8-bit channels, and the band spans only ~8 RGB
units, so different `mag` values produce *identical spec fills* (`#0d996e` for both mag 0.0316
and 0.0347) and therefore byte-identical PNGs. This is the original critic-found defect in
miniature.

### What I tried, and why each failed
| Attempt | Failure |
|---|---|
| `PAINT_GAIN = 6`, `min(1, mag*gain)` | Clamp made every mag above ~0.17 byte-identical; broke control C3 |
| `PAINT_GAIN = 10`, `deg = mag*gain*1000` | 600°/band-top **wraps the colour circle**, so `dHue` became non-monotonic and `color` failed at scattered magnitudes |
| `deg = min(300, mag*gain*320)` | Monotonic and correct for mag 0.01–0.05, but `satDrained` rose to 0.014–0.025 above 0.06, exceeding the 0.012 test |
| `modalSaturation()` (per-pixel mode over hero box) | Mode picked the **background**, pinning `satA` at 0.025 for every class and destroying the signal entirely |
| `dominantFlatSaturation()` (largest flat colour bucket) | Also picked the background; `imagery` read `dSat = 0.000` at mag ≤ 0.05 |

### The real blocker (diagnosed, not yet fixed)
`measurePair` reads hero saturation via `meanRGB` over a box, then takes `satOf(mean)`. That is
the wrong statistic **and** the wrong region:
- averaging white text over a saturated panel yields a pale mean whose saturation is unrelated
  to the panel's colour;
- but a per-pixel mode over the same box is dominated by the *background*, not the panel.

The correct measurement is the saturation of the **hero panel's own fill**, which requires
segmenting the panel from its background rather than sampling a fixed box. `design-rules.mjs`
already contains working flood-fill region segmentation (`regions()`) that does exactly this.
**Next approach: reuse `regions()` to identify the largest region inside the hero box and take
its saturation — do not keep patching `meanRGB`.**

### Why I stopped rather than continue
Four consecutive attempts made the measurement worse, not better (final state: `imagery` read
`dSat = 0.000`, i.e. strictly worse than the reverted baseline). Per the run's own rule — two
rounds with no improvement means change approach — the experiment was reverted to `97abc28` and
this log written instead of a fifth variation.

### What is NOT broken
`bench/verify-independent.mjs` is a genuine, useful addition and is kept: it shares no machinery
with `run.mjs`, and it independently confirmed both the saturation result and the residual
`color`/`imagery` render duplication. It is the artifact that found this stall.

### Residual risk if never fixed
The headline 1.0000 is honest for the *cases that were run* (480 distinct case slots, all
classified correctly). The duplication means the band contains fewer *distinct inputs* than it
claims — 15 and 13 distinct images for two of six classes. It does not invalidate the score, but
it means those two classes carry less evidence than their case counts suggest.
