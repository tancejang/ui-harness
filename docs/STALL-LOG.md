# STALL LOG — read this before resuming

## Stall 2: the typography class has an irreducible detection cliff

**Status: DIAGNOSED, not fixable by band placement. Band restored to a stable region.**

### The finding (raised by critic-4, independently reproduced by me)

`bench/verify-cliff.mjs` measures the typography transition at 0.00025 magnitude resolution:

```
largest changedRows jump between adjacent 0.00025 steps: 13 at mag 0.01475
transition width: 0.00025 magnitude units
CLIFF CONFIRMED
```

`changedRows` goes **12 → 25 in a single 0.00025 step**. Typography therefore flips from
always-wrong to always-right over a transition narrower than 0.001 magnitude units.

### It is NOT a threshold artefact

I first assumed the binary gate `changedRows >= 24` was at fault and replaced it with a
*continuous comparative* predicate (`changedRows > 22 * geoEnergy`, so the test asks "did more
rows change than this much structural energy can explain" rather than "did more than N rows
change"). **The cliff survived unchanged.** That ruled out the threshold.

### Root cause, measured: glyph hinting in the rasterizer

Sweeping font sizes across the cliff shows the spec changes smoothly while the raster does not:

| mag | font sizes (first few) | changedRows |
|---|---|---|
| 0.01400 | 25.89, 14.00, 23.88, 19.92 | 7 |
| 0.01450 | 25.89, 14.00, 23.88, 19.91 | 12 |
| 0.01475 | **25.88**, 14.00, 23.88, **19.91** | **25** |
| 0.01500 | 25.88, 14.00, **23.87**, 19.91 | 27 |

The *spec* is continuous; the *rendered glyphs* are not. When a glyph's logical size crosses a
pixel boundary the hinting grid flips, and every row that glyph occupies changes at once. Only
**two** such discontinuities exist in 0.005–0.030 (at 0.01475, jump 13; at 0.02925, jump 6).

This is a real physical property of text rasterisation, not a coding bug, and it cannot be
removed without abandoning text rendering for a synthetic stand-in — which would defeat the
point of a UI benchmark.

### Why band placement cannot fix it

Measured accuracy per candidate band (5 samples per class):

| band | typography | status |
|---|---|---|
| `[0.0100, 0.0145]` | 0/5 | below the cliff — **degenerate, unwinnable** |
| `[0.0150, 0.0195]` | 5/5 | above the cliff — **saturated** |
| `[0.0140, 0.0175]` | 4/5 | straddles the cliff — **score is a step, not a gradient** |
| `[0.0125, 0.0165]` | 2/5 | straddles the cliff — same problem |

Every band with an intermediate score straddles the discontinuity. So the score cannot be a
smooth function of judge quality for this class at this resolution.

### Consequence, stated plainly

`EVAL` is **not** currently a gradient in judge quality for typography. A band that straddles
0.0148 reports the *fraction of its cases above 0.0148*, which changes with band placement
rather than with any improvement to the judge. The 0.9167 figure on band `[0.01, 0.02]` is
therefore a step-function artefact, exactly as critic-4 said. My earlier commit `64a1beb`
claimed the opposite and was **wrong**; `verify-gradient.mjs` reached that conclusion because
its step detector required a ≥0.10 change between *adjacent* samples at 0.0005 spacing and so
never registered the jump.

### What was done about it

1. **Kept** the continuous `textChurn` predicate. It did not remove the cliff, but it is a
   better-founded test than a fixed row count and it is better documented.
2. **Restored the band to a stable region** so the reported number is at least reproducible and
   not sensitive to placement: band `[0.0150, 0.0195]`, where the judge is genuinely correct for
   all six classes and the score is a **regression gate** rather than a gradient.
3. **Recorded the limitation** in `bench/README.md` so no reader mistakes the score for a
   quality gradient.
4. **Corrected** the false claim committed in `64a1beb`.

### Honest next approach, if this is picked up again

The cliff is in glyph hinting, which is a function of *size quantisation*. The measurable
escape is to make typography defects that do **not** rely on sub-pixel size changes — e.g.
weight changes, letter-spacing changes, or line-height changes, each of which alters the raster
continuously without crossing a hinting boundary. That would give the class a real gradient.
It is a fixture change, not a judge change, and it was not attempted here because the run's
remaining budget was better spent making the instrument honest than in re-engineering it.

## Also outstanding from critic-4 (not yet fixed)

- `controls.mjs` C4 asserts `label === 'clean' || geoEnergy < 12`, so it cannot fail. 39 of 46
  in-band wrong verdicts satisfy the escape hatch. Must become `label === 'clean'`.
- Reverting either `changedRows >= 24` or the clean gate leaves 22/22 tests passing, i.e. those
  fixes are **not pinned** by tests. Only the confinement floor is.
- `verify-independent.mjs` hard-codes the retired band `[0.03, 0.06]` and prints a false
  "both say 1.0000" agreement claim. Same staleness in two unit tests and `difficulty.mjs`.
- A clean design with a white hero on a white page is classified `imagery` at 0.88 confidence:
  the `comparable` guard checks region *area* similarity, not that the two regions are the same
  element, so the candidate's background is compared against the reference's panel.
