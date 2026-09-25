# UIH extension protocol v1

Extensions are harness-specific. They are installed from a directory and copied without executing installation hooks. Dependencies must already be available or bundled; v1 does not install transitive dependencies. Node built-ins work directly. Installed package contents must not change.

## Plugin manifest

`plugin.json`:

```json
{
  "apiVersion": 1,
  "name": "my-plugin",
  "version": "1.0.0",
  "entry": "index.mjs",
  "capabilities": ["capture", "check"],
  "permissions": ["process", "project-read", "device"]
}
```

Names use lowercase letters, numbers, and hyphens, beginning with a letter. Versions are `major.minor.patch`. `entry` is relative and cannot traverse outside the package. Symlinks are rejected. Allowed permission declarations are `network`, `process`, `project-read`, `device`; declarations inform inspection and are not enforcement. Plugins are trusted processes.

Each call launches the entry through a Node watchdog host with one JSON request on stdin (EOF terminated). Write exactly one JSON response to stdout. Diagnostic messages go to stderr. Exit nonzero to fail the call. The coordinator enforces a time and output-size limit and kills the process tree on timeout; the watchdog also terminates when its coordinator disappears. Do not detach subprocesses to escape that lifecycle. Package hashes are verified before and after each invocation.

```json
{
  "protocol": 1,
  "operation": "capture",
  "workspace": "/isolated/project",
  "scenario": { "name": "home", "description": "Seeded home", "width": 1080, "height": 1920 },
  "options": {},
  "skills": []
}
```

Response envelope: `{ "protocol": 1, "result": { ... } }`.

## Operations

| Operation | Request additions | Required result |
|---|---|---|
| `auth-status` | provider options | `authenticated`, `method`, `guidance` (Codex plugin) |
| `generate` | `brief` | `pngBase64`; optional `usage` |
| `design-review` | `brief`, `images.candidate` | `visualQuality` 0–100, `blocking`, `findings` string array, `rationale` |
| `plan` | `project.files`, reference image | `components` array |
| `build` | project, component or null, critique, allowedFiles, images, recent failures | `edits` array |
| `critic` | reference/actual images, optional crops, scope and component | `findings` string array |
| `judge` | same images, optional previous image, scope and component | `visualQuality`, `fidelity` 0–100, `blocking`, `findings`, `rationale` |
| `capture` | workspace, scenario, `expectedRevision` | `pngBase64`, nonempty `stateEvidence`, `observedRevision`, optional `hierarchy` |
| `check` | workspace, scenario, `expectedRevision` | `passed`, nonempty `checks: [{name, passed}]`, `observedRevision` for successful checks |

Every image object is `{mimeType:"image/png", base64:"..."}`. Images are labeled independently. A component is `{id, files, region:{left,top,width,height}, constraints}`. Regions use physical pixels of the fixed reference. Source entries include `{path, sha256, imports, editable, content}`.

Edits are `{path, beforeSha256, content}` full-file replacements. The coordinator prevalidates every edit before writing any. Existing files only. A plugin must not directly modify tracked source, including runtime/test plugins. Runtime scripts may create ignored build artifacts and install local dependencies; project-owned test scripts must not rewrite tracked snapshots automatically.

Do not put secrets in provider options: config and requests/results may be recorded. The bundled Codex provider uses saved ChatGPT OAuth through the CLI; it never reads credential files and removes API-key/token overrides from its child environment. Plugins must not echo credentials in stderr or outputs. Call count is charged before dispatch, even on failure. Optional custom-provider cost reservations are user-configured; Codex uses zero dollar reservations and returns subscription token usage when available.

## Skills

Create `skill.json` with `{ "apiVersion":1, "name":"my-skill", "version":"1.0.0" }` and a `SKILL.md`. Markdown, text, and JSON resources are loaded as named skill context (64KB per file, 200KB total installed context). Other resource files are copied/pinned but not automatically embedded into model requests. Skills provide conventions and workflow guidance; they do not add executable capabilities.

## Runtime evidence contract

Your runner must prove it opened the requested scenario in the current workspace, not a stale app. `expectedRevision` is a SHA-256 fingerprint of the inspected source-file paths and content hashes. Inject this into the bundle and observe it from the rendered application; return it as `observedRevision`. Do not simply echo the request. The managed Metro adapter uses a native testID around the screen and checks it before/after capture. Configure sourceRoots to include every relevant source; this fingerprint is not a dependency-lock/runtime-environment attestation.

Seed data, wait for readiness, check labels/state and assert required interactions. A screenshot or successful launch alone is insufficient. The coordinator checks the evidence contract and records observations; it cannot establish the truthfulness of an arbitrary trusted adapter's assertions. Plugins may not change tracked files, Git HEAD or the untracked-file set during a call. Ignored runtime artifacts are allowed.

Tests under `test/fixtures` intentionally implement deterministic doubles. Never install them as a real project evaluator.
