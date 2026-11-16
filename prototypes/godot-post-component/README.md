# Source post meter and isolated exposure/film unit

Install as `prototypes/godot-post-component/` alongside the existing
`godot-render-component/`. This package reads the actual original GPU meter and
checks selected exposure/film operators in tiny independent render targets. It
does not install a game post pipeline, change native exposure or establish full
post/High/material/FPS parity. All dependencies are existing owning source,
Python/Node standard libraries and the caller's existing Playwright/native Godot.
No engine, large scene, texture binaries, node_modules or gameplay replay is added.

## Actual evidence

The original paused High capture at tick240 read exactly one original1×1 GPU
pixel, with no render/compile/snap. Raw half words `[15173,12511,0,15360]` decode to
E0.90869140625 and avg0.1522216796875. E implies about9.13% multiplication darkening,
not a factor.5 explanation for the full image. Last uDt.0506/uReset0 show actual
adaptation history. Constructor defaults are not used: actual key.15/comp.46/
min.5/max1.6/up1.1/down3.2/clamp6 are retained in the fixture.

The original final shader defines but never calls ACES. The active film/peak-hue/
highlight functions are losslessly selected from the byte-pinned original source.
Original final fragment SHA is
`d57a2ec1063369281be2d7a85ccfc95c86a9a40ca239159442fd3c437fdd3b1a`;
actual capture current program123 fragment SHA is
`010b92601d5dffe17c397cab6d2dce30b51667fcf376b1775ef4d560d0a6209b`.
The41KB original meter report is retained as pure-text proof in
`fixtures/source-post-meter-evidence.json`; it contains only the actual tiny
read/parameters/code/metadata, no large texture pixels or geometry.

Root's actual native Vulkan and original Three unit runs each pass12 cases,
invalid0, exact A-A and exact same-pipeline CPU-reference RGB channels. Auto and
hue witnesses are nonzero. Native launch/report/log and Three raw report/owning
run are archived under `evidence/`, with an independent evidence manifest.
`VALIDATION.json` records exact raw hashes, source pins and scope. This is each
engine against its own shared output pipeline; returned pixels are not assumed
linear, and raw cross-engine RGB equality is neither asserted nor required.

## Cross-session restriction

The post proof is a fresh boot with gfxTime8.61377777825461 and G.time≈4.0. The HM
fixture was captured in another boot with lighting accumulator8.479888889365725;
geometry/material capture3 came from a third session. These histories were not
aligned. Fixed E is **only an operator-test input**. Do not combine these captures
and claim same-exposure/same-light full-scene photographic parity. A future
full-scene autoexposure path must derive the actual same-state original pregrade
HDR/meter/history contract; it must not hardcode.90869 to make an image look
similar. No live clock or adaptation-history bridge is provided here.

## Scope and controls

The unit composes two selected operators: original exposure multiplication then
original film/peak-hue/highlight compression. The full grade that normally lies
between those operators, spatial optics, vignette, bloom/dirt/streak, grain,
damage/flash/fade and temporal meter adaptation are deliberately absent. It is
not a replay of the complete original final shader. auto0/1 and hueKeep0/.3/1
are declared diagnostic controls, not new product settings.

Native emits the selected linear film result through an unshaded65×65 viewport,
LINEAR tone mapping and exposure1; native common display transfer runs once for
both calculation/reference. Three uses the owning renderer/classes and explicit
original toSRGB once for both calculation/reference. Each case stores A-A and
all RGB reference differences; success requires exact0 without a tolerance.
Black, toe, gray, warm/saturated and HDR cases plus two nonzero witnesses guard
against empty/constant output. This is an operator unit, not representative game
geometry or a performance workload.

## Reproduce

From repository root, using an existing original High portable client:

```powershell
python prototypes/godot-post-component/capture_post_meter.py --client PATH_TO_PORTABLE --name NEW-meter --quality high --native-loop --completion-poll-ms 100
python prototypes/godot-post-component/capture_three_post_film.py --client PATH_TO_PORTABLE --name NEW-three-film --quality high --native-loop --completion-poll-ms 100
GODOT_CONSOLE --path prototypes/godot-post-component/render --rendering-method forward_plus --rendering-driver vulkan -- --report=ABS_NEW_NATIVE_FILM.json
```

Both browser tools reuse the sibling render component's native tick240 pause
adapter and return before geometry export. They retain invalid reports before
asserting success. Meter capture is a synchronous one-pixel read, strict owner/
e0/tAdapt/format/GL validation, no new draw. The film tool temporarily switches
the existing fullscreen quad to an owned offscreen material, restores it without
disposing shared geometry, restores original RNG without advancing its stream,
and restores native renderer state/RT/viewport/scissor/clear/shadow fields through
native resetState. No arbitrary rawGL replay or additional game refresh draw.
Root result folders are fresh and never overwritten. `GH_BENCH_OUT` may point to
a caller-selected output directory. The existing runner's dependency setup is
unchanged; the tools never download/install dependencies.

The native loader pins compact proof SHA
`1aa0aab81b3ec8458aaf4d549d917e327e9f3937445b6b469d3daab081de8a54`
and case SHA `6db440ac7224472c9a5dc6bc8780d66d161b2e5f25c76bf11711ce63fa9a5543`.
`project_source.py` accepts only the exact reviewed raw capture and regenerates
that lossless operator proof/include. A fresh meter read is new evidence, not
automatically accepted as the frozen test input or new full-scene mapping.

From this package for CPU checks:

```powershell
node --test post-meter.test.mjs post-film.test.mjs
python -m unittest post_meter_capture_test.py projection_test.py
GODOT_CONSOLE --headless --path render --script res://unit_cpu_test.gd
GODOT_CONSOLE --headless --path render --check-only --script res://main.gd
python project_source.py fixtures/source-post-meter-evidence.json render
```

Native files, browser collectors and proof bytes preserve the root-GPU-tested
sources. Only wrapper/import/test locations are relocated. CPU mocks test source
ownership and success/failure restoration; they do not replace real GPU evidence.
`MANIFEST.json` inventories source/proof only; `evidence/MANIFEST.json` separately
inventories root validation artifacts. Historical command paths in evidence
remain unchanged for provenance and are not used as portable runtime paths.

Portable authoring validation passed in an isolated canonical repository layout
without any path override:8 Node tests,4 Python AST/projection tests, actual
Godot4.7.2 headless shader binding and main check-only, all exit0/no errors.
No extra GPU run was performed during packaging.
