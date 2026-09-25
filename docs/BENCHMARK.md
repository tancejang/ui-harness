# Proving an advantage over the Codex app

UIH's goal is higher visual quality, closer mockup fidelity and fewer manual corrections without losing functionality. No benchmark result exists yet.

The 0.3 native fixture and known-perturbation calibration passed their integration controls; see [validation](VALIDATION.md). Those results do not compare UIH with the Codex app. Use `uih calibrate` for repeatable evaluator checks before trials, following the [suite format](CALIBRATION.md).

## First real evaluation

Use Outfitory's React Native home screen once UIH is ready for integration. Freeze the starting commit, design reference, available assets/fonts, seeded app data, viewport/device, acceptance requirements and functional checks. Both UIH and the Codex app must start from that same commit and receive the same inputs.

Run at least three independent trials per approach, recording model settings, all human interventions, active time and available cost/usage evidence. Do not compare an unlimited UIH run against a constrained baseline. Keep raw outputs even when a run fails.

For implementation fidelity, use the **same approved mockup**. For design quality, separately compare proposed mockups generated from the **same brief**. Combining these into one experiment obscures whether better design or better implementation caused the difference.

## Measures

| Measure | Evidence |
|---|---|
| Visual quality | Blind human comparison of outputs in randomized order; typography, hierarchy, spacing, consistency, polish |
| Fidelity | Blind reference/output comparison; geometry, wrapping, assets, colors and details |
| Behavior | Identical interaction and state checks against actual implementations |
| Regressions | Unchanged neighboring screens, loading/error/empty states, keyboard and safe-area checks |
| Manual correction burden | Count and duration of edits needed before acceptance |
| Reliability | Completion/failure rate, run-to-run variation, recovery behavior |
| Resources | Active time, model usage/provider charges where available; keep UIH reservations separate from actual billing |

UIH's own judge scores cannot establish that UIH wins. Reviewers should not see which tool produced each result. Define pass criteria before reviewing the results and publish losses as well as wins.

## Evaluator calibration before optimization

Create known perturbations of real screens: spacing offsets, wrong font weight, missing action, image substitution, clipping, improved alignment, and a screenshot pasted over a nonfunctional page. Verify the judge ranks the intended improvement correctly and functional checks reject fake UI. Measure disagreement across repeated judge calls and humans.

Add perceptual metrics and layout measurements only if they improve agreement with the human assessment. Raw pixel difference is diagnostic; antialiasing and system bars can dominate it.

## Production readiness gates

1. Reproducible Metro/device preparation, with evidence the isolated revision is loaded.
2. End-to-end Codex OAuth and image-generation smoke tests with observed subscription usage.
3. Verified Android flow; separately verify an iOS/Mac runtime integration.
4. Real-world crash recovery and negative tests on a representative app repository.
5. Calibrated evaluation and repeated benchmark trials against the Codex app.
6. Multiple scenario/device regression suites before unattended broad changes.
