# Original rest mesh and affine skin component

This isolated prototype reads the existing lossless `operators.bin` through the original decoder, then constructs the original bundled Three r180 rigs using the sibling [Node loader](../godot-node-logic/README.md). It preserves rest vertices and full affine bone matrices. It does not replay a game scenario or skin already-baked scene-snapshot vertices.

Install the sibling package's locked dependencies first. From the repository root:

```powershell
npm ci --ignore-scripts --prefix prototypes/godot-node-logic
node prototypes/godot-skin-component/skin-data.test.mjs
node prototypes/godot-skin-component/export-skin.mjs
```

The exporter creates ignored `evidence/operators.skin.json` and a 9,039,296-byte binary. It refuses to overwrite existing files; pass a fresh directory to export again, then use the Godot `--packet=ABSOLUTE_JSON_PATH` argument. No engine or generated asset binaries are committed.

Use your verified Godot 4.7.2 console executable. These commands run from the repository root; replace `$engine` with its absolute path and use fresh absolute report/capture paths:

```powershell
& $engine --headless --editor --path prototypes/godot-skin-component --import --quit
& $engine --headless --path prototypes/godot-skin-component -- --validate-only=1 --team=0 --report=ABSOLUTE_CPU_REPORT_PATH
& $engine --path prototypes/godot-skin-component --rendering-method forward_plus --rendering-driver vulkan -- --team=1 --report=ABSOLUTE_GPU_REPORT_PATH --capture=ABSOLUTE_PNG_PATH
```

Repeat with the other team. The project default is compatibility for portability; measured native smokes explicitly selected Forward+ and Vulkan. The visible test exits after 12 draws over four original pose samples. Its plain diagnostic lighting/material and camera fitted to pose bounds are not the game's High rendering.

Each original team has 28,468 vertices, 31,974 triangles and 34 flat bones. Tests compare all eight original attributes byte-for-byte against a fresh original decode, check winding reversal and corruption rejection, and compare every vertex in four original poses per team against independent serialized scalar skinning. Original walking/crouch updates have real affine shear; TRS recomposition loses up to 0.11723 in matrix coefficients. The hidden zero-basis magazine bone is retained.

The importer submits full transforms to an independent RenderingServer skeleton RID:

```text
palette_i = inverse(rootWorld) * boneWorld_i * originalInverseBind_i
worldPosition = rootWorld * sum(weight_i * palette_i * originalRestPosition)
```

It guards attached bind mode, identity bindMatrix and the original meshWorld/bindMatrixInverse cancellation. It applies the root once, retains right-handed Y-up coordinates, and reverses only triangle winding for Godot. Skeleton3D/Skin metadata do not overwrite the affine RID. [Pinned Godot source](https://raw.githubusercontent.com/godotengine/godot/4.7.2-stable/scene/3d/skeleton_3d.cpp), [RenderingServer](https://docs.godotengine.org/en/stable/classes/class_renderingserver.html).

Published Node checks pass all eight poses: maximum native CPU position error 3.7243e-7, or 4.7038e-7 with Float32 palettes. Godot CPU checks for both teams have maximum 4.7684e-7. Root-owned visible Vulkan smokes for both original teams pass; the relocated published project also passes with team1. Stored palette readback error is zero. This is not a readback of GPU-deformed vertex positions or validation of skin normals under shear.

`aux`/`aux2` and all original attributes remain preserved, while their High shader use, textures, skin-normal law, first-person subset, weapons, reflection, shadows, postprocessing, continuous live IPC, full AI and full audio remain separate gates. See [Stage 14 evidence](../../docs/performance/evidence/stage14-godot-affine-skin.json). No FPS or migration-acceptance claim applies to this component.
