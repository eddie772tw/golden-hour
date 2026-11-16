# Live original-AI world scaffold with observed pipeline warmup

Install this directory as `prototypes/godot-live-world/`, alongside the existing `godot-live-bridge`, `godot-node-logic`, `godot-skin-component` and `godot-render-component` packages. This is a source-only Godot component prototype, **not full-scene, High, audio or performance acceptance**. No engine, fonts, generated binaries, textures,825MB scene, node_modules or recorded gameplay-pose stream is supplied.

`receiver/` is the exact frozen and root-tested warmup runtime, with only its default operator-packet path relocated to the public skin sibling. Godot resources are copied locally because each receiver is its own `res://` project; texture/PBR/guarded-GL helpers retain their tested bytes and source attribution to the render sibling. `PROVENANCE.json` records every copied source SHA, adaptations and required sibling/core/initializer/decoder/fixture hashes.

## Generate original assets and run

From this package, install the existing Node logic dependency and run the read-only exporter:

```powershell
npm --prefix ../godot-node-logic ci
node export-runner.mjs ./evidence/NEW-rest-props
node ../godot-skin-component/export-skin.mjs
```

The prop exporter builds the real original factory graph, applies the SHA-pinned pre-deploy initializer, then exports101 props/274 children/60 unique geometries/22 materials with all original typed attributes preserved. It never installs the benchmark controller, runs AI/ticks, clones scene objects or consumes source RNG during extraction. The independent runner checks before/after graph/typed-data/material/home fingerprints, RNG restoration,274 world transforms and8,530 native Three world-vertex samples. This cold initialization takes about70s on the reference machine; it is not a tiny unit test.

`fixtures/props.rest.reference.json` and `prop-export-reference.json` are **historical metadata evidence**, not substitute geometry. Referenced binary files are intentionally absent. Generate actual `props.rest.bin` before running; the receiver verifies its SHA. `fixtures/capture3-coverage-summary.json` pins the large capture and records the real coverage; no fixture is a game-pose replay.

Obtain an actual geometry snapshot and its **same-session** texture manifest/pixels using the existing render-component capture tools. Do not combine texture UUIDs from another session. Use the sibling compact guarded GL proof, never the raw shader audit JSON. Then run with an installed Godot4.7.2 executable:

```powershell
python -m pip install -r requirements.txt
python run_live.py --name NEW-world120 --engine C:/Tools/Godot/Godot.exe `
  --producer interval --ticks 120 `
  --world C:/Captures/native-materials-tick240-3-scene.json `
  --prop-assets ./evidence/NEW-rest-props/props.rest.json `
  --textures C:/Captures/native-materials-tick240-3-assets/manifest.json `
  --material-mode pbr-adaptor --tonemap aces `
  --shader-audit ../godot-render-component/render/fixtures/gl-audit-proof.json
```

The owned runner uses the unchanged public sibling producer, tracks both process trees, preserves raw frame/application/clock data, refuses evidence overwrite and checks source hashes before/after. `--engine` and `--packet` are explicit portable inputs; the default packet is `../godot-skin-component/evidence/operators.skin.json`. Use3600 ticks for the original full native-AI fixture, whose owner exports are exactly `manifest,seed,equipment,decisionTrace,events,checkpoints,state,coverage`. Native audio remains virtual/recording, not audible DSP parity.

The receiver waits for CPU geometry/material preparation, submits real original constructor skins and rest props in a non-AI loading phase, observes real draw/pipeline-counter quiescence, performs one viewport readback, restores the scene, observes another stable draw window, then clears clock alignment and obtains at least five fresh samples before START. Bounded failure never sends START. This is an **observed/heuristic barrier**, because the public API has no pending-pipeline query; it does not promise all future pipelines are complete. First64 live draws retain counter samples to reveal later compilation. The black loading overlay does not replace the required nonzero3D draw/object evidence.

## What the world actually contains

Actual capture3 coverage is100/101 original props and272/274 children, matched by owner/index/path/root-name plus exact original position/index fingerprints. Surface slot/mode/range/index checks then reuse the capture's real material objects and same-session textures for those272 children. Index6 vase has no corresponding records in that capture; its two original children retain a reported scalar fallback. No missing capture root is inferred from home or child matrices.

The211 retained objects are a **static-or-unowned scaffold**, not211 proven static objects. Clock, chandelier/bulbs, chunk/case pools, glass and other scene behavior may remain frozen at capture state. Unowned does not prove static. Ownership-marked frozen actor bodies are replaced by true live affine skins; weapon attachments, FP frozen skin and temporary physics records stay inventoried but are not displayed as stale dynamic output. Dynamic weapon/magazine/grenade/ceiling assets, K9 custom deformation, FP subset, changing glass, child animation and full FX/bootstrap are incomplete. Godot-specific PBR/light units, custom aux/aux2 shading, reflection/AO/postprocess and audible audio remain limitations. No fake boxes or robot replacements fill those gaps.

True source visibility controls both bot rigs, including a visible old corpse; filtering solely on actor `alive` would be incorrect. Prop world matrices apply once to original local child geometry and missing body IDs hide old roots. The source camera stays authoritative during AI. Node source snapshots, actual engine draw callbacks and distinct source ticks are measured separately; a repeated draw is not a fresh AI state.

## Evidence fields and limits

The report is `gh-live-world-warmup-receiver-v1`. It retains source/ACK/raw-frame/application/clock fields plus `worldScaffold` inventory, warmup phases/raw rows, actual render settings and prop asset statistics.

**Correction:** there is no `propRestAssets.rootReadback` field. The actual field is `propRestAssets.rootsAtFinish`; it reads CPU `Node3D.global_transform` and visibility. It is root-setter/scene-node evidence, **not prop GPU vertex or GPU instance-transform readback**. `paletteReadbackMaxError` queries RenderingServer skeleton-palette state, also not a GPU vertex oracle. Root's visible image supports coherent component drawing, not pixel-equivalent full High rendering.

`RenderingServer.frame_post_draw` is an engine draw callback, not physical present/input-to-photon. GPU timestamp time remains null. Shadow atlas configuration is read from settings/viewport, not a GPU texture readback. Actual viewport/target/window dimensions, MSAA, tonemap, scale, driver/method and vsync are recorded. Reference world uses1920x1080,4x MSAA,4096 atlas configuration,vsync1 and ACES; light intensity remains literal and energy units uncalibrated.

Root-owned120/3600 runs passed source hashes, dataflow and all eight full-native exports. The full reference run had3598 draw callbacks/3421 distinct ticks and minimum fresh RTT1.7664ms (uncertainty±0.8832ms). These are component observations, not target acceptance; see the raw-file SHA reference fixture. Earlier cold/warmup failures remain preserved rather than relabeled as valid performance/pose-age data.

## Small checks

```powershell
npm test
# Optional complete sibling hash check before export/run:
$env:GH_NODE_CLIENT_ROOT=(Resolve-Path ../..).Path
node portable.test.mjs
# CPU/Dummy parse and pure gating logic only:
Godot.exe --headless --editor --path receiver --import --quit
Godot.exe --headless --path receiver --script res://warmup_gate_test.gd
```

The actual native exporter and visible runner are explicit separate commands. Dummy cannot pass a GPU barrier; its control-only bypass is strictly marked false for GPU validity. No clean FPS, High equivalence, full dynamic scene or audio-quality claim follows from these small tests.
