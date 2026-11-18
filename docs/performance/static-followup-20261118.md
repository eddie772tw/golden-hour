# Static performance follow-up, 2026-11-18

This audit extends `browser-round-20261117.md`, not the superseded candidate
priorities alone. It does not measure frame time. The only added code in this
follow-up is a repeatable offline inventory, not a runtime change.

Run `node scripts/performance/audit_fixed_pools.mjs`. The script evaluates actual
bundled constructors/methods with startup disabled and DOM/GPU/audio forbidden.
It records the source SHA256, asserts its assumptions and outputs JSON. The
recorded output is `evidence/fixed-pools-20261118.json`. The previous isolated
singles-upload candidate remains disabled unless explicitly enabled before boot.

## Findings and proposed order

### 1. Stop submitting empty slots before degrading visible geometry

**Proven static facts:** `_w` creates casing/debris instance meshes at fixed
counts 90/320 with `frustumCulled=false`, `castShadow=true`; empty slots use
zero-scale matrices, not reduced instance counts. `$M.attach` invokes
`_styleCasings`: the initial casing cylinder has 32 triangles, while the styled
18-segment, 13-point lathe has 432 triangles (247 vertices, 10,496 total geometry
attribute/index bytes). The styled mesh's full-capacity submitted index count
represents **38,880 triangles per draw**. Debris adds 3,840 at full capacity.
Three's actual instanced render path passes `mesh.count` to
`drawElementsInstanced`; it does not inspect the zero matrices first.

These are submission counts if a particular pass draws that mesh, including
zero-area instances, **not visible triangles, measured GPU work, or a per-frame
sum**. Driver caching, pass inclusion, double-sided handling and workload
occupancy still need measurement. A 432-triangle casing alone is not proof of
excessive visible detail.

**Next minimal candidate:** preserve physical ring-slot identity, but submit
only through the highest occupied slot (zero when empty). Do not compact/reorder
live instances. Check whether settled/fading entries and first-spawn before the
next physics tick require a conservative delayed update. `reset()` currently
iterates `mesh.count`, so simply shrinking count would make that reset incomplete;
reset must still clear full capacity before any later expansion. Add ring-wrap,
retirement, reset/expand, skipped simulation, and native pass pixel controls.
Count occupancy/submissions per pass before treating this as the major bottleneck.
This proposal is **not implemented or enabled**.

If occupancy is normally high, evaluate screen-space casing detail separately.
Do not combine a high-water draw change and a lathe segment reduction in one
performance comparison. The latter changes silhouettes and needs a visual-error
policy, near/far/shadow/reflection comparisons and user review if material.

### 2. Decal event uploads have another bounded dirty-span opportunity

**Proven static facts:** `$M.attach` uses `KM(600, ...)`. One actual `KM.add`
changes one slot in four attributes (matrix/color/rect/info), then marks all four
for full upload. The inventory invokes the real add method with actual Three
attributes, excluding only texture construction: **64,800 bytes** of buffers
are marked dirty; the modified slot spans **108 bytes**. Four full buffers are
an upload-volume upper bound for one actual upload, not a cost per decal call:
multiple additions can coalesce before rendering.

**Next measurement:** owner-tag these four attributes in the existing census;
record additions, uploaded versions, ranges, bytes and upload calls during active
ticks. A pending-span candidate must retain changes across deferred draws,
ring wrap, clear and quality/context recreation. Avoid many tiny per-slot driver
calls. Do not widen the current singles candidate without a separate oracle and
acceptance run. This finding is **not a measured bandwidth bottleneck**.

### 3. Glow color rewrites warrant a small owner census, not a global cache

**Proven static facts:** `$M.setGlow` always writes a three-float color and marks
the entire instance-color buffer, without checking its prior scalar `k`.
`_flick` calls it for every glow belonging to each active flicker. A changing
fire/flicker legitimately needs updates, so an equality guard may save nothing
in normal play. Exact equality of `k` is insufficient if the base color can
change. Count unchanged requests and actual buffer bytes first; any optimization
must own base-color invalidation and preserve Float32 storage semantics. No
per-frame gain is inferred here, and no cache is added.

## Rejected shortcuts / false positives

- GPU readback APIs `BM.readMeter()` and VM blur `maxVelocity()` exist, but the
  static search found definitions only, not ordinary runtime call sites. The
  exposure pass adapts on GPU and VM blur render does not call `maxVelocity`.
  Their presence alone does not establish a render-loop synchronization stall.
- `mb` particles already compact live data, use a two-pass radix sort rather
  than an allocating comparison sort, and upload an active prefix. Do not call
  all pools full-buffer offenders or replace the stable sort without proving
  transparent ordering and RNG equivalence.
- World batches already disable local `matrixAutoUpdate`; world-pass matrix
  snapshot sharing is already adopted. A blanket static-scene freeze risks
  moving props, actor rigs and ragdolls for little unmeasured benefit.
- Previous normal-state work measured about 0.18 ms/frame gross parameter work,
  not the entire AO pass. Global material caches, stale GTAO line registries,
  fixed actor bounds and generic audio pooling remain rejected; this audit does
  not revive them. Audio latencyHint experiments remain stopped.

## Acceptance boundary

Current evidence supports prioritizing an **empty/low-occupancy draw census**
before indiscriminate model simplification, and a **decal-owner upload census**
before another dirty-span implementation. It does not replace the established
1080p DPR1 High, reflection ≤30 Hz, nine native AI / 3,600 ticks, eight logical
exports, first-use and long-frame preservation, native visual controls and clean
repeated comparison requirements. No new FPS or 1% low result is claimed.

## Model-density inventory (verified against the integrated source)

Run `node scripts/performance/audit_model_density.mjs`; reproducible values and
source/asset hashes are in `evidence/model-density-20261118.json`. This evaluates
the actual bundled geometry constructors and world batch methods, with startup,
DOM, audio and GPU calls forbidden, and decodes the shipped operator pack using
its native decoder. No runtime code or visual-quality settings change.

- **Operator body:** both records in `game/assets/operators.bin` have an active
  draw range of 95,922 indices, or **31,974 triangles**. Each record stores 28,468
  vertices and 99,966 indices (33,322 stored triangles). The larger storage count
  must not be substituted for the active draw range. The decoder validates
  `triangles === drawRange.count / 3`; `restoreOperator` in
  `game/client/startup-geometry.js` applies that range to the geometry. These are
  body-pack counts, not an entire equipped actor or all-pass frame total.
- **Hotel circular door-window components:** the actual four-constructor `Y(...)`
  line in `game/core/game.js`, identified by `new zo([[0.148 + 0.05, 0]`, builds a
  six-point / 44-segment lathe (440 triangles), a 6×44 torus (528), a 44-segment
  capped cylinder (176), and a 44-segment circle (44): **1,188 triangles per four-
  component group**. This excludes the eight surrounding fasteners and the rest
  of the door. It is not a count of all windows or visible windows in the scene.
- **Indexed → non-indexed expansion:** `Mw.addGeometry` invokes `toNonIndexed()`
  for indexed inputs, then copies position/normal/UV; `Mw.finalize` builds batches
  without an index buffer. The four window components contain **899 source
  vertices**, expanding to **3,564 vertices** (three per triangle), about **3.96×**
  the source vertex count. An isolated same-material batch through those actual
  methods contains 114,048 bytes of position/normal/UV attributes. This byte
  count excludes source indices and any other resources; it is not total GPU
  memory or measured traffic. Triangle count stays 1,188: expansion loses vertex
  reuse, not adds triangles. The production components have differing materials,
  so the isolated batch is not a claim of one real-scene draw call.

These values identify where to measure screen-space error, pass inclusion,
visibility/occupancy, attribute bandwidth and vertex processing. They **do not
prove these objects are performance bottlenecks**. More vertices may be offset
by batching benefits; procedural shape detail can be justified in close views.
Before reducing segments, changing the body mesh or retaining indices, collect
real GPU/frame-time evidence and compare near/far/shadow/reflection appearance.
Do not multiply one object's triangles by actor count and passes and label the
result observed work. The existing full native nine-AI acceptance gates still
apply; no additional FPS or 1% low improvement is claimed.
