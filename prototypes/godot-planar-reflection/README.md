# Native planar reflection feature oracles

These two isolated Godot 4.7.2 projects establish bounded planar-reflection features before integration into a native game renderer. They do not load the original full world or run AI, and they are not High equivalence or performance acceptance. The original game core and published Node logic/bridge are unchanged. No SSR substitutes for the planar view.

`marker/` contains the shared-World3D mirrored-camera, per-view plane clip and linear-HDR marker oracle. `rough-mips/` adds a real RGBAH DrawableTexture2D copy/mip chain, explicit rough-LOD sampling and the original additive/Fresnel receiver formula. Both were executed by root with actual Godot4.7.2 / Vulkan Forward+ / RX9070XT. See [RESULT.md](RESULT.md), [RESULT.json](RESULT.json), unchanged raw reports/run records/logs and [PROVENANCE.json](PROVENANCE.json).

The marker run lacked an independently captured prelaunch SHA/argv/PID record: its candidate pins matched after the run and root reported exit0. The mip run has an actual launch record, owned PID, engine SHA, all pre/post runtime hashes equal, exit0 and no engine errors. Feature results are bounded by those differing provenance strengths. `acceptanceEligible:false` in the mip launch record is intentional.

The retained project READMEs/candidate manifests are historical byte-identical documents prepared before their GPU runs. Their statements that GPU execution had not happened describe that earlier boundary; this root README and RESULT describe the later evidence. Work-directory paths inside historical JSON/logs are provenance, not dependencies. `reflection-contract` maps to `marker`, and `reflection-mips` maps to `rough-mips` here. Original generated PNG/EXR artifacts and large official upstream sources are omitted; hashes/official URLs and omission records remain. Do not expect every upstream source referenced by a historical manifest to be present in this compact package.

For another root-controlled GPU run, use the installed official engine commit `ed1daf0bf001b61586d9930840f2f1394092c079`, a new absolute output filename in an existing directory, and retain actual launch argv/exit/log and pre/post source hashes. Example with shell variables explicitly assigned to your local paths:

```powershell
$Godot = 'C:/tools/Godot_v4.7.2-stable_win64_console.exe'
$PlanarProject = 'D:/checkout/prototypes/godot-planar-reflection/rough-mips'
$PlanarOutput = 'D:/evidence/new-planar-mips.json'
& $Godot --path $PlanarProject --rendering-method forward_plus `
  --rendering-driver vulkan --resolution 1920x1080 --gpu-profile `
  --quit-after 1200 -- "--output=$PlanarOutput"
```

For the marker project, use `marker` as project path. Both projects reject Dummy as a rendering proof, an unsupported engine and existing output artifacts, and have a bounded internal failure timeout. Source checks alone are CPU-only:

```powershell
python verify_package.py
& $Godot --headless --path $PlanarProject --script res://check.gd
```

The headless script writes `headless-check.json` within its project; save original package evidence before re-running in place. It checks actual ClassDB/script/CPU math or sampling, not GPU shader/pixel behavior. No test or GPU run is automatically launched by the package verifier.

Godot4.7's native [DrawableTexture2D API](https://docs.godotengine.org/en/4.7/classes/class_drawabletexture2d.html) provides HDR setup, copy and mip generation; its [texture-blit shader contract](https://docs.godotengine.org/en/4.7/tutorials/rendering/drawable_textures.html) provides the copy/witness path. No GDExtension or new dependency is required. This is experimental engine-version-pinned work, not a migration acceptance result.
