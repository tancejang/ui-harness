# UIH visual quality and fidelity

Evaluate quality and fidelity independently. Never improve an implementation by silently changing its approved reference.

Review in this order: page geometry and hierarchy; typography and wrapping; alignment and spacing; assets and colors; borders, shadows, radii and fine details.

Give concrete findings with component/location and observable evidence. Quantify distances only when the images support it. Do not invent exact font names from pixels.

Preserve real controls, accessibility labels, navigation, loading/error states, and existing handlers. Never replace functional UI with an image of the mockup. Use existing licensed assets and available fonts.

For mobile inspect safe areas, system bars, keyboard accommodation, text scaling, and touch targets when the supplied scenario provides evidence. Record untested states as untested, not passing.

For component fixes, preserve parent constraints and sibling alignment. Escalate shared typography/layout problems to the full-screen pass instead of compensating with arbitrary local offsets.

---

# Sourced thresholds

The rules below come from *Refactoring UI* (Wathan & Schoger) and carry **specific values**, not
rules of thumb. Cite the rule id and page in each finding, e.g. "SP-2 (p.73): 28px is off-scale".
A finding that maps to no rule here must be marked as unsourced judgement.

Prefer these over your own taste. Where a measurement is supplied in the request under
`designFindings`, treat it as evidence to **investigate**, not as unquestionable truth — verify
it against the images before repeating it, and say so if the images contradict it.

## Spacing — cite `SP-*`

**SP-2 (p.73) — use the scale.** Spacing and sizing come from a constrained scale, never
arbitrary values:

    4  8  12  16  24  32  48  64  96  128  192  256  384  512  640  768   (px)

Every value is a multiple or simple fraction of 16. A gap of 28px is **wrong** even though it
"looks fine" — the nearest steps are 24 and 32. Report the off-scale value and the nearest step.

**SP-1 (p.67) — start generous.** Give elements room to breathe; the book's method is to start
with too much space and remove it, never to add space to a cramped layout. Gaps under 12px
between distinct blocks are suspect.

**SP-3 (p.71) — the scale is non-linear.** Adjacent steps above 16px differ by ~25% or more so
the choice is easy; below 16px they pack tightly because small differences matter there. Do not
"fix" spacing by making everything a uniform multiple of 4 — that is the specific naive approach
the book rejects.

**SP-5 (p.99) — avoid ambiguous spacing.** Proximity must make grouping unmistakable. If two
different gap sizes differ by less than ~8px, the eye cannot tell which elements belong together.

**SP-4 (pp.91–95) — relative sizing does not scale.** Padding should not grow uniformly with the
container; larger elements need proportionally more generous padding, smaller ones tighter.

**SP-6 (pp.75–78) — do not fill the screen.** Constrain line length and content width rather than
stretching content to the viewport.

## Typography — cite `TY-*`

**TY-1 (pp.101–105) — use a type scale.** A handful of sizes, not one-off values.

**TY-4 (pp.113–116) — keep line length in check.** Roughly 45–75 characters. Longer lines need
more line-height to stay readable.

**TY-6 (pp.121–124) — line-height is proportional.** Looser for long lines, tighter for large
text. A single global line-height is wrong.

**TY-5 (pp.117–120) — align baselines, not centres**, when placing text beside other elements.

**TY-8 (pp.127–129) — do not centre text longer than 2–3 lines.** Rewrite shorter or left-align.

**TY-9 (p.129) — right-align numbers in columns** so digits share an edge.

**TY-10 (pp.131–135) — letter-spacing deliberately.** Tighten headlines; loosen all-caps.

## Colour — cite `CO-*`

**CO-4 (pp.151–153) — do not let lightness kill saturation.** This is the rule most often broken
and it has a measured form: along the book's own blue ramp, saturation **rises** from 55.7% to
87.5% as lightness rises from 27.5% to 96.9%. A ramp whose light end turns pastel-grey has
violated it. Darken or lighten while *holding* saturation; do not desaturate.

**CO-5 (pp.157–159) — greys do not have to be grey.** The book's grey ramp holds a cool hue of
~207–215° at every step, never pure neutral. A `#808080`-family ramp is flat. Tint greys
consistently warm or cool.

**CO-6 (p.163) — accessible does not have to mean ugly.** Body text needs **4.5:1**. The book's
remedy is to darken/lighten the colour or rotate the hue — *not* to fall back to grey-on-grey.
Measure contrast between the text's own colour and its own backdrop, not between antialiased edge
pixels, which always read as low contrast.

**CO-2 (pp.141–146) — you need more colours than you think.** At least 5 shades per ramp
(closer to 10 in practice), plus a full grey ramp. A two-grey palette cannot express hierarchy.

**CO-7 (p.165) — never rely on colour alone** to convey meaning; add an icon, shape or text.

**HI-3 (pp.41–45) — do not use grey text on coloured backgrounds.** It looks washed out. Tint the
text toward the background's hue instead.

## Hierarchy — cite `HI-*`

**HI-1 (p.35) — not all elements are equal.** Primary vs secondary text should differ in size by
at least ~1.25×, or compensate with weight/colour.

**HI-2 (pp.37–41) — size is not everything.** Vary at least two of {size, weight, colour}
between levels; using size alone produces a flat hierarchy.

**HI-4 (pp.45–47) — emphasise by de-emphasising.** When something will not stand out, soften
what competes with it rather than making it louder.

**HI-5 (pp.47–51) — labels are a last resort.** Prefer combining label and value, or dropping the
label when the value is self-evident.

## Depth, imagery, finishing — cite `DE-*`, `IM-*`, `FI-*`

**DE-1 (pp.171–174) — emulate one light source from above.** Raised elements are lighter on top;
inset elements are inverse. Mixing light directions reads as wrong even when unexplained.

**DE-3 (pp.185–187) — shadows have two parts:** a large soft ambient plus a tight directional
one. A single hard shadow looks cheap.

**IM-2 (pp.201–205) — text over images needs guaranteed contrast.** Add an overlay, lower the
image contrast, colorise it, or add a text shadow. Measure against the actual pixels behind the
text.

**IM-3 (pp.207–211) — everything has an intended size.** Do not scale up icons or scale down
screenshots; use assets at their designed size.

**FI-5 (pp.237–240) — use fewer borders.** Separate with a shadow, two background colours, or
extra spacing before reaching for a border.

**FI-4 (pp.233–236) — do not overlook empty states.**

## Using measurements supplied in the request

When the request includes `designFindings`, each entry names a rule id, a page, the measured
value, and a suggested fix. For each one:

1. verify it against the actual images before repeating it;
2. if confirmed, fold it into the corresponding `issues` entry with the rule id in the evidence;
3. if the images contradict it, say so explicitly and mark the rule `unverified` in `coverage`
   rather than silently dropping it.

Never invent a measurement. If a value is not supplied and the images cannot establish it, record
the category as `unverified` — do not guess a number.
