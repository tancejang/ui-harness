# Reproduce the Android fixture checks

Use a dedicated disposable Android emulator with a matching Expo Go installation. The fixture runner clears Expo Go's package data on every check/capture; do not point it at your everyday development client. Validation used API 34, Expo Go 57.0.9, 1080×1920 pixels and serial `emulator-5580` on Windows. ADB, Node 22+ and Git must be on PATH.

From UIH's directory:

```powershell
npm ci
npm ci --prefix examples/react-native-home
$env:UIH_ANDROID_SERIAL = 'emulator-5580'
node examples/native-validation.mjs
node examples/native-validation.mjs --check
node examples/native-negative.mjs
```

The first script creates a separate Git repository under `.uih/native-validation`, installs the runtime/model adapters, fingerprints its source, starts Metro, loads Expo Go and captures the screen. The second invokes real Save and Wardrobe interactions. The negative script makes another clone, disables Save's handler and succeeds only when that interaction failure is detected. It does not invoke a model. Runtime evidence is saved under each fixture's `.uih/` directory.

For a live refinement experiment, capture the unchanged fixture first, import `.uih/native-validation/.uih/native.png` as its reference, deliberately change some styles in that fixture's `src/Home.jsx`, and commit the reference/config/source/lock. Run:

```powershell
node bin/uih.mjs reference import .uih/native-validation/.uih/native.png --project .uih/native-validation
# After introducing and committing known visual regressions in the fixture:
node bin/uih.mjs run --project .uih/native-validation --iterations 2 --calls 30 --minutes 25
```

Import refuses to overwrite an existing reference. For a subsequent experiment, configure a fresh reference path. Keep the target source out of model context. The fixture helper preserves an existing Home.jsx, so rerunning it after a mutation captures that mutated screen; it does not silently restore the original. It does rewrite/commit its own fixture configuration. Never run setup while another fixture run is active.

This is an integration control, not a design benchmark. Expo Go chrome and the intentionally simple reference limit aesthetic conclusions. Review `VALIDATION.md` for actual results and known shortcomings.
