# Godot real-scene import diagnostic

This prototype captures the original game's real scene and loads it in native
Godot. It tests geometry transfer, camera/culling, material ownership and native
render instrumentation. It is **not full-game, full-AI or High-effect parity**.
Normal-debug output cannot be ranked against the original High game's FPS.

The first successful hardware smoke used official Godot
`4.7.2.stable.official.ed1daf0bf`, Vulkan/Forward+, an RX 9070 XT, a 1920×1080
viewport, 4× MSAA and a 4096 directional-shadow setting. All 516 exported objects,
5,330,835 unique vertices and 3,454 instances remained. The source scene was
paused exactly at native full-AI tick 240. Details and retained failures are in
[the migration journal](../../docs/performance/godot-native-validation.md).

## Capture source data

Use the normal Python/Playwright prerequisites of
[run_browser.py](../../scripts/performance/run_browser.py). `GH_BENCH_DEPS` can
point to an existing isolated Python dependency directory. The client must be a
working portable game with its normal `Play.cmd solo` and runtime.

```powershell
python prototypes/godot-render-component/capture_scene.py --client PATH_TO_PORTABLE --name source-tick240 --quality high --native-loop --completion-poll-ms 100
```

The wrapper reuses the public runner in memory. It retains INIT, seed, High
settings, real Deploy, readiness and the native full-AI controller. An endFrame
hook pauses after tick 240. It does not alter product files. Capture is explicitly
ineligible for performance acceptance and exits after export/cleanup.

The exporter retains topology, groups/drawRange, UV/color attributes, existing
instancing, hierarchy visibility, layers, culling, lights, camera and semantic
owner metadata. Skinned positions are frozen from actual `getVertexPosition`;
recomputed normals are an approximation. Shader-instanced transforms, sprites,
texture pixels and custom shading remain explicit gaps. See
[SCHEMA.md](render/SCHEMA.md).

Large real scenes exceed V8's single-string limit. Capture keeps the full data in
the page and streams bounded chunks directly to a file with an incremental
SHA-256. It never joins the whole scene into one browser/Python string or silently
truncates buffers. The recorded 825 MB JSON is a diagnostic serialization, not a
release package or a proposed distribution format.

## Run the native component

Download a native standard Godot 4 build from the
[official Windows page](https://godotengine.org/download/windows/). The recorded
run verified the official SHA-512 sums and Windows signature; engine binaries
are not vendored here. No .NET SDK is needed for this GDScript project.

```powershell
python prototypes/godot-render-component/run_render.py --engine PATH_TO_GODOT_CONSOLE_EXE --snapshot prototypes/godot-render-component/evidence/source-tick240-scene.json --name native-geometry-smoke --frames 120 --warmup 2 --material-mode normal-debug
```

The runner owns its native process, records source/binary/input hashes and logs,
checks the hardware backend, viewport/MSAA/shadow settings, requested records
and engine errors, and retains failed runs. It requests a screenshot after the
frame records end and exits normally; timeout cleanup targets its owned process
tree. Use fresh names to preserve evidence.

Godot source scalars and custom shader proxies are not verified photometric or
material conversions. `--material-mode normal-debug` validates geometry only.
Explicit light/emission scales and ACES/linear modes diagnose clipping; they do
not establish High parity. The two proven first-person no-color/no-depth owners
retain their original shadow contribution through a documented SHADOWS_ONLY
mapping. MultiMesh materials use the correct ownership API; no new batching is
introduced. All remaining shader/color-mask owners are listed in the report.

## Measurement boundaries

The native recorder captures `frame_post_draw` callback intervals, engine
draw/primitive counters, optional CPU setup timing and separate warmup records.
These are not physical presents or isolated GPU time. Geometry-only materials,
fixed poses and missing passes prevent a full-game performance comparison.
Native memory monitors are not whole-process-tree memory measurements.

The next integration gates are original Node AI/physics with eight exact logical
exports, live pose/skin/geometry updates, preserved audio/DSP and deadlines, and
the missing High effects including planar reflection at no more than 30 Hz.
`apply_pose_frame` is only a future input boundary; no live bridge runs yet.

CPU checks:

```powershell
node --test prototypes/godot-render-component/render/exporter.test.mjs
Godot_CONSOLE --headless --path prototypes/godot-render-component/render --check-only --script res://main.gd
```

The three actual-Three fixtures cover sharing/groups/ranges/instances, bounded
numeric and Unicode serialization, and true single-bone skin baking. Headless
syntax checks cannot establish GPU/render performance. Generated snapshots,
reports, import caches and engine binaries stay outside version control.
