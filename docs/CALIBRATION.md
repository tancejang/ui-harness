# Judge calibration

Run calibration before accepting a model/configuration as an optimizer. A suite declares expected comparisons ahead of time. Case names and expectations are withheld from each fresh judge call, and case order reverses between repetitions.

```json
{
  "reference": "reference.png",
  "cases": [
    {"id":"reference-match", "image":"reference.png"},
    {"id":"wrong-spacing", "image":"wrong-spacing.png"}
  ],
  "rankings": [
    {"better":"reference-match", "worse":"wrong-spacing", "metric":"fidelity", "minMargin":10}
  ]
}
```

Image paths are relative to the suite, contained within its directory, and must match the project's physical-pixel scenario dimensions. Prefer screenshots of actual source perturbations. Include separate cases for geometry, typography, imagery, clipping and known aesthetic improvements. An exact reference match is a fidelity positive control; it is not proof of good design.

```sh
uih calibrate path/to/suite.json --repeats 3 --calls 30 --minutes 20
```

Calls are reserved before dispatch. Results, repeated samples, usage where reported, expected rankings and conservative margins are saved under `.uih/calibration/`. Passing requires the minimum better-case score to exceed the maximum worse-case score by the predeclared margin, and all score spreads to remain within `acceptance.maxJudgeSpread`. This checks ranking and stability; it does not require every deliberately broken case to be nonblocking.

Do not weaken expectations after seeing results and then report that as the original test. Review failures and preserve them. `humanReviewed: true` is a declaration by the suite author, not verification by UIH; only use it with retained human-review provenance.

Functional deception belongs in runtime tests: disable a control or replace a screen with a screenshot and verify interaction assertions fail. Image judges cannot establish that controls work.

Human aesthetic calibration and blind comparisons against the Codex app remain separate release gates. Repeated calls to the same model can share the same blind spots.
