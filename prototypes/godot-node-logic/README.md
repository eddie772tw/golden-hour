# Node authoritative logic — CPU Gate A prototype

The original nine bots completed 3,600 logical ticks with **all eight exports strict exact** against the preserved browser baseline, twice (v8/v9); the two runs also match each other on all eight exports. This is a CPU logic gate, not real-time 60 Hz, Godot High rendering acceptance, audio quality, IPC latency or a completed migration.

This standalone package loads the existing `game/core/game.js` from the repository and rejects any SHA other than `b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b`. It does not contain a copied game bundle or rewrite AI/physics. The public game does not import this prototype.

## Reproduce

From this directory (`prototypes/godot-node-logic/`):

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run verify -- --name=local-cpu-1
```

Dependencies are private to this package. Existing Windows Bahnschrift, Segoe UI and Arial files are required; font bytes are not distributed. The loader uses `%WINDIR%/Fonts` / `%SystemRoot%/Fonts`, or an explicit `GH_NODE_FONT_DIR`. Actual font hashes, Node/NAPI version and Canvas backend are recorded in each result. Missing fonts or unsupported platform calls fail visibly; fake text metrics are not used.

The default client path is two directories above this package. For a staging copy elsewhere, set `GH_NODE_CLIENT_ROOT` to the existing client directory before running the same commands. The exact core SHA remains enforced. No server/browser/Godot/GPU is launched. Full CPU texture/world/rig initialization can take around a minute on the measured machine; this is not a game startup or throughput benchmark.

Each unique `--name` writes an ignored `evidence/NAME.json` and refuses to overwrite existing evidence. `--ticks=3` is a short diagnostic and cannot pass the complete gate. `--no-initial-props` reproduces the unconfigured initial-world path, which failed the strict comparison; it must not be called an accepted alternative.

## What runs unchanged

`load-runtime.mjs` evaluates the pinned owning bundle, suppressing only its final `As0` invocation. It exposes actual bundled Three definitions/classes/factories and directly extracts the original gameplay setup and `ghSimulate` function. Only loading yields are replaced with resolved promises. Original input, player, camera, viewmodel, first-person rig, arsenal, combat, world, physics, glass, FX, bots, match and K9 methods run. Their original method references and complete controller coverage are reported.

The original hotel authoring (`FD/ND/qD/finishDress/finalize/glass/lighting/XD`) creates 863 colliders, 100 baked meshes, 101 physical props, 124 panes and 119 connected navigation nodes. It does not substitute the partial server collision snapshot. Actual operator data is decoded from the repository's `operators.bin`; original rig, gun, hit/muzzle and skeletal math remain present. Real `@napi-rs/canvas` 1.1.1 supplies CPU texture/font/path/gradient/raster operations. Chrome texture-pixel parity is not implied.

The CPU transform snapshot normally owned by `BM.render`, lazy pane-material preparation and original fade-material preparation are retained. Omitting the pane preparation caused a real scoped-RNG difference on first fracture because Three Material UUID creation consumes randomness. The existing `GH_NOWARM` flag avoids background timers; actual weapon `.warm()` functions run before the fixture.

## Initial world configuration and baseline

`fixtures/baseline.json` retains the **complete** compared fields: `manifest`, `seed`, `equipment`, `decisionTrace`, `events`, `checkpoints`, `state`, `coverage`, plus complete observed `botCalls`. No compared field, event or checkpoint was removed. `fixtures/provenance.json` records source raw paths/hashes, selection and fixture byte hashes, checked on every run. Browser frame/GPU/system data is not included.

`fixtures/initial-world.json` contains 101 immutable `homeP/homeQ` settings captured from the original full browser bootstrap in **menu, before Deploy, tick=null**, with the same core/seed. No live body trajectories, AI poses or final outcomes are loaded. The entire input is validated against native prop index/name/type and world counts before modifying homes. Original ND still constructs every prop and consumes its randomness; original `physics.reset/_placeBox` adopts these initial settings and generates real Float32 Verlet state. The native controller later uses the same original reset.

Skipping DOM/GFX UUID creation changes the global RNG position before original ND randomizes seven stool yaws and twelve pot yaws/Z. Four additional initial quaternion differences are about 1.11e-16. Adopting all 101 initial settings (23 differed in v9) restores strict equality, including 27,645 box substeps; no individual-prop causal claim, sleep-threshold change, copied AI decision or output patch is used.

## Boundaries still unaccepted

- Logical stepping is fixed at 1/60, with one modeled presentation per tick. This package does not test native RAF, a real-time accumulator, dropped debt, tick stalls or input-to-photon behavior.
- Gfx submission/preparation and DOM presentation are output boundaries. HUD output is recorded with hit/score audio forwarded; full browser DOM animation is absent.
- Original eZ cue/variant/voice/steal/PCM authoring runs on the recording `VirtualAudioContext` graph and sample clock. Original audio errors are checked. In v9 only 20,000 commands were retained and 838,445 dropped records were explicitly reported. This is not a complete command-delivery bridge or accepted WebAudio/native DSP/PCM equivalence.
- There is no Godot rendering, live skin/FX delivery, native High/planar-reflection acceptance, process-tree memory, native cold-start or package-size result here. Live assets and poses need the same Node graph or explicit stable owner mapping; Three UUIDs differ across boots.

`npm test` preserves all four small checks: real Canvas metrics/path/gradient/raster, recording-audio clock/automation/end ordering, immutable initializer adoption by actual `_w.reset/_placeBox`, and the historical bounded PixelCanvas fail-closed RGBA utility. PixelCanvas is not the forward Canvas backend and cannot invent text metrics or raster pixels.
