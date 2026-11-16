# Exact captured HM volume / bounded diffuse-term prototype

Source-only overlay based on published Stage17 `95b467e`. The source math,
loader, PBR integration and main entry are byte-identical to the isolated project
that root sampled. Earlier stages and live-world importers are unchanged. The
authoring agent did not launch GPU/browser; root owns actual GPU results.
Default HM mode remains off; this is not full AI/High acceptance.

## What is actually transferred

`fixtures/hm-source.json` is a byte-pinned686,257-byte metadata selection of the
verified compiled-material capture. It retains the real HM texture descriptor,
original asset hash, original TY source, fixed source uniforms and177 compiled
material-role/owner/path/slot/geometry descriptors. It contains no geometry or
texture binary and is not an arbitrary new-capture importer. Its SHA256 is
`6059bd1d092ac0a9ccfa0117021513b2b0cc32da5631e0c48031f16237776558`.

The external binary is the actual `compiled-materials-tick240-1-compiled-assets/
assets/a0.bin`:397,440 bytes,198,720 Uint16 half words, source SHA256
`86c55fed4284279faa5b547a9a5a52d6b9b29e220d90dcf16a58c2d67819b1dd`.
It is60×18×46 RGBA16F, not the unrelated64³ U8 particle noise. Original logical
cells are60×9×46; each z-slice stores above A in its first9 rows and below B in
its next9 rows. `lightfield_binding.gd` verifies exact bytes, creates46 native
`Image.FORMAT_RGBAH` images with unchanged data, verifies their concatenation is
identical, then creates one `ImageTexture3D` without mips, resizing, flipping,
repacking, sRGB hints or quantization. Native shader sampling is linear/clamp.

Godot documents [RGBAH as four16-bit floating channels](https://docs.godotengine.org/en/stable/classes/class_image.html)
and [ImageTexture3D.create with an ordered Image array](https://docs.godotengine.org/en/stable/classes/class_imagetexture3d.html).
The CPU tests verify actual native Images; the GPU oracle separately verifies
the upload/sampler/TY path rather than assuming those API calls prove pixels.

`lightfield.gdshaderinc` comes from the original compiled TY; native hash
`fc34ffabe3b51cd5b61af778ccd79653de8abc809ee9e737d86fb9391d7cf229`.
Only syntax-boundary changes are made: split unsupported comma-separated uniform
declarations, declare the explicit native3D sampler, and take world-position/
world-normal arguments instead of reconstructing them from Three view space.
The normal offset.42m, clamped A/B sampling, normal-Y blend, pool caustics and
chandelier sparkle math are otherwise retained. The original function hash is
`816626b43c124689d10e219892476995d35381a7606cb1a2bd81002d8a7e0b5f`.
Projection regeneration and retained-role checks use the exact original manifest
SHA `685d847b6530608c9b94e7478c141dc91fd76ec5672491e0d7e4079f156978c9`.

## Fixed clock contract

The fixture uses original `ghLVT.x=8.479888889365725`, passed at native float
uniform precision. It is not Godot `TIME`, G.time, wall elapsed, or tick240/60.
Source ZD creates a private M accumulator and lighting.update(delta) increments
it. The hotel callback runs through menu/loading as well as playing; pause/over
gets0 and playing receives timeScale-adjusted delta. The benchmark resets G.time
but does not reset this closure. Thus it carries a real pre-fixture offset.
There is no live clock protocol or automatic Node simSeconds mapping here.

A separate CPU test shows that the true installed Material r9 hook can expose
the original `ghLVT` reference using Object.create/prototype and a plain shader
stub, without creating a material, invoking a renderer or consuming RNG. That is
only a future getter route; Node must separately prove it advances the same hotel
callbacks before claiming a live source-clock mapping.

## Native small volume oracle

Run this project's **volume_oracle.tscn** with native Forward+/Vulkan, supplying
the original external binary:

```text
GODOT_CONSOLE --path render --rendering-method forward_plus --rendering-driver vulkan res://volume_oracle.tscn -- --volume-bytes=ABS_CAPTURE_ASSET_A0 --report=ABS_REPORT.json
```

There is no full825MB scene load. Nine fixed cases cover exact A/B texel centers,
different normals, outside clamp, fractional sampling/normal offset, pool and
chandelier phase witnesses and the full source clock. The pool/sparkle cases
also render a diagnostic base-only control, which must visibly differ. They
retain the source coefficients/time; that control is not applied to the scene
prototype. A final case checks the known diffuse product with explicitly
declared unit-test albedo/metalness/AO, not a claimed game material.

To preserve positive HDR differences without output clipping, both sampled data
and the independent CPU reference use `v/(1+v)` before the identical native
unshaded output pipeline. Returned pixels are not assumed linear. A-A must be
exact, samples must be nonblack and extras witnesses must be nonzero. All
CPU-reference differences are recorded per channel; there is **no automatic
parity tolerance**. CPU Float64 trigonometry and GPU float interpolation may
differ, and root must assess actual results. Invalid-case0 alone is not a claim
that every source/reference color matched.

## Guarded scene prototype

Use the original real capture3 snapshot and same-session texture manifest,
compact GL proof, explicit Stage17 normalizations, plus:

```text
--lightfield=source-diffuse --volume-bytes=ABS_CAPTURE_ASSET_A0
```

Default `--lightfield=off` leaves the base PBR shader without HM code. Enabled mode
checks reviewed source/core/High and the fixed evidence/asset/code hashes. Each
receiver must map uniquely by owner path/nativeID/slot, object/geometry type and
counts, layers/order, raster flags, base linear color and metalness. All owners
of one receiver material must agree on its original compiled role. UUIDs are
retained only as provenance, never used to match the different capture sessions.
Unmatched receivers retain base behavior with a recorded reason; no source role
or whole scene is silently declared equivalent. Root actual capture3 matched173 materials covering494 retained owner/surface
relations. All494 pass source main-camera layer eligibility and have nonzero
standard instance counts, before frustum/occlusion/shader discard. This is not
pixel coverage. Four original HM roles absent from capture3 are hidden K9
main/FX roles. The sole unmatched PBR is `prop:crystal`, chandelier bulb
`world/124:chandelier/1:bulb`: the actual D9 class overrides `onBeforeCompile`
and its compiled shader has no HM code or ghLV uniform. Its metalness1 also
makes the known diffuse term zero. Keeping it excluded is the source behavior.
See [HM-COVERAGE.json](render/HM-COVERAGE.json).

The exporter `globalHookAccessor` reports that an ancestor has a getter; it does
not prove hook dispatch past a subclass override. Actual compiled source and
uniform roles provide that proof. Cross-capture UUIDs never establish relation.

The **only** new material contribution is:

```text
EMISSION += HM_irradiance(worldPosition, finalWorldNormal)
            * currentALBEDO * (1-currentMETALLIC) * supportedAOMap / PI
```

Three r9 adds this volume to `irradiance`, and original RE_IndirectDiffuse
multiplies it by diffuseAlbedo/PI; it does not add the volume to `iblIrradiance`.
EMISSION carries this known additive linear output term while preserving existing
environment and original emission. `IRRADIANCE` is not overwritten and no new
light, brightness scale, time source, geometry, actor or pass is introduced.

This does **not** restore original per-material shading: current ALBEDO/normal can
still differ from unported Nj layout/wear/bevels, original skin normals and other
custom hooks. Full Nj ghAO and direct specular AO are absent; only the already
supported explicit aoMap is used when present. Other shader-driven vertex/FX
position approximations from the base component also remain.177 source ghLV
references are not177 fully matched materials, full AI/High parity or an FPS
result. The prototype is bounded evidence for the known sampled diffuse term.

CPU validation completed: Node5/5; actual Godot7/7 typed-image/clock/TY-parser
checks and6/6 metadata-role/actual-PBR-parser/off-mode checks, all with zero engine
or shader errors. The first uniform-declaration syntax failure was corrected by
the generated declaration-only rewrite before handing the oracle to root. The
source-record receiver test is a metadata unit test, not synthetic geometry
substituting for a real-scene performance run. No GPU acceptance is inferred.

## Root GPU evidence and remaining limits

Root `native-hm-volume-oracle-1.json` (SHA256
`4ee9ed977847a38d2882d877be121e545ee364d265e58b1d0b28698f289c560a`):
nine cases, invalid0, all A-A and per-channel reference differences0, nonzero
pool/ sparkle absence witnesses. Original397,440 bytes/46RGBAH slices were exact.
This validates the fixed small sampler/TY oracle, not arbitrary material parity.

Root `native-hm-receiver-smoke-1.json` (SHA256
`c08983bb64f8f135c4ae9802635d56e3488cc88b88deb37a8632c22aa3c7ecf9`):
120 frames,516 retained nodes,5,330,835 vertices,3,452 instances,154 texture assets,
173 matched material roles and no engine errors. The image was reviewed by root.
Thirty-eight of those roles use Nj and still lack complete original
ALBEDO/ghAO/layout/specular-AO behavior. The source time is fixed, not live.
These results do not establish whole High parity, full-AI behavior or FPS gains.
[Compact recorded values](render/fixtures/hm-validation-evidence.json) preserve
raw source hashes without shipping the captures or texture binary.

## Portable commands

Run from `prototypes/godot-render-component`. Python/Node use standard libraries;
the inherited browser runner still requires its existing Playwright setup.
External data and the native engine are caller-supplied, never downloaded here.

```powershell
# Repo-only checks: optional external tests visibly skip if data is absent.
node --test render/*.test.mjs
python -m unittest capture_compiled_materials_test.py

# All real-volume/regeneration checks, with the reviewed capture retained locally.
$env:GH_HM_VOLUME='ABS_ORIGINAL_A0.bin'
$env:GH_HM_COMPILED_MANIFEST='ABS_ORIGINAL_COMPILED_MANIFEST.json'
node --test render/hm-reference.test.mjs
GODOT_CONSOLE --headless --path render --script res://lightfield_cpu_test.gd -- --volume-bytes=ABS_ORIGINAL_A0.bin
GODOT_CONSOLE --headless --path render --script res://lightfield_receiver_test.gd -- --volume-bytes=ABS_ORIGINAL_A0.bin

# Real scene receiver, with same-session geometry/material texture data.
python run_render.py --engine GODOT_CONSOLE --snapshot ABS_CAPTURE3_SCENE.json --textures ABS_CAPTURE3_TEXTURE_MANIFEST.json --shader-audit render/fixtures/gl-audit-proof.json --material-mode pbr-adaptor --source-decay 1 --direct-energy source-irradiance --light-color source-linear --lightfield source-diffuse --volume-bytes ABS_ORIGINAL_A0.bin --frames 120 --name UNIQUE_NAME
```

`GH_GODOT_SOURCE_ROOT` is only an authoring/test relocation override for the
existing owning repository; the installed Node test resolves its ordinary
`../../../game/core/game.js` and server fixture automatically. It does not change
runtime fixture/source guards. Native CPU tests require the original external
asset and reject missing/wrong bytes; no synthetic runtime asset is supplied.

## New evidence capture (not a Web FPS round)

`capture_compiled_materials.py` reuses the existing `capture_scene.py` tick240
pause adapter and the existing `scripts/performance/run_browser.py`. It returns
before geometry export. Use the same native-loop/High/1920×1080 options used by
`capture_scene.py`, a fresh capture name and caller-selected output directory.
The browser exporter is `render/browser-compiled-uniforms.js`:

```javascript
await __ghCompiledMaterials.capture({coreSHA256: ACTUAL_CORE_SHA, sessionId: NAME});
__ghCompiledMaterials.readAsset(ASSET_ID, BYTE_OFFSET, 262144);
__ghCompiledMaterials.release();
```

The wrapper first installs that exporter. It records existing compiled shader
source and uniforms, material/source-hook/owner/path/slot relations, ORM CPU maps
and the authoritative `fx.lightVolume.texture`. It never recompiles, renders,
invokes a material hook, advances simulation, consumes RNG or reads GPU pixels.
Each original Uint16 payload is emitted losslessly little-endian, so the original
HM `a0.bin` format can be captured without quantizing/repacking float words.
The wrapper streams256KiB chunks with byte-count and SHA checks. Texture IDs are
matched within the captured session, not assumed stable across boots.

Caps are512MiB asset bytes,64MiB metadata,32M shader-code characters,2048 materials,
20,000 owners and512 textures. Missing/over-cap/unsupported data is reported or
fails capture, never truncated into a fake complete asset. Shader code is read
from existing programs only; CPU assets and metadata are frozen before awaited
PNG reads/hash work. Original output caps do not imply an arbitrary future scene
is fully representable.

A new boot has different lighting accumulator/flicker state and may produce a
different real volume or fixed time. It must **not** be treated as the reviewed
old hash automatically. `tools/project_hm_fixture.mjs` intentionally only accepts
the exact reviewed full-manifest SHA, losslessly selects original roles/code/
uniform values and emits the pinned source fixture/include. New captures need
explicit review and a new proof/version; the runtime rejects them meanwhile.
Neither this capture wrapper nor the metadata getter constitutes a live-clock
protocol.

Portable authoring verification: all25 Node tests passed with original external
volume and full manifest supplied;2 Python adapter tests passed; native Godot
check-only passed and7 typed-volume plus6 receiver headless checks passed.
The2 expected receiver rejection warnings are deliberate negative cases; no
engine/shader errors. The source tree carries no engine/data binaries.
