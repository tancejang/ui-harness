# Approved mockup to native UI experiment

The user approved the second generated Outfitory home mockup and asked UIH to reproduce it from a plain functional screen. This experiment runs in `.uih/editorial-test`, a separate local Git repository. The actual Outfitory application is not modified.

## Inputs and controls

- Frozen target: `.uih/mock-approval/home-v2.png`, 941×1672 native generated pixels, proportionally mapped to 1080×1920 with the original and transform manifest retained.
- Target approved explicitly in the conversation. It is never revised to accommodate an implementation.
- Plain source: separate Header, FeaturedLook, Wardrobe, BottomNav and Icon components plus the shared Home container. Default sans-serif text, plain spacing, gray controls and small images establish the starting point.
- Preparation supplied exact photo crops from the approved target, an avatar, the OFL-licensed Libre Caslon Display font and native SVG icons. Crops are photographic content only; the hero photo contains its static curation badge. Buttons, headings, navigation and interaction feedback are native UI.
- Runtime proof and font-loading wrapper are outside the editable scope. Source revision is observed from the rendered app before/after capture.
- Model roles use the installed Codex CLI's saved ChatGPT OAuth. No API credentials or fallback.
- Live Android checks cover Save, Wear, View all, return home, a category selection, Looks and Profile. These are prototype navigation/state checks, not Outfitory backend integration.
- `acceptance.requireComponentCycle` requires local and global evaluation of every planned component followed by a full-screen evaluation. A high initial full-screen score cannot bypass the component experiment.

## Reproducible artifacts

Primary run: `.uih/editorial-test/.uih/runs/2026-09-24T14-52-27-429Z-14d174/`.

The directory contains the plan, proposal files, screenshots, diagnostic differences, repeated judgments, acceptance/rejection history, source checkpoints and accepted patch. `.uih/editorial-experiment.json` records review links and experiment paths. Installed extensions and run configuration are hash-pinned.

## Failures preserved

An earlier preflight run was stopped after finding Expo Go's Tools overlay covering the avatar and an extra safe-area inset. The capture setup was corrected before the primary run. The adapter now uses the native Tools visibility setting and verifies it is gone; screenshot pixels are not masked.

The first primary-run proposal caused the hero image to expand far beyond its intended height, leaving required controls off-screen. Runtime readiness rejected it and the source was restored. This exposed a coordinator recovery gap: missing expected content stopped the run instead of rejecting the candidate and continuing. The coordinator now treats that specific managed-runtime failure as a failed check, captures a diagnostic-only screenshot, and passes rejected proposal/image evidence to subsequent builder calls. Infrastructure failures still stop execution. The initially failed screenshot was captured directly from that still-rendered device state and retained as `attempt-001-rejected.png` before resume.

Interrupted attempts retain their budget charges and are recorded as rejected on resume. Recovery does not replay the paid builder turn, reset the attempt count, or claim an incomplete review passed. No target-style source edits were manually applied after UIH started.

## Final result

The run stopped at its 50-minute active-time budget. It started 10 attempts and charged 94 calls, including runtime calls. Attempt 10 passed its interaction checks but ran out of time during its final visual judgment; it was not accepted. The workspace was restored to the best accepted checkpoint, `6a478a093a9ad00477b995603d0a423fd78015e9` (attempt 6).

Conservative repeated model ratings improved from **58 quality / 42 fidelity** to **94 quality / 92 fidelity**. The required fidelity threshold was 96 and was not met. The result is `budget-limit`, not a passing run. The largest remaining differences are serif stroke weight, warm surface color, and small text/icon details.

The four component scopes each received local and global review, followed by a whole-screen review. Attempts 2, 3, 5 and 6 were accepted. The broken initial screen and the oversized wardrobe candidate were rejected; subsequent smaller refinements were also rejected when whole-screen scores did not improve. This exposes a plateau risk: the current strict global-improvement gate can discard local improvements when whole-screen numeric ratings remain unchanged. The gate was not relaxed during this experiment.

All seven Android interaction checks passed on the best accepted candidate. The harness regression suite passed **30/30 tests**. A separate post-run replay captures the best checkpoint and records native interactions; it is outside the refinement budget and makes no model calls.

- [Approved target](https://drive.google.com/file/d/17oMX2Q7H8JPH0viUpJly7yZjAyZPbUYG/view)
- [Plain starting UI](https://drive.google.com/file/d/1u9D9RheZWOBn6dilIaeQifzigXis1H-z/view)
- [Best accepted native UI](https://drive.google.com/file/d/1ZZup1wXFLgLAKFliTqIJQ_4u1VobOpSU/view)
- [Native interaction demo](https://drive.google.com/file/d/11oMlVMNalpBFR4sRrXYkUMMVfaGYJgyr/view)

The accepted patch was applied to the standalone `editorial-test/src` checkout and verified byte-for-byte against the best run workspace. The original plain source remains in Git history. The post-run replay verified source revision `053d0cafce705997491e1bd94c0356c5e23233c61752d7ad159cad9ac7af8b49` before recording Save, Wear and tab navigation.

This was one Android emulator experiment with supplied photo assets and font. It does not validate iOS rendering, Outfitory backend integration, broad device compatibility, production readiness, or superiority to the Codex app. Model ratings alone do not establish human visual preference.
