# Independent review: native renderer GPU observer v3

The captured stream is usable for **partial per-pass diagnosis of the frozen PBR component**. It is not a complete capture window, a clean FPS measurement, full High parity, or full AI acceptance. The original raw `gpu_validated:false` remains unchanged. The detailed offline outputs are `renderer-color-gpu-3-analysis-v2.json` and `.md`.

## Data validity and window

The owned launch manifest includes real `--gpu-profile`, exits 0, records no engine errors, and pins launcher, collector and renderer source hashes. The raw contains 122 accepted samples: one initial empty result and 121 nonempty results, each with 48 markers / 45 distinct marker names. CPU and GPU timestamps are nondecreasing both within and across these frames. Every nonempty GPU envelope is positive. No caps, reported errors, absent RD, timeouts, duplicates or skipped reads occurred. Optional `get_device_api_version` remains explicitly unsupported.

**There is a tail gap despite all drop counters being zero.** `pending_read_at_stop:true` matters: 123 pre/post pairs cover native draw counters 0..122, while the captured original CPU marker envelopes map to draws **0..120**. The first empty result is startup readback. For all 121 nonempty samples, token and requested-draw count equal the CPU-mapped source draw **plus one**; `frame_delay` is 2. Therefore this run empirically demonstrates delayed readback and cannot be aligned by token-as-current-draw.

The component's `_post_draw()` increments its local frame index from one for the first native draw; the explicit analyzer offset is therefore 1 (audited in renderer source `main.gd:433`). Its requested 120 recorded frames are component 3..122 / native draws 2..121. Only **119/120**, native draws 2..120, have captured markers. The final measured component frame 122 and the additional screenshot/shutdown native draw 122 have no captured marker envelope. The analyzer reports those missing draws; it never imputes their timings. Future diagnostics should let normal callback/readback delivery drain after the measurement window before stopping, without adding draws or a GPU fence just to fill the report.

## Thread identity

Every actual RD sample read has `thread_id:1` and `is_on_render_thread:true`. All pre/post callbacks also report 1; recorded main ID is 1 and configured thread model is 1. The observed path runs these callbacks on the main/render thread. This does not measure native worker call stacks.

These values are **Godot logical IDs**, not Win32 thread IDs. The GDScript OS wrapper forwards to `Thread::get_caller_id()` / `get_main_id()`. The implementation allocates IDs using an internal counter, stores them thread-locally, and defines `MAIN_ID=1`. Do not correlate ID 1 directly to an ETW TID. [Pinned OS wrapper](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/core/core_bind.cpp#L577), [ID allocation](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/core/os/thread.cpp#L40), [main-ID definition](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/core/os/thread.h#L70).

## Actual interval distribution

These values use the **119 captured frames within the requested component window**, excluding its two startup draws. Each interval is the timestamp at the named marker through the following marker. Same-path repeated names (two Tonemap markers) are summed within a frame before percentiles; Canvas 0 and 1 retain separate paths. Percentiles use linear interpolation at `(n-1)*p`.

| Disjoint segment | CPU P50 ms | CPU P95 ms | GPU P50 ms | GPU P95 ms |
|---|---:|---:|---:|---:|
| Render Opaque Pass | 0.125 | 0.1735 | 1.14536 | 1.154032 |
| Render Directional/SpotLight Shadows | 0.297 | 0.4263 | 1.11176 | 1.120324 |
| Render Depth Pre-Pass | 0.110 | 0.1651 | 0.42444 | 0.426964 |
| Render 3D Transparent Pass | 0.046 | 0.0671 | 0.30276 | 0.309444 |
| Resolve | 0.006 | 0.0081 | 0.09548 | 0.096724 |
| Setup Shadows | 0.003 | 0.005 | 0.03724 | 0.038616 |
| Tonemap, combined per frame | 0.009 | 0.015 | 0.02620 | 0.026680 |
| Setup 3D Scene | 0.076 | 0.1092 | 0.00264 | 0.003040 |
| **Whole marker envelope** | **0.858** | **1.208** | **3.21012** | **3.232932** |

The last row spans Frame Begin through the final Render Viewports marker. It does not include any subsequent unmarked submission/present work. It is a reference envelope, not an additional cost to add to the segments. The six nested group distributions are separate in JSON and must not be added to their children. Zero/tiny compositor, fog or resolve-labelled intervals do not prove those features are implemented or match Three High.

Opaque and directional/spot shadows together occupy about **70.15% of mean GPU marker-envelope time** in this component. Directional/spot shadow submission is also the largest individual CPU marker interval (P50 .297ms); depth and opaque follow. These are the highest observed owners here, not proof that modifying either improves the full game. Actual active workload is frozen at tick 240 with no live AI/physics/audio/animation/pose updates. The component uses 1920x1080, MSAA enum 2 (4x), 4096 directional-shadow size and the PBR adaptor, while planar reflections, AO, bloom, FX, VM and numerous material/lighting parity requirements remain unproven/unported. No Godot-versus-Web or full-game FPS conclusion follows.

The observer's own read callback cost across 122 samples was CPU P50 .071ms / P95 .1268ms / max .639ms. `--gpu-profile` also adds query instrumentation and periodic console output. Those costs were not subtracted from these diagnostic measurements.

`analyze.py` preserves every actual marker name, adjacent segment and inclusive group, the original-to-callback source mapping, missing draws, input SHA256 and limitations. Its three small tests passed for nested conservation, tail/error rejection and nonmonotonic/missing-launch rejection. No GPU or full workload was launched by this review.
