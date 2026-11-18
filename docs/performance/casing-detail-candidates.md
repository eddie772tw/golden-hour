# Casing detail candidates, 2026-11-18

Status: **owner-selected low (84 triangles) is now the default**. This builds on the
fixed-pool inventory. No instance count, physics, ring order, reset, lifetime,
material shader or shadow policy is changed. It does not address idle-slot draw
submission yet: combining that change with new geometry would confound the
comparison, and shrinking `mesh.count` naively breaks the existing reset loop.

## Geometry

| Detail | Radial segments | Profile points | Triangles | Vertices | Geometry bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| original | 18 | 13 | 432 | 247 | 10,496 |
| medium candidate | 8 | 8 | 112 | 72 | 2,976 |
| low candidate | 6 | 8 | 84 | 56 | 2,296 |

The reduced profile keeps the designed radial maximum, axial extent, raised base
rim, body taper, open mouth, inner wall and inner floor. It omits the small
primer recess and extraction groove and simplifies the mouth lip. Radial
faceting changes the sampled silhouette even though the designed radius is the
same. This is an intentional visual tradeoff, not equivalent pixels. In
particular, six segments may be conspicuous in a very close or high-contrast
view; medium is the proposed first candidate to inspect in the real game.

The owner explicitly selected low detail after reviewing the comparison. Unset,
`'low'`, null and unrecognized values now use **84 triangles**. For A/B, set
`globalThis.__GH_CASING_DETAIL = 'original'` (or `'high'`) **before core startup**
to recover byte-exact original geometry, or use `'medium'` for 112 triangles.
This is a fixed owner-selected default, not distance-adaptive LoD. Runtime material/shader and
`_styleCasings` replacement/disposal remain as before.

## Verification and review artifacts

`node --test server/*test.mjs`: **186/186 passed**, including four casing regression
tests. The original construction is independently reconstructed and compared
byte-for-byte (positions, normals, UVs and indices) against explicit `'original'`/`'high'` settings. Default and invalid settings are
byte-exact low geometry; actual `_styleCasings` startup is checked for default84,
original432 and medium112, idempotence, prior geometry disposal, unchanged ring
state/instance matrices/count and original shader key. Reduced geometry tests check finite data, valid indices, triangle
counts, radial/axial design envelope, inner mouth and floor.

Actual bundled Three geometry is exported, including its normals and indices:

```
node scripts/performance/export_casing_geometry.mjs > /tmp/casing-geometry.json
blender -b -t 2 --python scripts/performance/render_casing_review.py -- /tmp/casing-geometry.json outputs/casing-review
```

The Blender scene uses those meshes and a common approximate brass material.
It does **not** duplicate the game shader, shadow atlas, postprocessing, blur,
lighting or antialiasing; a nice offline image cannot validate native pixels.
The generated `.blend` preserves the magnified comparison scene.

The distance images show side-on 42 mm casings with the game's standard rifle
casing instance dimensions. At 1080p and a 90-degree vertical FOV, ideal projected
length is approximately 45.4 px at 0.5 m, 22.7 px at 1 m, and 7.6 px at 3 m.
This is analytic perspective scale, not recorded gameplay distance. Blender uses
an orthographic view with equivalent local pixel scale to eliminate unrelated
perspective differences across the comparison columns. Inspect the PNGs at 100%.
Different ammunition, orientation, FOV, resolution and motion change these sizes.

## Remaining gates

Review the close-up rim/mouth and six/eight-sided silhouettes in motion and
contrasting light, plus real main/reflection/shadow passes. Preserve original
shell/brass color switching and shader behavior. Native rendering, quality/context restore and complete-AI performance acceptance
remain pending despite the owner accepting this visual tradeoff.
No browser/GPU FPS test was completed in this environment; the prior Chromium
socket restriction is unchanged. Geometry reduction is not a measured frame-time
improvement. The user-selected 84-triangle default is an appearance/geometry decision, not
proof that the outstanding frame-time target has been met.

## Offline visual assessment

The magnified render makes the tradeoff explicit: medium/low have visibly
polygonal mouths and less distinct base rims than original. At 0.5 m equivalent
side-on scale, all are thin roughly 45-pixel-long objects and those differences
are much less prominent, but their specular response is not identical. This
single view does not cover near-camera ejection, rotating glints or a larger
shotgun shell. The initial recommendation was to evaluate medium first. The owner subsequently
explicitly selected low; this change follows that decision rather than inferring
visual approval from offline distance images.

Review images: [magnified](evidence/casing-review/casing-macro.png),
[0.5 m](evidence/casing-review/casing-distance-0.5m.png),
[1 m](evidence/casing-review/casing-distance-1m.png),
[3 m](evidence/casing-review/casing-distance-3m.png).

## Default-selection update

The default changes geometry from 432 to 84 triangles (80.6% fewer) and from
10,496 to 2,296 geometry bytes (78.1% fewer). Fixed 90-slot capacity remains:
if that mesh is submitted at full capacity, nominal triangle submissions become
7,560 instead of 38,880 per draw, including degenerate inactive slots. These
are exact geometry/submission counts, **not measured GPU savings or FPS**.
The separate singles upload candidate remains independently opt-in. The original
Blender comparison images remain valid because none of the three geometries
changed in this default-selection update.
