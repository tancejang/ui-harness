# UIH test suite

Requires Node.js 22+, Git on PATH, and installed dependencies (`npm ci`). Tests use temporary Git repositories, local plugin subprocesses and synthetic PNGs. No API keys, OAuth model calls, network services or emulator are needed for this automated suite.

```sh
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
```

## Coverage by behavior

| Layer | Main checks |
| --- | --- |
| Review contracts | Every review category required; malformed issues rejected; empty judges rejected; unanimous resolutions; omissions persist; scope ownership; immutable input; unresolved minor findings retained; highest severity preserved |
| Native measurements | Viewport normalization; aspect ratio; relative gaps; logical font/touch sizes; missing density; missing/ambiguous selectors; invalid/empty bounds; duplicate keys; invalid tolerances |
| Configuration and scheduling | Supported platforms; invalid budgets; component cycles; global blocking repairs; preserved scheduling on resume |
| Provenance | Binary assets; deleted and untracked source; ignored runtime files; source/config/contract/reference/screenshot/capture tampering; legacy approvals |
| Optimization integration | Baseline, local and global reviews; accepted improvements; rejected regressions; rollback; functional gates; final-review veto; missing measurement evidence; malformed provider failure; exported patch |
| Budgets and recovery | Reservations before provider calls; failed calls charged; persisted resume budgets; subprocess timeout; hard-killed coordinator recovery; project locks |
| CLI integration | Run/review/verify roundtrip; stale source approval; separately audited verification; user edits and historical state preserved; invalid commands/flags |
| Extensions and adapters | Plugin integrity; installed skills; command runtime; fresh Android hierarchy helper; fake Codex subprocess protocol and OAuth-only guard |

The integration suite executes real harness code, Git operations, file persistence and provider subprocesses. Model outputs and screenshots are deterministic fixtures. It does not certify visual judgment accuracy or an actual mobile build.

## Live acceptance remains separate

Before releasing an adapter or claiming improved Outfitory fidelity, run with saved Codex OAuth and a dedicated device: build a known baseline, refine against the approved reference, inspect structured findings and final screenshots, exercise navigation, and deliberately introduce a visible regression. Confirm the reviewer catches it. Repeat with a different viewport and native density. Live testing consumes subscription usage and depends on local SDK/device setup, so it is not silently included in `npm test`.

## Interpreting coverage

`test:coverage` uses Node's built-in V8 coverage. It reports executable lines/branches/functions reached, not correctness or visual accuracy. Provider subprocess coverage may be absent from the parent-process report; adapter behavior is also asserted through subprocess outcomes. There is no blanket 100% coverage claim. Use the report to prioritize uncovered failure paths without writing assertions that merely duplicate implementation details.

New regression tests should first fail against the faulty behavior, then pass after the correction. Keep evidence, state isolation, rollback and fail-closed behavior as primary assertions.

## Regression fixes found by the expanded suite

- Empty judge sample lists now reject instead of vacuously resolving every issue.
- Zero-size and non-finite native bounds remain unverified.
- Unsupported selector prefixes are rejected before measurement.
- Conflicting reviewer severities preserve the highest unresolved severity, independently of reviewer order.

The expanded automated suite contains 95 tests. The Windows run passed all tests, including the CLI verification roundtrip and coordinator crash recovery. This is deterministic harness validation, not a live Outfitory visual acceptance result.
`test:coverage` reported 94.74% line coverage and 78.12% branch coverage across instrumented production files (excluding tests and temporary plugin installations). Files never loaded by the deterministic suite are not represented in those percentages.
