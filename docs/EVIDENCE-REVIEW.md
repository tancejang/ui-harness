# Evidence-based review and final verification

UIH now keeps structured discrepancies separately from subjective quality scores. A high score cannot complete a run with unresolved critical or major issues. Budget or iteration exhaustion remains incomplete.

## Review contract

Critic and judge providers must return `coverage`, `issues`, and `resolutions` in addition to their existing fields. Coverage must address geometry, typography, spacing, imagery, color, icons, and usability with evidence. Issues have stable keys, component ownership, severity, and a kind: layout, asset, or constraint. Missing evidence is unverified, not a pass.

Omitting a previous finding does not close it. All configured judge samples must explicitly resolve it with evidence. Critics cannot close findings. A resolved finding must be checked again when source changes. Rejected candidate findings remain in attempt evidence without replacing the accepted workspace's ledger.

Reviewers receive source inventory, full screenshots, component crops, native hierarchy/elements, measurements, functional checks and the persistent ledger. Asset backgrounds, typography, icon shape and color still require visual judgment; native text bounds are not font-size measurements.

## Frozen measurements

The planner supplies `visualChecks` from the reference and existing source selectors. Explicit `uih.json.visualChecks` entries override planner estimates with the same key. The combined contract freezes for the run; builders cannot relax it.

Example entry:

```json
{
  "key": "look-card-ratio",
  "component": "looks",
  "selector": "id:home-look-card-1",
  "metric": "aspectRatio",
  "expected": 0.72,
  "tolerance": 0.04,
  "severity": "major",
  "relativeTo": ""
}
```

Selectors are exact `id:`, `label:`, or `text:` matches. Duplicate or missing matches produce unverified issues. Metrics x/width use viewport width fractions; y/height/gap use viewport height fractions. Gap is the selected element's top minus the `relativeTo` element's bottom. Aspect ratio is width/height. Font size requires explicit runtime `fontSize` in logical pixels. Touch size is the smaller native bound dimension divided by runtime pixelRatio and is a minimum. The managed Metro adapter reports Android density. Other adapters can return `elements` and `pixelRatio`; absent evidence does not pass configured checks.

Planner estimates should be reviewed against the approved reference. Automatic segmentation and model judgments are fallible; these checks do not establish pixel-perfect reconstruction or superiority to another harness.

## Completion and verification

A passing run requires the configured scores, component cycle if enabled, no unresolved critical/major issues, and a fresh full-screen capture, functional checks and independent judgment. The attestation binds the source (including tracked assets and nonignored untracked files outside model context), reference, measurement contract, configuration, screenshot and capture evidence.

`uih review <run-id>` checks freshness and reports `stale` with `deliveryReady: false` after changes. Historical reports are snapshots; they do not certify subsequently edited workspaces. Ignored build/runtime files and secret files are excluded from source hashing. A legacy run without an attestation is unverified.

After manual edits or delivery:

```sh
uih verify <run-id> --workspace /path/to/app --project /path/to/uih-project
```

Verification takes new evidence without editing, resetting or committing target source. It writes a separate audit under the run's `verifications/` directory and uses the original configuration's call/time/cost limits as a separate verification budget. It does not reset the original optimization budget or overwrite its historical approval. Use the returned audit report. Runtime adapters still perform their configured app preparation and interactions.

Existing installed plugins are frozen copies: reinstall updated builtin:codex and builtin:metro-android for new runs. Old runs retain their locked versions; incompatible old review providers must not be treated as structured reviewers. Saved Codex ChatGPT OAuth remains unchanged; no API credential is needed.
