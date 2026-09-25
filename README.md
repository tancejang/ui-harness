# UIH

A standalone, repo-aware CLI for refining real UI against an approved mockup. Built for an eventual React Native/Metro integration with Outfitory; it does not depend on or modify Outfitory.

**Status: 0.3 reliability candidate, not production-proven.** Live Codex OAuth critique/image generation and managed Metro/Android capture/interactions have been exercised on an isolated React Native fixture. See [validation evidence](docs/VALIDATION.md) for exact outcomes and remaining gates. iOS remains unverified, and no quality advantage over the Codex app has been demonstrated. See [benchmark plan](docs/BENCHMARK.md).

## Run locally

Requires Node.js 22+, npm and Git. Android integration additionally requires ADB and a configured device. iOS execution needs a Mac or a runner connected to a Mac.

```powershell
cd F:\Work\uih
npm ci
node bin/uih.mjs --help
npm test
npm run demo
```

The demo creates a temporary synthetic Git project, accepts an improvement, rejects a regression, and produces an HTML report and patch. Its images and scores are deterministic test fixtures, not evidence of AI design quality. The output prints the report path.

To expose `uih` on your shell PATH, run `npm link` in this directory. Alternatively use `node F:\Work\uih\bin\uih.mjs` followed by the commands below.

## Connect a project later

Run from your app's Git root:

```sh
uih init --platform react-native
uih plugin install builtin:codex
uih plugin install builtin:metro-android
uih skill install builtin:visual-quality
```

Edit `uih.json`:

- Set `sourceRoots` to the smallest complete set of screen, child component, and shared-style sources. Discovery reads tracked sources and heuristic import edges; it is not a framework compiler or a complete static dependency graph.
- Set `editable` to allowed existing files or directory prefixes ending in `/`. Local tasks can change only their component-owned subset. Full-screen tasks can change any editable file.
- Set scenario name, product/behavior requirements, and exact screenshot width/height in **physical pixels**. Account for device status/navigation bars explicitly. One invocation evaluates one scenario at one size.
- Use your saved Codex ChatGPT OAuth login: run `codex login` if needed, then `uih auth status`. UIH never reads or copies OAuth tokens. All model roles default to the `codex` plugin; optional `options.model` selects a Codex reasoning model for a role. The designer invokes the built-in image-generation tool through that reasoning model; do not put a GPT Image model name in `options.model`.
- Bound subscription usage with `--calls`, `--minutes`, and `--iterations`. Calls count every plugin invocation (including runtime checks/capture), and are persisted before execution. Codex usage follows your subscription/account limits; zero dollar reservations do not mean free or unlimited usage. Token usage is recorded when Codex reports it. The legacy `reserveUSD`/`--budget-usd` fields remain optional accounting limits for custom providers, not Codex billing estimates.
- Configure runtime preparation, screen assertions, and meaningful functional checks.

All plugins are **trusted executable code**, running with your local user permissions. Manifest permissions are declarations, not an operating-system sandbox. Hash pinning detects changes after installation; it does not establish trust. Plugins inherit the process environment, including credentials. Install only packages you trust. Codex receives the selected source context, screenshots, requirements and installed skill content. Its subprocess strips API-key/access-token overrides, checks for ChatGPT login, and forces ChatGPT authentication. There is no API fallback.

### Codex OAuth execution

UIH uses the installed Codex CLI, which owns sign-in, credential storage and refresh. It checks `codex login status` and refuses API-key authentication. Sign in through `codex login`; no client secret, API key, or token import is needed. The existing app login can be reused when the CLI shares that saved login, as verified by the status command.

Each role runs a fresh `codex exec` with schema-constrained output and image attachments. The process uses a temporary directory, ignores user runtime configuration, forces the OpenAI provider and ChatGPT login, and disables approval prompts. Project source is supplied as data. All turns use read-only execution. The built-in image tool saves its own artifacts; UIH reads the returned PNG only from the Codex generated-images directory or its own temporary directory, with path, freshness and file-type checks. UIH applies validated edit proposals itself.

The plugin inherits the existing `CODEX_HOME` for Codex-managed auth, but never reads its credential files. User-config hooks/MCP settings are not loaded. Codex built-in defaults apply unless `options.model` and/or `options.reasoningEffort` are explicitly configured. For a CLI outside PATH, set `options.command` to an executable/argument array, such as `["C:/path/to/codex.exe"]` or `["node", "C:/path/to/codex.js"]`.

Built-in image generation is enabled per generation call. If unavailable, blocked or rate limited, the operation fails explicitly. UIH does not request API credentials or draw a substitute image. Native generated dimensions are preserved; reference import maps compatible dimensions as described below.

Opt-in live smoke checks (consume subscription usage):

```sh
node examples/codex-smoke.mjs
node examples/codex-smoke.mjs --generate
```

To migrate an earlier UIH config: install `builtin:codex`, change every model role to `"plugin":"codex", "options":{}, "reserveUSD":0`, add `budgets.maxCalls`, and run `uih auth status`. Start a new refinement run: old run extension snapshots remain frozen and are not silently migrated.

### Android and Metro

`metro-android` manages Expo Go on a configured Android test device. It starts Metro for the isolated workspace, forwards a unique port through ADB, launches Expo Go, waits for a source-revision marker, checks content, and stops its Metro process afterward. A process lock serializes use of the same device across UIH projects.

```json
{
  "plugin": "metro-android",
  "options": {
    "serial": "emulator-5554",
    "dependenciesPath": "C:/prepared-app/node_modules",
    "expectedTexts": ["Home"],
    "interactions": [
      {"name":"Save outfit", "tap":"save-outfit", "expectText":"Saved"}
    ]
  }
}
```

Install matching Expo Go and prepare dependencies beforehand. The app must import the adapter-written `.uih/runtime/revision.json` and render `testID with the value uih-revision- followed by proof.revision` on a non-collapsible native view. See `examples/react-native-home/src/Home.jsx`. Metro must resolve the prepared dependency directory; the fixture includes a config for this. `tap` addresses a testID, accessibility description, or exact text; `expectText` must appear after the action.

Expo Go can reuse cached updates. For a **dedicated disposable test client only**, configure both `dedicatedDevice: true` and `resetAppData: true` to clear that package's data before each operation. This deletes its stored projects, login/state and settings; never enable it for a shared development client. The default is false. A stale bundle fails revision verification. Expo Go chrome can appear in captures; this adapter does not yet provide a clean standalone release-build capture. Custom native modules/dev clients and iOS need a separate adapter.

For Expo Go 57 test captures, `hideToolsButton: true` uses the native developer-menu setting to hide its floating Tools control, then verifies the overlay is absent and the source marker remains visible. It does not edit or mask screenshot pixels. An unsupported menu fails explicitly. This is still an Expo Go capture, not a standalone release-build test.

The legacy `android` adapter supports project-owned preparation scripts:

The Android adapter requires `serial`, `prepare`, `expectedTexts`, and `checks`:

```json
{
  "plugin": "android",
  "options": {
    "serial": "emulator-5554",
    "prepare": [["node", "scripts/uih-prepare.mjs"]],
    "expectedTexts": ["Home"],
    "settleMs": 800,
    "checks": [
      { "name": "home behavior", "command": ["node", "scripts/uih-check.mjs"] }
    ]
  }
}
```

Those scripts are **project-specific contracts to implement**, not files supplied by UIH. They run in the isolated workspace. Preparation must ensure dependencies are available, serve/build **that workspace**, rebuild/reload the device, seed deterministic data, reach the requested screen and return after readiness. A long-running Metro command must not be used directly as a blocking prepare step. Your preparation helper owns its Metro process lifecycle and must reuse/restart it for this workspace and clean it up. Check scripts must verify the current candidate, including required interactions, and exit nonzero on failure.

The adapter runs preparation before every capture/check and provides `UIH_EXPECTED_REVISION` to preparation commands. The app must expose `uih-revision-<hash>` in its hierarchy (or configure `revisionLabel` with `{revision}`). It rejects stale source, checks expected labels, and captures a PNG through `adb exec-out`. The marker proves which instrumented source was rendered; meaningful interaction assertions are still required.

### Other runtimes

Install `builtin:command-runtime` for web, iOS, Flutter, or existing automation. It supports command arrays with `{workspace}`, `{screenshot}`, `{evidence}` and `{revision}` placeholders. Your runner must render the current workspace, establish the scenario, write the PNG to `{screenshot}`, and write JSON containing `stateEvidence`, `observedRevision` and optionally `hierarchy` to `{evidence}`. Check commands must also write revision evidence. Observe the revision from the app; do not merely echo the supplied value. Each capture gets unique temporary outputs, avoiding accidental reuse of the previous screenshot.

```json
{
  "plugin": "command-runtime",
  "options": {
    "capture": [["node", "scripts/capture-ui.mjs", "--image", "{screenshot}", "--evidence", "{evidence}"]],
    "checks": [{ "name": "screen interactions", "command": ["node", "scripts/check-ui.mjs"] }]
  }
}
```

This is an integration interface, not turnkey built-in Playwright, SwiftUI, or Flutter automation. Commands use argument arrays with no implicit shell. On Windows use actual executables (`node`, `adb`, etc.); `.cmd` launchers need an explicit shell wrapper you control. No command string interpolation is performed by UIH.

## Design and approve the reference

```sh
uih reference generate --brief brief.md --out drafts/home.png --candidates 3 --calls 6
uih reference import drafts/home.png
```

Generation uses the designer and an independent design-review call. Later candidates receive previous critique; the highest-scoring nonblocking candidate is copied to the requested output. Every candidate, review, reservation and selected result is recorded beside it. **The result remains unapproved until you review and import it.** You can import another candidate instead.

Generated candidates retain their native dimensions. Import defaults to proportional `--fit uniform-scale` when aspect ratios match within one-pixel rounding; it never stretches or crops. Use `--fit strict` to require exact dimensions. Different aspect ratios require a new reference or explicit `--fit contain` padding, followed by review of the mapped result. Import preserves the original as `.original.png` and writes `.reference.json` with hashes, dimensions and the transform. Put brand, fonts, real assets, content, behavior requirements and implementation constraints in the brief. A generated raster is not automatically a font/asset package; assets must be prepared separately.

Alternatively import an existing PNG. Existing references are not overwritten. To revise one, choose a new `reference` path in the config and import a new version.

## Refine implementation

Commit the intended app starting point, configuration and extension lock. `.uih/` is ignored by `init`. Installed extension files are local; reinstall the same packages on another machine. Uncommitted tracked changes or untracked editable source files are rejected, because a run snapshots Git HEAD.

```sh
uih doctor
uih inspect
uih run --iterations 12 --local-iterations 2 --minutes 30 --calls 100
uih review latest
uih resume <run-id> --iterations 20 --minutes 60 --calls 150
```

CLI budgets on resume are **new total limits**, not additional allowances. Time counts active execution; after an unclean crash, time since the last active start is conservatively charged, including downtime. Iterations and cost reservations are never reset. `doctor` checks configuration and saved Codex login status, not model access or device freshness.

The loop:

1. Clone committed source into a UIH-owned isolated workspace and freeze the reference/config/extensions.
2. Map reference regions to actual editable files, save component crops and ownership constraints.
3. Capture the baseline, require functional checks, and independently evaluate visual quality and fidelity.
4. Start with a full-screen layout pass, then run the configured number of local critique/build/judge passes per component; repeat with a full-screen pass.
5. Apply only validated proposed edits. Enforce file scope, content hashes, path containment and existing-file boundaries.
6. Require functional checks, local improvement where applicable, **and full-screen improvement without regression in either score** before retaining a candidate.
7. Restore the best accepted checkpoint after rejection, interruption or failure. Stop at both score thresholds or a budget limit.

Every attempt has its own screenshots, crop comparisons, visual diagnostics, findings and decision. The report includes reference/baseline/best images and an accepted `changes.patch`. Pixel error is diagnostic only; it never determines acceptance. Judges run in separate calls without builder rationale or previous scores. By default each evaluation has two samples; the lowest score in each dimension is used, any blocking sample blocks acceptance, and score spread above 12 blocks acceptance. Configure `acceptance.judgeSamples` and `maxJudgeSpread`. Repetition reduces some instability but is not an independent human assessment.

When the best screen still has a blocking visual failure, UIH prioritizes a whole-screen repair before narrower component work. These repairs consume the same attempt, call and time budgets and must pass the unchanged acceptance gates. Once the screen is unblocked, the component cycle starts from its first scope. Rejected proposal code accompanies rejection findings and screenshots so the builder can correct a promising failed candidate without silently retaining it. Interrupted scopes are recorded on resume and their consumed budgets are not refunded.

For an explicit divide-and-conquer trial, set `acceptance.requireComponentCycle: true`. Even if an early full-screen pass meets score thresholds, UIH continues until every planned component has a local and global evaluation and a subsequent full-screen pass is evaluated. Budget limits still apply; failed or interrupted attempts do not count as completed reviews.

`uih calibrate suite.json --repeats 3 --calls 30 --minutes 20` tests predeclared rankings against repeated judge calls without revealing case labels or expected ranks to the judge. See [calibration format](docs/CALIBRATION.md). Use it before trusting a model/configuration for optimization.

Review the patch and apply it yourself from the original starting revision:

```sh
git apply --check <path-to-changes.patch>
git apply <path-to-changes.patch>
```

UIH does not merge, publish, or deploy. Exit codes: `0` success/quality thresholds met; `1` failure; `2` budget or iteration limit with targets unmet. Reports distinguish these outcomes.

## Extensions

```sh
uih plugin install ./my-plugin
uih skill install ./my-skill
uih extensions
```

Local directory installation copies and pins a semantic version and SHA-256 tree hash in `uih.lock.json`. No install hooks run. An updated package requires an explicit reinstall. Plugin capabilities and integrity are checked before and after dispatch. A watchdog stops plugin subprocesses when the coordinator disappears. No registry, remote installer, or Codex-format compatibility is claimed. See [protocol](docs/EXTENSIONS.md).

## Reliability boundaries and next work

- Single coordinator and sequential component passes; no concurrent file edits. One active run per project is locked. The managed Android adapter also locks its device; custom adapters need equivalent coordination.
- Existing text files only; no autonomous dependency installation, asset extraction, file creation/deletion, or source migration.
- No automatic retries or API fallback for failed or rate-limited Codex turns. Resume restarts from the best checkpoint and counts an interrupted attempt against the budget.
- Hashes and scope checks protect against mistakes; trusted plugins can access the host. No security sandbox or untrusted-plugin guarantee.
- Strict score nonregression can reject useful tradeoffs and impede convergence. Benchmark before relaxing the rule.
- Representative-app trials, physical-device/iOS validation, human judge calibration, multiple scenario regression suites, asset generation, and a measured comparison with Codex remain necessary before production claims.

Official Codex references: [authentication](https://learn.chatgpt.com/docs/auth), [non-interactive execution and structured outputs](https://learn.chatgpt.com/docs/non-interactive-mode), and [built-in image generation](https://learn.chatgpt.com/docs/image-generation).

See [evidence-based review and verification](docs/EVIDENCE-REVIEW.md) for discrepancy tracking, frozen measurements, approval freshness, and `uih verify`.

See [testing](docs/TESTING.md) for unit, integration, coverage, and live-device acceptance workflows.
