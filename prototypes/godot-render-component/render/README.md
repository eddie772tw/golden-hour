# Real frozen-scene PBR and source-shader component

This project imports a real paused Golden Hour scene. It is a render-component
diagnostic, not a playable game, full AI run, or High-parity performance result.
There is no demo/cube fallback. Missing geometry or mismatched assets fail closed.
No additional batching, light/exposure scaling, LOD reduction or actor removal is
introduced here. Default material mode remains `source-scalars`.

Use the parent component's `capture_materials.py` to capture geometry and textures
in one browser session. It reuses `capture_scene.py` and the existing native
full-AI performance harness solely to reach/pause tick240; this is asset capture,
not another Web performance round. No engine, scene snapshot, texture binary,
dependency download or GPU capture is bundled. Existing wrappers require their
documented local runtime and test dependencies.

## Source files and modes

- `browser-exporter.js`: bounded JSON streaming, original geometry/groups/ranges,
  shared meshes and instances, retained UV1/tangents, frozen native skinned
  positions with explicitly approximate recomputed normals.
- `browser-textures.js`: bounded same-session asset reader. Supported CPU RGBA8,
  canonical Canvas2D pixels and original same-origin PNG bytes retain base-level
  bytes and SHA256. No WebGL readback, resampling or lossy re-encoding.
- `texture_binding.gd`: strict StandardMaterial mapping control. Rejects
  independent UV/sampler policies and unsupported normal bases; rejections remain
  visible in reports.
- `pbr_adaptor.gd`: explicit broader native spatial-PBR shader mode. Each map has
  its own UV matrix, channel, color-space and sampling policy. Uses signed UV
  Jacobian normals and original XY strength. Albedo alpha and alphaMap.g multiply
  after filtering. Roughness uses G, metalness B, AO R, and emission RGB.
- `source_shaders.gd`/`shaft.gdshader`: one source GL window-shaft role. All other
  original custom shaders remain explicitly unsupported scalar proxies.

`pbr-adaptor` requires the texture manifest from the exact geometry session;
core/capturedAt/material IDs are checked. Assets from another browser run must
not be matched by coincident UUIDs. Source linear factors are transferred without
arbitrary recoloring. Godot regenerates mipmaps, whose kernel/precision can differ.
Global AF8 matches source AF8 and explicitly raises AF4 to higher quality/cost;
AF1 stays non-anisotropic. Unsupported AF/filter/format cases are reported.

Mixed-axis repeat/clamp and mirrored repeat use lossless mirrored POT image
extensions with adjusted coordinates/gradients. Base bilinear and same-kernel
POT mip/trilinear seams have CPU reference checks. Native anisotropic edge
footprints and driver filtering are not claimed bit-identical. Original normals,
lighting, reflection, AO and final grading remain separate visual requirements.

GPU-only render targets, environment/cube/compressed/float/half/depth/array/3D or
video images, manual mip payloads, and unsupported source pixel provenance are
listed rather than read back or replaced with invented imagery. An unsupported
map does not silently become a verified High match.

## Explicit compact GL proof

Add both `--material-mode=pbr-adaptor` and
`--shader-audit=res://fixtures/gl-audit-proof.json` when launching Godot directly.
For the parent Python wrapper, pass a filesystem path to that proof. Omitting
`--shader-audit` preserves the old unported-shader control.

The 8,302-byte committed proof is a lossless JSON-value selection of exactly the
original GL material, its unique owner and its geometry's `aT` attribute. The
original audit SHA256 is
`c5a9ecd23a8ccba9ff5d6532ffd599530a5f4781348764a1205ac2c934a0c36b`.
Its complete original file is not required at runtime. The projection SHA256 is
`c2aa2a04e395a6f5590467ecc6db4976d8f478b27d3a7159e6dc6463b593c4d0`;
its selected-value SHA256 is
`34434e5007c35a5bcc9942288ff4062502773dcccfc5a163239c0f36151b6995`.
The loader accepts only this frozen byte hash/schema/provenance, not an arbitrary
new audit. `tools/project_gl_proof.mjs` regenerates it only from the exact original
audit and preserves every selected value; no uniform, code or owner value is
rewritten. CPU tests check its byte pin, selection digest and refusal of changed
source audits.

The port still checks reviewed b3b core, High quality, exact shader code hashes,
unique native1426/world/311 owner, layer2/order15/identity matrix, flags, 912
sequential quad vertices/repeated endpoints, no extra owner sharing the material,
and all original `aT` bytes. UUID equality across sessions is not a condition.
Identity matrix comparison is exact numeric comparison, including rejection of
a `1e-15` translation. There is no transform epsilon.

Original High has `soft=true,vol=20` (source18763), so `FX.setQuality` (20398) sets
this GL material's uK0. Its source fragment first executes `if(uK<=0) discard`.
The port preserves that shader behavior, node/geometry/visibility/shadow policy;
it does not hide the owner. Other-session wall-clock/cosmetic uniforms are not
transferred. The source nonzero branch is translated but not offered as an
unaudited lower-quality/live-animation mode. All other source ShaderMaterials
remain on the explicit unsupported list.

Root's native shaft smoke2 retained all516 objects with zero errors and confirmed
that the false white diagonal disappeared and hotel geometry/materials were
recognizable. The scene remains too bright; original light-unit/attenuation,
procedural PBR hooks, auto exposure/film/grade, sky, planar reflection, AO/FX and
native BRDF still prevent High parity. This result is not an FPS comparison.
The first guard rejection and reserved-uniform shader issue remain historical
failures; actual Godot headless regression checks cover the fixes.

## Checks

From the installed `public/golden-hour` tree:

```text
node --test prototypes/godot-render-component/render/*.test.mjs
GODOT_CONSOLE --headless --path prototypes/godot-render-component/render --check-only --script res://main.gd
GODOT_CONSOLE --headless --path prototypes/godot-render-component/render --script res://shaft_headless_test.gd
```

The Node exporter fixtures load the actual repository Three bundle/helper by
relative path. No environment override is needed in the installed layout.
An optional `GH_GODOT_SOURCE_ROOT` is used only for a source-only staging copy.
Five headless checks use only the committed small GL geometry/proof fixtures;
no 825MB capture or native GPU is required. Expected negative-case guard warnings
are attributed and do not count as engine errors. Node/headless results are CPU
evidence, not native-driver or visual acceptance.

Official semantics: [Godot spatial shader modes and built-ins](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/spatial_shader.html),
[shader sampling/color-space hints](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/shading_language.html),
[StandardMaterial channels](https://docs.godotengine.org/en/stable/classes/class_basematerial3d.html),
[Image data and PNG loading](https://docs.godotengine.org/en/stable/classes/class_image.html).


Fixed source HM diffuse-term overlay: see [HM-LIGHTFIELD.md](../HM-LIGHTFIELD.md). Default off; fixed original clock and external byte-pinned asset, not full High/live-AI parity.
