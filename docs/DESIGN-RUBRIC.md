# Mobile / product UI design rubric — grounded in *Refactoring UI*

Source: *Refactoring UI* by Adam Wathan & Steve Schoger (252pp). Extracted text lives at
`.uih/agent/pdf/text.txt`; the 153-entry outline is at `docs/reference/refactoring-ui-outline.json`.

**Both the prose and the figures are used.** The prose states rules of thumb; the **284 figures**
state the values. See [`docs/reference/README.md`](reference/README.md) for what the figures
added, and `bench/review-knowledge.mjs` for the executable form of the `[MEASURABLE]` rules.

| source | what it gives | example |
|---|---|---|
| prose | the rule | "no two values closer than ~25%" (p.71) |
| **figures** | **the values** | the scale itself: `4 8 12 16 24 32 48 64 96 128 192 256 384 512 640 768` (p.73) |
| prose | the rule | "you need 5-10 shades" (p.150) |
| **figures** | **the values** | the blue ramp, where saturation *rises* 55.7% → 87.5% as lightness goes 27.5% → 96.9% |

Both levels matter. A reviewer with only the prose can say "your spacing looks inconsistent";
with the figures it can say "28px is not on the scale — the nearest steps are 24 and 32".

This file exists so that critic verdicts cite **specific, sourced design rules** instead of
ad-hoc taste. Every rule has an ID, a source page, and — where the benchmark can measure it —
an operational test. Rules marked `[MEASURABLE]` are the ones the pixel judge can actually
adjudicate; the rest constrain human/model review.

How to use this in a critique:
- Cite the rule ID and page, e.g. "violates SP-4 (p.95): spacing does not scale proportionally".
- Prefer `[MEASURABLE]` rules when a pixel verdict is available; they are falsifiable.
- If a finding maps to no rule here, say so explicitly and mark it as unsourced judgement.

## Rules now backed by measured values rather than description

| ID | was | now |
|---|---|---|
| SP-2 | "no two values closer than ~25%" | gaps must land **on** the book's scale, queryable via `snapToSpacingScale(px)` |
| CO-4 | "don't let lightness kill saturation" | the light end must keep ≥60% of the dark end's saturation; the book's own blue ramp keeps 129% |
| CO-5 | "greys don't have to be grey" | greys must share a hue within 20° and hold ≥5% saturation; the book's grey ramp sits at 213° ± 2.9° |
| CO-6 | "accessible doesn't have to mean ugly" | measured on **plateau** edges, not antialiased ones — see the note in `bench/design-rules.mjs` |

---

## HI — Hierarchy (ch. 2, pp.34–63)

| ID | Rule | Source | Test |
|---|---|---|---|
| HI-1 | Not all elements are equal; establish a deliberate hierarchy. | p.35 | `[MEASURABLE]` ratio of primary to secondary text size ≥ 1.25 |
| HI-2 | Size isn't everything — vary weight and colour too, not just scale. | pp.37–41 | `[MEASURABLE]` primary/secondary must differ in ≥ 2 of {size, weight, colour} |
| HI-3 | Do not use grey text on coloured backgrounds; it looks washed out and muddy. | pp.41–45 | `[MEASURABLE]` text on a saturated ground must use a tint of the ground hue, not neutral grey |
| HI-4 | Emphasise by de-emphasising: soften the competing element rather than shouting louder. | pp.45–47 | review |
| HI-5 | Labels are a last resort — combine label and value, or drop the label. | pp.47–51 | review |
| HI-6 | Separate visual hierarchy from document hierarchy; do not let markup dictate emphasis. | p.53 | review |
| HI-7 | Balance weight and contrast: use contrast to compensate for weight, and vice versa. | pp.55–57 | `[MEASURABLE]` low-contrast text must carry higher weight |
| HI-8 | Semantics are secondary; destructive actions need deliberate treatment. | pp.59–61 | review |

## SP — Layout & spacing (ch. 3, pp.64–99)

| ID | Rule | Source | Test |
|---|---|---|---|
| SP-1 | Start with too much white space, then remove it — never start cramped. | pp.65–68 | `[MEASURABLE]` per-element padding ≥ 1 spacing step |
| SP-2 | Establish a spacing/sizing system; no two steps closer than ~25%. | pp.69–72 | `[MEASURABLE]` observed gaps cluster on a scale where adjacent values differ ≥ 25% |
| SP-3 | A linear scale (e.g. "everything is a multiple of 4") does not work; the low end needs finer steps. | p.71 | `[MEASURABLE]` gap ratios are non-linear (small steps dense, large steps sparse) |
| SP-4 | Relative/proportional scaling does not scale — sizing relationships change with context. | pp.91–95 | `[MEASURABLE]` nested padding must not be a uniform scale factor |
| SP-5 | Avoid ambiguous spacing: proximity must make grouping unambiguous. | pp.95–99 | `[MEASURABLE]` within-group gap < between-group gap (strictly) |
| SP-6 | You don't have to fill the whole screen; shrink the canvas instead of stretching content. | pp.75–78 | `[MEASURABLE]` content max-width < viewport when line length would exceed the limit |
| SP-7 | Grids are overrated; not all elements should be fluid. | pp.83–89 | review |

## TY — Typography (ch. 4, pp.100–135)

| ID | Rule | Source | Test |
|---|---|---|---|
| TY-1 | Establish a type scale; avoid arbitrary one-off sizes. | pp.101–105 | `[MEASURABLE]` distinct font sizes ≤ 6 and cluster on a scale |
| TY-2 | Avoid `em` units for type scale; they compound unpredictably. | p.105 | review (code-level) |
| TY-3 | Use good fonts; require ≥5 weights; optimise for legibility. | pp.107–111 | review |
| TY-4 | Keep line length in check (~45–75 characters). | pp.113–116 | `[MEASURABLE]` measured copy column ≤ ~75ch |
| TY-5 | Align baselines, not centres, when placing text beside other elements. | pp.117–120 | `[MEASURABLE]` text baseline aligns to adjacent element's baseline, not its centre |
| TY-6 | Line-height is proportional: looser for long lines, tighter for large text. | pp.121–124 | `[MEASURABLE]` line-height ratio decreases as font size increases |
| TY-7 | Not every link needs a colour; over-colouring competes for attention. | pp.125–127 | `[MEASURABLE]` count of coloured affordances on a screen stays bounded |
| TY-8 | Align with readability in mind: don't centre text longer than 2–3 lines. | pp.127–129 | `[MEASURABLE]` centred text blocks span ≤ 3 lines |
| TY-9 | Right-align numbers in columns. | p.129 | `[MEASURABLE]` numeric cells share a right edge |
| TY-10 | Use letter-spacing deliberately: tighten headlines, loosen all-caps. | pp.131–135 | `[MEASURABLE]` headline tracking < body tracking; all-caps tracking > body |

## CO — Colour (ch. 5, pp.136–169)

| ID | Rule | Source | Test |
|---|---|---|---|
| CO-1 | Work in HSL, not hex; reason about hue/saturation/lightness separately. | pp.137–139 | review |
| CO-2 | You need more colours than you think: a full grey ramp plus primary and accent ramps. | pp.141–146 | `[MEASURABLE]` distinct greys used ≥ 5 for a full screen |
| CO-3 | Define shades up front (base colour first, then edges, then fill the gaps). | pp.147–150 | review |
| CO-4 | Don't let lightness kill saturation: brightening a colour must not desaturate it into pastel. | pp.151–153 | `[MEASURABLE]` saturated tokens keep saturation ≥ ~40% across the ramp |
| CO-5 | Greys don't have to be grey — use temperature (warm/cool) for cohesion. | pp.157–159 | `[MEASURABLE]` greys share a consistent hue offset, not pure neutral |
| CO-6 | Accessible doesn't have to mean ugly: flip contrast or rotate hue instead of going grey-on-grey. | pp.161–163 | `[MEASURABLE]` contrast ratio ≥ 4.5:1 for body text |
| CO-7 | Don't rely on colour alone to convey meaning. | p.165 | `[MEASURABLE]` status conveyed by ≥ 2 channels (colour + icon/text/shape) |

## DE — Depth (ch. 6, pp.170–197)

| ID | Rule | Source | Test |
|---|---|---|---|
| DE-1 | Emulate a single light source; light comes from above. | pp.171–174 | `[MEASURABLE]` raised elements brighter on top; inset elements the reverse |
| DE-2 | Use shadows to convey elevation, and establish an elevation system. | pp.179–182 | `[MEASURABLE]` shadow count bounded; blur/offset scale with elevation |
| DE-3 | Shadows have two parts: a large soft ambient plus a tight directional. | pp.185–187 | `[MEASURABLE]` shadow has ≥ 2 layers, or a documented reason not to |
| DE-4 | Even flat designs can have depth (colour, solid shadows). | pp.189–191 | review |
| DE-5 | Overlap elements to create layers. | pp.193–194 | review |

## IM — Images (ch. 7, pp.198–217)

| ID | Rule | Source | Test |
|---|---|---|---|
| IM-1 | Use good photos; control quality deliberately. | p.199 | review |
| IM-2 | Text over images needs consistent contrast: overlay, lower image contrast, colorise, or text-shadow. | pp.201–205 | `[MEASURABLE]` text-over-image contrast ≥ 4.5:1 measured against the actual backdrop |
| IM-3 | Everything has an intended size: don't scale up icons or scale down screenshots/icons. | pp.207–211 | `[MEASURABLE]` icon rendered size is within its intended size set |
| IM-4 | Beware user-uploaded content: control shape/size and prevent background bleed. | pp.213–215 | `[MEASURABLE]` user imagery is cropped to a fixed aspect and clipped |

## FI — Finishing touches (ch. 8, pp.218–247)

| ID | Rule | Source | Test |
|---|---|---|---|
| FI-1 | Supercharge the defaults: replace default bullets, checkboxes, borders, etc. | pp.219–222 | review |
| FI-2 | Add colour with accent borders. | pp.223–226 | review |
| FI-3 | Decorate backgrounds deliberately (colour, pattern, simple shape). | pp.227–231 | review |
| FI-4 | Don't overlook empty states. | pp.233–236 | `[MEASURABLE]` empty-state screen exists and is not a blank region |
| FI-5 | Use fewer borders: prefer a shadow, two background colours, or extra spacing. | pp.237–240 | `[MEASURABLE]` border count per screen bounded; separations use ≥ 2 distinct techniques |
| FI-6 | Think outside the box where the conventional control is wrong. | p.241 | review |

## LV — Process (ch. 9, pp.248–252)

| ID | Rule | Source | Test |
|---|---|---|---|
| LV-1 | Start with a feature, not a layout. | pp.7–10 | review |
| LV-2 | Detail comes later; hold the colour, don't over-invest. | pp.11–14 | review |
| LV-3 | Work in cycles; don't design too much up front. | pp.15–18 | review |
| LV-4 | Be a pessimist: design the failure and edge states. | p.17 | `[MEASURABLE]` loading/error/empty states are present |
| LV-5 | Choose a personality (font, colour, radius, language) and stay consistent. | pp.19–25 | `[MEASURABLE]` corner radii cluster on a bounded set |
| LV-6 | Limit your choices; systematise everything. | pp.27–30 | review |
| LV-7 | Look for decisions you wouldn't have made; rebuild your favourite interfaces. | pp.249–250 | review |

---

## Mapping to the benchmark's defect classes

The pixel benchmark classifies into `geometry | typography | spacing | color | imagery | clean`.
Those are *detection* classes, not design-quality classes. The link is:

| Benchmark class | Design rules it most often implicates |
|---|---|
| `geometry` | SP-1, SP-6, DE-1, IM-3 |
| `typography` | TY-1, TY-4, TY-6, HI-1, HI-2 |
| `spacing` | SP-1, SP-2, SP-3, SP-5, FI-5 |
| `color` | CO-2, CO-4, CO-5, CO-6, CO-7, HI-3 |
| `imagery` | IM-2, IM-3, IM-4, DE-5 |
| `clean` | (no defect) |

So a benchmark finding of "spacing" should be reported to a builder as, e.g.,
"SP-2 violated: observed gaps do not cluster on a scale with ≥25% steps".
