# Shop shape study 03 (local review candidate)

Sources: the pre-edit Golden Hour models in commit `c767e8f`. Mind the Shop's
`docs/open-demo/WEAPON_SLICE.md` (commit `3b589b84231d7445ee9968be399b493cfda18c9f`)
identifies the PT92, full-size Uzi, and Remington 870 as artistic inspirations.
The Lin-Bei keeps its full-length wood stock and long barrel. No third-party
photographs, logos, or extracted commercial game models are included.

With Blender 4.3.2, run the shape script using an unmodified input directory,
then feed its results to the detail script. Use distinct intermediate paths.
Both scripts are Blender Python (bpy). The shape study produces editable shape
keys; the game receives evaluated static triangles, not morph targets.

    blender -b -P scripts/art/sculpt_shop_silhouettes.py -- ABS_BASE ABS_SHAPE ABS_BLEND
    blender -b -P scripts/art/detail_shop_surfaces.py -- ABS_SHAPE ABS_FINAL
    python scripts/art/check_shop_geometry.py ABS_BASE ABS_FINAL

G-Bull's grip contour, Chin-Gi's outer housing/panels and Lin-Bei's wooden
stock contour were adjusted, with restrained low relief on the back faces.
The two separate near-camera iron assemblies received exterior edge highlights
from bevel geometry. World meshes do not need those close-up bevels.
No firing behavior, sockets, sight offsets, game cameras, attachment mounts
or material assignments were modified. Geometry cost is verified by the
checker; it is not a frame-rate benchmark. The separate game notebook's high
submitted-triangle totals include multiple passes, not unique models.

Blender renders are asset evidence only. Native game ADS and attachment review
remain separate acceptance gates. In particular the G-Bull uses a family
fallback rather than a dedicated two-socket alignment path.

### Final receiver/mount pass

Near-camera back caps gained subdued pressed relief. The optic trim is an
optional, shared 64-triangle mesh only on a rig with a real optic child; no trim
is allocated or drawn for irons. No camera or optic anchor moves. Two long-gun
laser visual groups/beam origins were translated together to meet the new
fore-end, without changing projectile origin or ballistics. The world rig has
no independent native optic mount: validation of its GLB and optional iron flags
does not demonstrate feature parity for third-person attachments.

Run the actual game geometry factory in Node (texture canvases stubbed, no
WebGL benchmark): `node scripts/art/check_shop_native_rigs.cjs`. It covers 14
representative builds, not every possible gun/camo/accessory permutation.
Native center contacts for the three close-up reflex assemblies are respectively
-1.54, -0.50 and -0.45 game millimetres (negative = visually nested surfaces).
A single center sample is a gross fitting check, not a certified whole-mesh
intersection test.

Review the [iron](../../docs/art/shop-review/native-rig-irons-study.jpg)
and [reflex](../../docs/art/shop-review/native-rig-reflex-study.jpg)
A/B plates. The underlying attachment meshes and resting camera positions are
taken from the game's native rig at 55 degrees vertical FOV and 960×600.
Blender lighting, no HUD/hands, no lens shader; centered review crop. This is
not an in-game screenshot. External visual reference: Ubisoft's
[Sights & Scopes developer blog](https://www.ubisoft.com/en-us/game/rainbow-six/siege/news-updates/77PNM7F9qztJpYi0WkRxoY/dev-blog-sights-scopes-in-y5s3).
Nothing was extracted from Siege.

| Asset | View triangles | World triangles | Body material batches |
|---|---:|---:|---:|
| G-Bull | 37,716 | 4,864 | 9 |
| Chin-Gi | 19,720 | 4,720 | 9 |
| Lin-Bei | 19,252 | 4,505 | 7 |

Chin-Gi follow-up: kept the rectangular full-size silhouette, but eased the
outer housing shoulders into the end caps and shaped the handle's waist,
heel and side panels together. No extra triangles or attachment slots.
[Previous vs revised contour, same camera and lighting](../../docs/art/shop-review/chingi-contour-review.jpg).

G-Bull/Lin-Bei follow-up: wrapped the pistol panels along their original rake,
softened the two exterior slide cheeks, and tapered the shotgun's walnut
fore-end and wrist into its receiver shoulders. The full stock/barrel were
retained. Both close-up optic shrouds were re-seated against the new art after
the native fitting test detected gaps. No triangle increase vs the previous
pair. [Same-camera close-ups](../../docs/art/shop-review/gbull-linbei-contour-review.jpg).
