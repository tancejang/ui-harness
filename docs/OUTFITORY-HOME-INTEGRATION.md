# Outfitory Home integration

Approved target: `.uih/outfitory-home-mock/home-v1.png` ([phone preview](https://drive.google.com/file/d/1xg-bglBvulsEBT6pne49JtmmEoKYbpwz/view)). User explicitly requested implementation through UIH on 25 September 2026 Singapore time.

## Isolation and scope

The source is `F:/Work/outfitory`, with unrelated uncommitted work. `.uih/outfitory-live` snapshots the current tracked working state and relevant untracked mobile/package source before integration. The original checkout remains untouched during refinement. Source hashes are retained for safe delivery.

Presentation preparation extracts HomeHeader, FashionHero and the navigation toolbar into small modules; keeps Home's profile selection, look retention, planned-look ordering, refresh, generation entry conditions, purchase access and handlers in App.tsx; introduces a live wardrobe summary; and provides typed copy for all seven supported languages. Photos and names remain account data, generated-look watermarks remain product-controlled, and date text uses the current locale/date. Only the approved hero photographic region is extracted as a new static asset. No screenshot is rendered as interface controls.

UIH may edit Header, Hero, Frame, Looks, Wardrobe, Navigation and language-utility styles. Data logic, theme tokens, localized copy, backend, billing and dependencies are not editable by the model. Four planned review scopes group the small presentation files.

## Native runtime

The project-specific `outfitory-android` UIH plugin is derived from the managed Android adapter. It serves each owned monorepo workspace through fresh Metro, retains the installed `com.outfitory.app.development.boards` development client's signed-in state, observes a native source-revision testID and checks real navigation destinations. It never clears app data. Installed dependencies are reused via local junctions; environment files stay outside model context and are loaded by Metro without copying them into the snapshot.

Device: LDPlayer `emulator-5554`, physical capture 960×1706, density 480. Each operation temporarily uses font scale 1.0 and restores the incoming setting. TypeScript is checked before candidate interactions. Metro and its temporary reverse port are cleaned up after every operation. Local API forwarding on port 3000 remains available.

The original Metro 8081 serves a different comparison checkout and is not used. Metro 8082 serves the main checkout for final review.

## Evidence before refinement

The original app and extracted presentation setup both passed `npm run validate --workspace mobile`: configured source checks, TypeScript, and 270 tests across eight test invocations. Native checks passed for opening the outfit builder, returning, opening Wardrobe, returning Home, opening Looks, and returning Home. Assertions were corrected during preflight to match actual localized destination text.

Run: `.uih/outfitory-live/.uih/runs/2026-09-24T17-11-31-661Z-ba8dee/`.

An earlier setup run (`2026-09-24T17-06-38-102Z-c40323`) was stopped before accepting any candidate when integration diff review found that a CRLF-sensitive preparation replacement had not wired the look-name label. The immutable rendering structure was corrected and typechecked before the new run. The original setup-run event log and abort reason remain preserved; its consumption is not counted as successful refinement.

Limits: eight attempts, 100 plugin calls, 60 active minutes. Acceptance: quality 90, fidelity 92, two visual judges per evaluation, and a complete component cycle followed by whole-screen review. These are model judgments, not proof of production readiness. Final results and post-delivery validation will be recorded after completion.

The first full-screen candidate passed native checks but was rejected for clipping the wardrobe summary. This exposed a scheduler limitation: it attempted narrow component work while the best whole-screen layout remained blocking. The coordinator was interrupted during the next builder turn and updated to prioritize whole-screen repair until the best screen is unblocked, then begin the component cycle. The original acceptance gates remain unchanged. An explicit cursor records the actual scope, recovery preserves interrupted-attempt charges, and rejected proposal code is supplied with feedback. Regression tests exercise rejection → global repair → local review → final whole-screen review; the live run resumes with its existing counters and time budget.

## Native review beyond the visual score

Attempt 3 was accepted at quality 88 / fidelity 87. A separate inspection of its Android hierarchy found that nominal `minHeight: 44` styles did not guarantee 44DIP exposed targets: parent clipping reduced Build outfit, View all, the bell and the initially visible wardrobe row. View all also overlapped the third look card by 175×30 physical pixels. `.uih/audit-outfitory-touch.mjs` reproduces these failures from the saved capture hierarchy; `.uih/outfitory-touch-before.json` records the red result. This is a real limitation of the run's initial six center-tap checks and screenshot judgments. Delivery requires a separate geometry repair and fresh device verification; the visual score must not be represented as accessibility certification.

The full harness test suite passed 33/33 after the scheduler changes (`.uih/outfitory-harness-final-tests.log`).

## Run outcome and delivery preparation

The primary run finished at its eight-attempt limit, with 67 plugin calls. Attempt 3 remained best at 88 quality / 87 fidelity. All four component scopes received local before/after judgments and whole-screen checks, followed by a final screen attempt. One screen proposal was accepted; six evaluated proposals were rejected; one interrupted builder attempt remained charged. The 90/92 acceptance gate was **not** met. The run is not reported as passed.

Native QA proceeds in `.uih/outfitory-qa`, cloned from the accepted checkpoint, without rewriting the run's evidence. Repairs keep the bell inside its parent, move the language control below the Android status bar, remove the View-all negative margin that overlapped cards, and keep the full hero touch rectangle within its parent. Modest reductions to the hero image and look-card height make room for real 44-DIP controls and the wardrobe row. MiniOutfit explicitly passes `contentFit="contain"` to MediaImage: its former style-only resize mode did not control Expo image fitting. This preserves complete account photos and watermarks.

The native geometry audit now passes with no undersized required initial-screen targets or overlapping clickable bounds. Fresh captures/checks bind to hashes of every delivery file, including App.tsx and photographic assets, as well as the UIH source inventory. These post-run repairs are separate from the 88/87 score and do not retroactively make the UIH run pass.

## Main-checkout verification

The selected UIH implementation and native repair were copied to the main checkout with original-file hash checks and backups. The app passed its full validation command again: TypeScript, configured source checks and 270 tests. LDPlayer checks cover the real builder, Wardrobe, Looks, View-all lower edge, builder lower edge, notification upper edge, language picker, and builder/wardrobe navigation at 150% text size. These checks do not claim iOS or screen-reader certification.

Enlarged-text scroll inspection led to two additional presentation fixes after the initial QA checkpoint: compact the existing inspiration card so words do not break into narrow columns, and mount Home's language button inside its scrolling header instead of overlaying scrolled content. A context preserves the existing root language utility on other screens. The scroll regression was observed failing before the change. The final source manifest records these follow-ups separately from the original UIH/QA checkpoints.

Android activity recreation during a font-size change exposed stale UIAutomator XML reuse in the verification script. The maintained Android adapter now removes the previous temporary dump and requires a successful fresh dump before reading it. Two regression tests failed with the old behavior and passed after the repair. The complete harness suite then passed 35/35. Installed extensions and completed UIH evidence were not rewritten.

Phone previews: [implemented Home](https://drive.google.com/file/d/1F6RzRwZtIvz92ncNurd4sjXjODRxC846/view), [interaction demo](https://drive.google.com/file/d/1Bh3gCijVDkwqjxROrNDLHokELwPnUbVW/view), [150% text](https://drive.google.com/file/d/1s-hUYna7jRZ-uDRu5ZJSGVv3i7iJig6B/view). Local evidence is under `.uih/outfitory-delivered/`; the completed UIH report remains under the primary run directory.

Final verification completed: 270/270 mobile tests, 35/35 harness tests, eleven recorded native interaction checks, the initial-screen touch-geometry audit, and three scroll/navigation language-control checks passed. The latter verify that the language control leaves the viewport with the Home header, remains available on Wardrobe, and returns on Home navigation. Enlarged-text screenshots show the compact inspiration card and full wardrobe summary after scrolling. The original font scale (1.5) is restored and the app is left on Home. `final-source-manifest.json` records all 13 delivered file hashes and distinguishes post-delivery adjustments from the earlier UIH score. The source remains uncommitted in the user's main checkout; unrelated edits were preserved.
