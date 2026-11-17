# Browser performance round and playable checkpoint — 2026-11-17

This round keeps the original browser host, 1920×1080, DPR 1, High effects and reflections at most 30 Hz. The primary repeatable workload runs all nine native bot AI paths for 3,600 simulation ticks. Electron, Tauri and Godot are outside this runtime change; the Godot worktree remains separate.

## Adopted runtime change

`Ew` now uploads the union of pending changed ranges for its owned shard position/normal attributes. A settled/retired shard does not resend unchanged normals. Deferred or skipped draws retain pending writes until the actual uploader callback; reset, ring wrap and either mode toggle force the required full synchronization. The constructor enables this in ordinary startup, without benchmark flags. `GH.debug.glass.ghShardDirtyRanges=false` retains a full-upload comparison path.

This is an upload-volume optimization, not a claim of stable 60 FPS. Separate pass-owner diagnostics measured 627,379,200 → 128,444,796 shard payload bytes over slightly different frame counts (3,216/3,190). They included the isolated body candidate, so they are not an isolated glass FPS result. All eight logical exports matched. The independently owned shard buffers avoid the baseline census's shared-array attribution ambiguity.

The actual-source unit suite covers deferred updates, expiry, normal writes, wrap/reset, mode transitions, native uploader callbacks/backend recreation and default startup. The earlier native WebGL2 oracle passed eleven whole-buffer readback cases. Backend recreation is not actual context loss. The normal-AI native Edge functional run also passes pointer lock, pause/resume, weapon selection, bounded reflection cadence, High↔Medium/scale changes, motion blur switching, actual WebGL context loss/restoration and reload (`evidence/glass-default-functional-1.json`). Default-on shard mode is recorded true. Context lifecycle state is retained in the raw result; no console errors or warnings were recorded.

## Independent default-on glass ABBA

| Run order | FPS | 1% low FPS | P95 ms | P99 ms | >50 ms/min |
| --- | ---: | ---: | ---: | ---: | ---: |
| glass-base-1 | 56.35 | 20.11 | 23.6 | 29.2 | 4.96 |
| glass-default-1 | 56.41 | 21.53 | 23.6 | 29.8 | 6.97 |
| glass-default-2 | 56.71 | 22.13 | 23.4 | 27.9 | 4.98 |
| glass-base-2 | 56.34 | 21.96 | 23.7 | 29.1 | 4.97 |

All four complete-window runs preserve all eight full-AI outputs and use the same 1080p High/30 Hz reflection settings. This small observed range does not establish a stable FPS improvement. Each run still has three >100 ms intervals. Adopt the bounded upload-volume change without treating these results as 60 FPS or long-frame acceptance. The exact tested/default runtime core SHA256 is `0749942df3d06426dbee19387d115c91920e59dc53554088479a09e9037dc03c`.

The full unit suite passes **164/164**. The default-on core passes an additional **11/11 native WebGL2 whole-buffer readback** cases (`glass-native-default-oracle-1.json`), retaining exact CPU arrays, native uploaded bytes, RNG and side effects for the tested lifecycle cases.

## Candidates kept outside normal play

- **Body clip bounds:** both initial and GPU-only revisions pass native 12-view pixel/contribution/rejection controls and full-AI logical equality. Initial clean ABBA has no stable net gain. GPU-only clean runs were 56.63/55.29 FPS, with 1% lows 21.71/21.64; the bracketing baselines were about 56.05/55.99. These do not justify adding the observer, per-view guards and startup path to normal play.
- **Casing leaf Gain pool:** six native single-leaf cases are bit exact, but twelve full-mix held-out baseline calibrations fail their preregistered repeatability gate. This does not establish candidate distortion. Two experimental full-scene runs were 56.18/55.54 FPS, 1% low 21.07/22.00, with three >100 ms frames each; no tail/average improvement was established. These runs stay diagnostic-only and the pool remains absent from the playable runtime. No ≤20 ms physical audio acceptance follows from offline PCM.
- **AO normal state specialization:** historical 34,625 rebuilds correspond to already compiled instancing/skinning/instance-color variants. Current measured parameter work is roughly 0.18 ms/frame gross, before invalidation guards; it is not the whole ~1.65 ms AO pass. No unvalidated cache or new material clones are enabled.
- **Shadow-only batching:** investigate actual consecutive compatible native shadow runs before implementing a merge. `hotel.batch` accounts for 16.92% of shadow draws; `world.other` needs more precise rigid-prop attribution. Preserve triangle/submission order, depth-side/material contracts, dynamic roots and fallback. A new 4K static atlas cache would add color/depth storage, full-atlas copies and ordering risks, so it is deferred.

## LoD and texture-density follow-up

LoD is a separate candidate quality policy; no global High preset, model silhouette or texture resolution is silently reduced in this checkpoint. The existing world builder converts indexed source geometry to non-indexed batches (`Mw.addGeometry/finalize`), so an audit should first distinguish source triangle density, lost vertex reuse and draw-call cost. The world batches' approximately 4.77 million submitted triangles per gfx frame are counts across passes, not 4.77 million unique visible triangles.

Concrete screening targets are the small hotel fixtures with 44-segment lathe/torus profiles, repeated 1–2 cm sphere/cylinder ornaments, bevelled props, and character clothing/buttons. Record per-owner unique geometry bytes/triangles plus actual projected size in main/reflection/shadow views. The rigid prop path may benefit more from shadow-only compatible merging than from reducing a cylinder's segments, because segment-only LoD keeps its CPU draw submission.

Textures already use mipmaps and trilinear minification in the common world factories (including `R9`), with some intentional nearest/no-mip UI labels and render atlases. Source resolution reduction additionally affects resident memory/first upload; it is not equivalent to enabling mipmaps. Inventory unique texture/source identities, actual dimensions, usage/UV repeats, minification and anisotropy before choosing a lower source resolution. Large dimensions alone do not establish waste. Keep near-field signage and atlas sampling contracts intact.

Any future LoD must have fixed screen-space error/hysteresis, bounded selection cost, near/edge/reflection/shadow visual comparisons, motion/pop controls, and unchanged AI/physics/RNG/eight logical exports. A controlled visual-error policy is required because geometry LoD intentionally changes pixels; it cannot be declared byte-exact. This research is not an implemented LoD feature.

## Evidence and reproduction

Detailed immutable clients, candidate patches, raw JSON, hashes and research notes are under `D:/Golden-Hour/outputs/browser-candidates-20261117/`. `evidence/glass-default-abba-analysis.json` contains the independent default-on glass comparison. `main-glass-tests.txt` records the full suite. `normal-state/RESEARCH.md` and `shadow-owner/` preserve deferred investigations. Browser measurements are render submission intervals, not physical presents. Full-window values include first use; 1% low is the mean of the slowest ceil(N×.01) intervals, not reciprocal P99.

Build the committed snapshot with `python packaging/build_windows.py --output <fresh-output> --cache D:/Golden-Hour/work/portable-inputs`, then run `python packaging/check_windows.py <fresh-output>`. The release staging/validation receipt is kept outside Git alongside the produced archives so it can name this exact source commit and archive hashes. See `docs/client-distribution.md` for portable play and account/data continuity.

Stable 60 FPS, 1% low >45 FPS and event-to-physical-audio ≤20 ms are not accepted by this checkpoint. A playable package and functional deployment checks do not change those limits.
