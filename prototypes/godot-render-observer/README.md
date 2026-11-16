# Godot render observer prototype

Opt-in native CPU/GPU marker collection for official Godot **4.7.2 / ed1daf0bf001b61586d9930840f2f1394092c079**. No new dependencies or GDExtension. This package does not implement game rendering, AI, audio, migration acceptance or an FPS benchmark.

Launch the existing application with engine `--gpu-profile`, using `launch-v3.gd` as an external script. It loads an unchanged target PackedScene and installs `observer-v2.gd` as a sibling. Paths below are examples; keep the application's normal project, renderer, settings and scenario arguments:

```powershell
$godot = "D:/path/to/Godot_v4.7.2-stable_win64_console.exe"
$probe = "D:/path/to/godot-render-observer"
& $godot --path D:/path/to/application --rendering-method forward_plus `
  --gpu-profile --script "$probe/launch-v3.gd" -- `
  --observe-scene=res://main.tscn `
  --observe-output=D:/existing/evidence/new-capture.json --observe-limit=3600
```

The evidence directory must exist and output files must not exist. Launcher-controlled startup failures exit 2. Engine-consumed flags cannot be verified through `OS.get_cmdline_args()`; save the actual external launch command and verify the real marker stream. Optional metadata absences are reported and do not prevent marker collection. The observer is bounded, reads RD only on the rendering thread, and adds no timer, draw, custom timestamp, fence or process loop. `stop()` disconnects signals and invalidates late deliveries. Its 250ms pending watchdog uses only subsequent existing post-draw callbacks and records timeouts as errors.

For precise scenario coverage, install the observer at the existing START hook in a **new diagnostic staging** application instead of editing frozen evidence sources. Allow already scheduled normal draw/readback callbacks to drain after the measured window before stopping. Never silently infer missing tail timings. `--gpu-profile` adds overhead and console output: keep this diagnostic separate from clean performance runs.

## What timestamps mean

CPU marker differences are render-thread **wall intervals**, including waits, not exclusive self time. GPU differences are queue elapsed intervals, including dependencies/feed gaps, not utilization or physical present. Readback is buffered. Align original CPU marker envelopes with pre/post timestamps before assigning a source draw; do not equate the engine frame token with a live pose tick.

`frame_post_draw` is not GPU completion/scanout; it may be deferred to the main thread with separate rendering. `Performance.TIME_PROCESS` is an approximately once-per-second maximum and can be stale. OS thread IDs exposed here are **Godot logical Thread::ID**, not Win32 TID: direct ETW matching is invalid. All actual reads in the included GPU3 sample used logical ID 1, the observed main/render thread.

## Offline analysis

Python standard library only; no engine is launched by the analyzer. It reports all actual marker names and disjoint adjacent segments, with nested inclusive groups in a separate table. Never add inclusive group totals to their child segments. Repeated same-path segment names are summed per frame before percentile calculation.

```powershell
New-Item -ItemType Directory -Force local-evidence | Out-Null
python analyze.py --raw evidence/renderer-color-gpu-3.json `
  --run evidence/renderer-color-gpu-3.run.json `
  --component evidence/observed-color-component-3.json `
  --component-frame-offset 1 --out-prefix local-evidence/review
```

The component offset 1 is explicitly audited for this frozen renderer's local `_post_draw()` counter. Do not reuse it blindly for other applications. The included stream has 122 accepted samples, one startup empty, 121 real marker frames, but **only 119/120** requested component frames. There is one pending delivery at shutdown and two final native draws without markers. `REVIEW-GPU3.md` explains the evidence and limitations. Both earlier failed runs are preserved under `history/`; their zero/incomplete results are not accepted evidence. Raw `gpu_validated:false` is intentionally never rewritten. The independent analysis describes usable partial data, not complete-window or full-game acceptance.

## Small checks

```powershell
python analyze_test.py
& $godot --headless --path . --script res://check-v2.gd
python launcher_test.py --godot $godot
```

The headless tests explicitly mark their fake markers as unit-only. They verify actual bindings, Dummy absence, error/pending recovery, signal cleanup and startup control flow. They cannot validate GPU execution. No engine executable, textures, geometry, game bundle, native sound library or full world is bundled. Engine source URLs and SHA pins are in `source-manifest.json`; `api-subset.json` comes from the actual installed binary's API dump. `PROVENANCE.json` and `manifest.json` pin the portable source and archived evidence. Runtime scripts are byte-identical to the successful GPU3 capture; only the launcher test's engine path is made explicit for portability.
