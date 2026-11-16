The two root-run Vulkan feature oracles passed. They establish a small shared-world planar path with retained raw HDR, a real mip chain and specified receiver arithmetic. They do not establish complete original High rendering, full-world/AI performance, frame-rate targets or a finished migration.

| Check | Observed result |
| --- | --- |
| Marker mirror projection | Maximum centroid error 0.701912 px |
| Per-view below-plane marker clip | Magenta 482 pixels to zero |
| Raw linear reflection peak | 4.0 |
| Actual downloaded mip chain | 9 additional levels, 10 total |
| Source-to-copy base comparison | Both cases: 518,400 pixels, maximum RGB error 0 |
| Explicit GPU LOD0/1/3/6/9 witness | Maximum reference error 0.000390053 |
| Four original receiver preset/formula witnesses | Maximum reference error 0.0000292957 |
| Minimum mip-oracle update-request interval | 33.334 ms |
| Requested updates / completed copy serial | 47 / 47 |
| Cadence CPU submissions / observed GPU intervals | 45 / 15 |
| First CPU copy / mip-generation submission | 57.086 ms / 5.931 ms |

The cadence GPU intervals that were actually observed average **0.022704 ms** for copy plus mip generation: copy0.009224 ms and generation0.013480 ms. These are 15 partial samples among 45 cadence copies. Missing serials occur throughout the run, not just at the buffered tail. They cannot establish a credible population P95 or a whole-reflection-pass cost. The raw report retains its sample-only p50/p95 fields; those must not be promoted into population claims. The first color-phase CPU submissions of57.086/5.931 ms remain recorded rather than being silently removed. Their exact internal cause was not separately attributed.

The timing loss has a specific collector boundary. `rough-mips/mips.gd::_refresh_mips` reads completed RD queries only when a new reflection copy is requested, at a maximum30Hz. Actual Godot source `_begin_frame` (RenderingDevice lines8090–8100) swaps each current frame-ring slot's query results, replaces its result count and clears its capture count. The public getters (8830–8854) expose only the current slot, not a persistent history queue. A result can therefore be available during an intervening native frame and absent on the next reflection-refresh poll. The four-post-draw drain does not query on its own. The report's `frame_token` is the ring-slot index exposed at read time, not an independently proven original GPU recording frame; serial/capture-CPU identify the original custom timestamp group. Credible population timing requires a bounded per-native-frame render-thread collector before any further distribution claim. This stage intentionally does not fix or rerun that collector.

CPU wall submission and GPU queue elapsed are separate quantities. Cadence CPU means are0.020467 ms copy and0.118844 ms mip generation. Witness/readback/pixel-scan/file-write work is outside those cadence submission summaries. The GPU timestamp span covers copy and mip command recording only, excluding SubViewport rendering, shadow and main-render work; it is not exclusive GPU utilization. Queries themselves add overhead.

The common >=33334µs request guard remains. This proves an upper request-rate cap, not sustained30Hz, counted GPU viewport draws, physical presentation or game FPS. The mip copy is issued after global post-draw, so the main view can consume a previous mip result for one additional frame; final latency-equivalent scheduling is unimplemented.

Remaining visual boundaries include original normal-perturbation sampling, exact oblique/reverse-Z clip equivalence, shadow behavior, original receiver BRDF and final source film/exposure/color pipeline. The marker view's ACES is only its inherited display setting; no source final-pipeline equivalence is claimed. Shared World3D and view-layer floor exclusion remain independent of the separate observer and custom-film work. No AI ticks were added, no original full world was loaded and no full High cost/quality claim is made.

Frozen sources and raw JSON/run/log are copied byte-for-byte. The marker's missing independent prelaunch hash/argv capture is disclosed; the mip run records actual argv/owned PID/engine SHA, no source mismatches, no engine errors and exit0. Original EXRs/PNGs remain private work artifacts with hashes in the retained provenance. They are not silently replaced by these numeric reports.
