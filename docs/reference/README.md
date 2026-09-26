# Figures from *Refactoring UI* — and what they add over the prose

The book is 252 pages with **284 embedded figures across 191 pages**. The prose alone (111KB of
text) describes rules qualitatively; the figures carry the *values*. This directory holds both,
so the rubric can state **which** values rather than just **how many**.

## Provenance

| artifact | what it is |
|---|---|
| `refactoring-ui-outline.json` | the book's 153-entry table of contents with page numbers |
| `figures/pNNN-i.png` | all 284 embedded figures, extracted at full resolution (1480px wide) |
| `figures/manifest.json` | page, filename and dimensions for each figure |
| `figure-data.json` | the figures sampled into machine-readable numbers |

Extraction used `pypdf` for text and embedded images (no heavy dependencies). PDF-Extract-Kit was
considered and rejected: it needs PyTorch plus several large models (~5–10GB) and only 5.5GB was
free on the drive, and it is aimed at layout/table/formula recovery, none of which this book
needs. `pypdf` already returns the figures as full-resolution PNGs.

## What the figures added

### 1. The actual spacing scale (p.73)

The prose says only *"no two values should be closer than about 25%"*. The figure prints the
scale itself:

```
4  8  12  16  24  32  48  64  96  128  192  256  384  512  640  768   (px)
```

Every value is a multiple or simple fraction of **16**. This turns SP-2/SP-3 from "the gaps look
non-linear" into a falsifiable test: **an observed gap should land on this scale**, within
rasterisation tolerance.

### 2. Shade ramps, and why they matter (pp.150–151)

The prose says *"you'll need at least 5 shades per color, probably closer to 10"*. The figures
give the ramps. Sampling them yields, for the blue ramp:

```
#1f2c6d  #253586  #3547a4  #495dc6  #6175de  #758ce0  #95aeed  #d4def8  #f0f4fe
 L 27.5%  33.5%    42.5%    53.1%    62.5%    66.9%    75.7%    90.2%    96.9%
 S 55.7%  56.7%    51.2%    52.3%    65.4%    63.3%    71.0%    72.0%    87.5%
 H 230.0  230.1    230.3    230.4    230.4    227.1    223.0    223.3    222.9
```

and for the grey ramp:

```
#212934  #404b5a  #6e7a8a  #929fb1  #aebecd  #ccd4db  #d5dde5  #e1e7ec  #f8f9fa
 L 16.7%  30.2%    48.6%    63.3%    74.3%    82.9%    86.7%    90.4%    97.6%
 S 22.4%  16.9%    11.3%    16.6%    23.7%    17.2%    23.5%    22.4%    16.7%
 H 214.7  214.6    214.3    214.8    209.0    208.0    210.0    207.3    210.0
```

**Two rules become numerically testable**, which they were not before:

- **CO-4 "don't let lightness kill your saturation"** — along the book's own blue ramp,
  saturation *rises* with lightness: 55.7% at L=27.5% up to 87.5% at L=96.9%. A ramp whose
  saturation collapses toward zero as it lightens violates the rule.
- **CO-5 "greys don't have to be grey"** — the grey ramp holds a **cool hue of ~207–215°** at
  every step. It is never neutral. A pure `#808080`-style ramp violates the rule.

### 3. The two-part shadow recipe (pp.185–187)

The prose describes it; the figures show the two layers (a large soft ambient plus a tight
directional one) and the elevation progression.

## Honest limitations of this data

- Colours are sampled from a **raster rendering of a print book**, so they are approximate.
  The smoke test therefore asserts *structural* properties (monotonic lightness, hue stability,
  step count, saturation not collapsing) rather than exact hex equality.
- The spacing scale values are read from the figure's printed labels, which are legible; they are
  recorded as a literal list rather than OCR'd, so no OCR error is possible.
- Not every one of the 284 figures has been interpreted. Those sampled here are the ones that
  back a specific `[MEASURABLE]` rule in `docs/DESIGN-RUBRIC.md`. The rest remain available for
  later rules.
