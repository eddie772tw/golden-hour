# Root-only HDR planar mip oracle

This NEW isolated candidate extends a byte-identical copy of the GPU-passed marker oracle. It does not modify that source/raw evidence, original game, bridge, world or observer. Actual Godot 4.7.2 headless script/ClassDB checks and CPU Image-sampler units pass; **no GPU run of this candidate has occurred**.

The added path copies the 960 x 540 linear-HDR SubViewport into a real `DrawableTexture2D` initialized as RGBAH with mipmaps, then calls native `generate_mipmaps()`. There is no CPU-created replacement image. A blend-disabled texture-blit shader avoids source-alpha blending. The receiver uses explicit roughness LOD and the source additive/Fresnel expression. Presets are pinned by the preceding `reflection-contract/CONTRACT.md` and its compiled shader proof: marble k1/rough6.5/blur0, oak .6/7.5/1.4, kitchen .55/7.5/1, terrace .22/7/2.4. The test roughness and NdotV inputs are diagnostic inputs, not claims about full-world material values.

Root launch (new output name; retain launch manifest, pre/post candidate hashes, exit status and log):

```powershell
& D:/Golden-Hour/work/tools/godot-4.7.2/Godot_v4.7.2-stable_win64_console.exe `
  --path D:/Golden-Hour/work/godot-native/reflection-mips `
  --rendering-method forward_plus --rendering-driver vulkan --resolution 1920x1080 `
  --gpu-profile --quit-after 1200 -- `
  --output=D:/Golden-Hour/work/godot-native/reflection-mips/planar-mips-gpu-1.json
```

The engine consumes `--gpu-profile`; the script does not incorrectly assert that it remains in `OS.get_cmdline_args()`. Root's actual launch record proves this switch. Reject any engine/shader error, missing report, `ok:false`, failed source-pin check or forced external quit. The inherited 20-second timeout quits with failure. Existing JSON/PNG/mip EXR outputs are refused.

The report must show actual downloaded additional mip count >=9 (>=10 total levels for 960 x 540), retained HDR peak4, source/copy base max error <.005, per-view clip and marker centroids. A GPU 1 x 1 texture-blit witness samples explicit LOD0/1/3/6/9 and checks it against bilinear/trilinear sampling of the **actual downloaded GPU mip chain**. LOD0 red must exceed3.5 and LOD9 fall below.25. Four receiver witnesses execute the same shader include used by the visible floor, against independently evaluated source equations and the downloaded chain (<.03 max RGB error). EXRs contain the GPU-generated chain in memory, but EXR files themselves only preserve the base image; actual mip sampling is recorded numerically.

All mirror update requests retain the original common >=33334 us guard. The subsequent 120 native process/post-draw callbacks are not an FPS or sustained30Hz result. The source viewport and main viewport share World3D; floor exclusion remains per-view layers. The copy/mip command recording is dispatched after global post-draw on the actual render thread. Consequently this standalone scheduling can expose the previous mip result to the main view for one extra frame; this is explicitly **not** a final latency-equivalent integration.

Three custom RD timestamps bracket actual copy and mip-generation command recording. GPU queue elapsed spans and CPU wall submission durations are separate; only cadence-phase rows enter p50/p95/mean. The ViewportTexture resource is captured on main before scheduling, avoiding a Node getter on the render thread. No GPU fence/sync is added. Completed timestamp results are buffered and the tail may be missing after a bounded four-post-draw drain; request/completed serials and unobserved GPU serials explicitly report coverage. Nonzero/monotonic valid GPU results are required, but not an assumption of one measured row per request. Readbacks, pixel loops, witness blits and EXR/PNG writes are outside the cadence submission summaries. Queries add overhead. These values isolate copy/mip work and do not measure complete reflection pass GPU time or exclusive GPU utilization.

This remains a colored-marker oracle: no full world, AI, source normal-perturbation offset, exact oblique near-plane projection, original shadow behavior, original physical receiver BRDF or complete High pipeline. Main-view ACES is retained only from the marker baseline; no equivalence to the source film/exposure/final pipeline is claimed. Raw reflection HDR is copied and sampled before that display transform.

CPU-only check:

```powershell
& D:/Golden-Hour/work/tools/godot-4.7.2/Godot_v4.7.2-stable_win64_console.exe `
  --headless --path D:/Golden-Hour/work/godot-native/reflection-mips --script res://check.gd
```

`check.gd` loads the actual owning script and verifies every newly used native method through actual ClassDB, including RD capture/read methods. It tests the downloaded-Image sampling helper with genuine CPU Image mip generation and a nonuniform bilinear case. It does not instantiate the scene, validate a GPU chain, compile GPU shaders or claim render parity.

Native references: [DrawableTexture2D actual4.7 API](https://docs.godotengine.org/en/4.7/classes/class_drawabletexture2d.html), [texture-blit shader contract](https://docs.godotengine.org/en/4.7/tutorials/rendering/drawable_textures.html). `source/texture_storage.cpp` pins official commit ed1daf0bf001b61586d9930840f2f1394092c079; its `texture_drawable_blit_rect` records/closes the draw list synchronously and `texture_drawable_generate_mipmaps` records actual per-level CopyEffects work. No new dependency or GDExtension is used.
