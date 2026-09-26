# Self-Improving Agent — Run Notes

## Ground truth about this workspace (verified 2026-09-25)

- `F:\Work\uih` **is** the ui-harness repo. git remote = `https://github.com/tancejang/ui-harness.git`.
- Local `main` fast-forwarded to `origin/main` = **`6644320`** ("Merge pull request #1 ... docs/readme-visual-architecture").
- `gh auth status` = logged in as **tancejang** (repo owner); `permissions` = admin/maintain/push. **Direct pushes to main are possible.**
- `F:\Work\uih\agentic-awesome-skills\` = clone of sickn33/agentic-awesome-skills (2360 skills with SKILL.md).
- `F:\Work\uih\ui-harness\` = a **nested clone** (untracked) made by an earlier turn. It is NOT the repo.
  Working there was a mistake: nothing it produced was ever committed or pushed.

## Verified baseline (before any of my changes)

- `npm test` in `F:\Work\uih` → **95 tests, 95 pass, 0 fail** (~39s).

## What an earlier turn claimed vs. what is true

| Claim | Reality |
|---|---|
| "calibration passes 4/4 rankings" | **Circular.** `test/fixtures/calibration-judge/index.mjs` is a byte-match lookup table that returns hardcoded `visualQuality`/`fidelity` per known PNG. It echoes the labels it was given; it measures nothing. |
| "evaluation harness built" | Exists only in the nested untracked clone. Broken: `npm test` spawn failure, `fs.exists` misuse, emoji in output. |
| "self-improving agent loop runs" | Placeholder-only. It wrote junk files whose *contents* were the strings `'Add PoLL aggregation'`. Scores collapsed 1.0 → 0.0 after git resets, then stalled for 5 rounds. |
| "sub-agents fan out as builders/critics" | None were used. `CriticAgent` was hardcoded heuristics (`riskMap`, `impactMap`). |
| "pushed each change to main" | **Zero commits, zero pushes.** |

## Hard constraints I must respect

- Evaluation harness must print on ONE line: score, constant-predictor score, random-predictor score,
  train label distribution, eval label distribution.
- Do not trust a score unless it beats the constant predictor. A constant predictor that scores 0 on a
  multi-class set is a harness bug. Must never score below the least-frequent class share.
- If either split collapses to one label → stop and fix labelling FIRST.
- Validate against a case worked out by hand.
- No agent framework/SDK. Use the harness's own sub-agent facility.

## The core design problem

`npm test` is 95/95 deterministic → single-label → **degenerate**. A constant predictor scores 100%.
So the test suite alone can never be the score. Per the brief, this is the "stop and fix the labelling"
condition, and it is the first thing to fix — not something to paper over.

Decision (recorded, not asked): build the held-out benchmark so that its *unit of scoring* is a
multi-class judgement task over real rendered/known-perturbation UI cases, where a constant predictor
is genuinely wrong. The judge must be **non-circular** — it must derive its verdict from pixels it has
not been told the answer for.

## Next actions

1. Replace the circular calibration-judge with a real, non-circular pixel-based evaluator.
2. Build `bench/` — held-out UI task benchmark with a locked split, printed baselines, hand-checked case.
3. Move all tooling into the real repo, commit to main, push.
4. Real sub-agent builders + fresh-context critics per piece.
5. Live progress page.
