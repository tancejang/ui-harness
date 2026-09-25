# Validation — 24 September 2026

## 0.3 reliability candidate

The following checks used a separate disposable React Native fixture. Outfitory application source was not changed. This is evidence of integration and failure handling, not a production-readiness certification or a Codex-app win.

The automated suite contains 28 passing tests, including OAuth restrictions, refinement/rollback, persisted budgets, corruption/integrity handling, proportional reference import, repeated judging, calibration, stale-runtime rejection and hard-process recovery. Package dry-run excludes dependencies and local run artifacts; both the CLI and native-fixture dependency audits reported zero vulnerabilities. See [native reproduction steps](NATIVE-VALIDATION.md).

### Live Android refinement

Windows host, Android API 34 x86_64 emulator `emulator-5580`, Expo Go 57.0.9, Expo 57.0.25, React Native 0.86.3, 1080×1920 physical pixels. The fixture uses an app-rendered source hash and actual Save/Navigation state changes. Metro is started for each isolated workspace and stopped after the operation. A shared-device lock prevents concurrent adapter use.

Run `2026-09-24T14-19-31-335Z-97fde9` passed in 282,895 ms with 11 plugin calls and one full-screen refinement. All model roles used saved Codex ChatGPT OAuth. CLI-reported model usage totaled 142,792 input and 3,630 output tokens; this is not a billing or image-quota estimate.

| Measurement | Deliberately regressed baseline | Accepted implementation |
|---|---:|---:|
| Conservative visual-quality score | 73 | 89 |
| Conservative fidelity score | 64 | 97 |
| Normalized mean absolute pixel error (diagnostic) | 0.086424 | 0.019235 |
| Actual Save and Wardrobe interactions | Pass | Pass |

Each visual evaluation used two separate model calls; final spreads were one point in each dimension. The patch restored margins, typography, palette and corner radii from screenshot evidence. It did not receive the known target source. The original fixture checkout remained at the deliberately regressed starting commit; accepted changes are an exported patch and isolated checkpoint.

This is a simple test screen, not a polished product design. The approved fixture reference itself has a crowded footer, and Expo Go's floating Tools control appears in captures. Judges mentioned these flaws but still awarded high quality scores. That is a concrete reason **not** to treat these scores as calibrated human aesthetic judgments. The live run reached its targets after the full-screen pass; nested component-loop behavior remains covered by deterministic tests, not by this particular live trial.

The preceding run `2026-09-24T14-13-43-544Z-a2d74b` failed correctly: Expo Go displayed an old bundle, and revision verification timed out. No stale screenshot was accepted. The dedicated fixture now explicitly enables `resetAppData` together with `dedicatedDevice`; this clears only the disposable test client's package data before each operation. General applications need an appropriate deterministic-state strategy.

### Calibration and negative controls

- Real screenshot calibration: two repeats per case, four OAuth judge calls, predeclared fidelity margin of 15 between an exact reference match and the deliberately regressed native screenshot. Observed conservative margin: **33**, ranking/stability checks passed. Case labels and expected ranks were withheld from the judge. This is one known-perturbation control, not human aesthetic calibration.
- Real interaction negative: in a separate cloned fixture, the Save button handler was disabled while its visual appearance remained. The managed check observed the new source revision and returned `passed: false` because the saved state never appeared. `examples/native-negative.mjs` reproduces this control.
- Hard coordinator crash: the automated test kills only the coordinator while a plugin has partially modified source. The watchdog terminates the orphaned plugin; resume restores the checkpoint, retains consumed budgets and completes. This uses real OS processes with a deterministic plugin, not a live paid model turn.
- The real OAuth-generated 1254×1254 image was imported at 1024×1024 by proportional scaling with zero cropping. The original bytes and a hash/transform manifest were retained. Different aspect ratios remain rejected unless explicit contain padding is selected.
- After live runs, no managed Metro process and no ADB reverse port remained. The dedicated emulator is shut down after validation.

Local evidence (ignored by Git):

- `.uih/native-validation/.uih/runs/2026-09-24T14-19-31-335Z-97fde9/report.html`, `state.json`, `events.jsonl`, `changes.patch`, and screenshot/check artifacts.
- `.uih/native-validation/.uih/calibration/2026-09-24T14-23-09-922Z/result.json` and `.uih/native-validation/.uih/calibration-inputs/`.
- `.uih/negative-1790259923268/.uih/negative-result.json`.
- `.uih/native-generated-reference.png.reference.json` and preserved `.original.png`.

### Release gates still open

1. Representative application trials across loading/error/empty states, text scaling, keyboard and multiple viewports; the current coordinator evaluates one configured scenario per run.
2. Clean production-build capture and validation on physical Android devices, plus a separately tested iOS/Mac adapter. The managed adapter was exercised on Windows with Expo Go only.
3. A diverse human-reviewed calibration corpus and repeated blind comparisons against the actual Codex app under matched budgets and inputs.
4. Multi-day soak/recovery testing and extension compatibility on supported operating systems. Current process-recovery evidence is Windows-specific.

The CLI is suitable for supervised experiments. It is not yet justified to use it for unattended production UI changes or to claim it beats Codex.

## 0.2 OAuth transport history

UIH 0.2.0 replaces the direct API provider with saved Codex ChatGPT OAuth.

## Automated

23 tests passed. After correcting the generated-artifact handoff, the seven affected Codex tests were rerun and passed, including rejection of stale image artifacts. Coverage includes OAuth-only defaults, stripping API-key/token environment overrides, rejecting API login, structured output and image attachment handling, explicit failures, call budgets across resume, and the existing refinement/recovery tests.

Syntax checks and npm packaging checks passed. The package includes `plugins/codex` and excludes the retired API plugin. Dependency audit reported zero vulnerabilities.

## Live local checks

Using installed `codex-cli 0.155.0-alpha.9.2`, whose login status reported ChatGPT:

- CLI init, installation of `builtin:codex`, and `uih auth status` succeeded.
- A visual critic call with two color-swatch image attachments succeeded through the saved ChatGPT login. Reported usage: 14,617 input tokens and 101 output tokens.
- Built-in image generation succeeded and returned a 1254×1254 PNG through the saved ChatGPT login. The prompt requested 1024×1024: this confirms OAuth/artifact transport, **not exact-size compliance**. Version 0.2 rejected the mismatch; 0.3 adds explicit proportional reference mapping. The successful turn reported 40,310 input tokens (18,688 cached) and 423 output tokens. These numbers are CLI-reported token usage, not a measurement of image quota/credits.

Local evidence (ignored by Git):

- `.uih/smoke/2026-09-24T13-16-05-687Z/result.json`
- `.uih/smoke/2026-09-24T13-19-36-732Z/result.json`
- `.uih/smoke/2026-09-24T13-19-36-732Z/generated.png`

The initial generation attempt produced an image but failed when asking the read-only Codex turn to copy it into the temporary workspace. The adapter now reads the tool's original generated artifact directly, restricting paths to Codex's generated-images directory or the call's temporary directory and checking freshness/type. The corrected live retry passed. No credentials were read/copied and no API fallback was used.

These historical checks establish OAuth and artifact transport. See the 0.3 evidence above for subsequent device/refinement validation and the remaining release gates.
