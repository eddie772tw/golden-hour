# Root-only planar colored-marker oracle

Source-only / headless checks have passed; **GPU execution has not been performed by this agent**. This isolated project does not load the original game/world, Node bridge, bots or recorded poses. Its purpose is a small falsifiable step toward the original planar-reflection contract, not a cheap scene presented as full High performance.

Root command (new output names, existing directory):

```powershell
& D:/Golden-Hour/work/tools/godot-4.7.2/Godot_v4.7.2-stable_win64_console.exe `
  --path D:/Golden-Hour/work/godot-native/reflection-contract `
  --rendering-method forward_plus --rendering-driver vulkan --resolution 1920x1080 `
  --quit-after 1200 -- `
  --output=D:/Golden-Hour/work/godot-native/reflection-contract/planar-marker-gpu-1.json
```

It produces report JSON, two raw HDR EXRs (clip off/on), and main PNG. Startup rejects Dummy/Compatibility, wrong engine and existing output artifacts. A20second internal timeout exits2; root should still record exit status, external launch manifest, log and source hashes, and reject any engine/shader error or absent report. No source/GPU result should be accepted merely from exit0.

The 960×540 reflection SubViewport shares World3D with the1920×1080 main view, renders on UPDATE_ONCE requests, and uses HDR2D + Linear environment. The main view uses ACES. Colored markers are asymmetric: red/green/blue aboveY0 and magenta below. Clip-off must show magenta; clip-on must show none. Above-marker image centroids must match the CPU projective prediction within8pixels. The red HDR peak must remain4±.2. The receiver is excluded only by the mirror view's cull mask, avoiding texture feedback; global scene visibility is not mutated.

All reflection update requests, including the two color cases, share a≥33334µs guard. The following120 process callbacks exercise that policy; report separately records native post-draw callbacks and update-request times. These are **requested updates**, not measured GPU viewport renders or physical presents. Two color readbacks and EXR/PNG writes occur outside that cadence observation. The project adds no AI or logic ticks, and its callback counts are not an FPS acceptance result.

Limitations are deliberate: fragment world-plane discard rather than original oblique projection, no shadow/cross-plane-depth proof, no source normal perturbation or rough mip filtering, simple diagnostic materials instead of original High and no live AI/world. Root may discover projection/Y/HDR/shader errors on the first real run; a failed oracle is preserved and corrected in a new version.

`CONTRACT.md` traces original owners and the actual Godot APIs. `compiled-proof.json` pins the real floor shader evidence. `source-manifest.json` pins official4.7.2 source; `api-proof.json` is from the actual engine dump. `check.gd` verifies script parsing, every newly used key native API and mirror camera math using headless CPU only. It does not instantiate the scene, compile GPU shaders or validate pixels:

```powershell
& D:/Golden-Hour/work/tools/godot-4.7.2/Godot_v4.7.2-stable_win64_console.exe `
  --headless --path D:/Golden-Hour/work/godot-native/reflection-contract --script res://check.gd
```
