# gh-godot-render-snapshot-v1

This is a captured **world-scene render component**, not a game save or a High/fullAI migration. No synthetic/demo scene is accepted as performance evidence. The first capture should come from a ready native fullAI page paused around tick240. Do not take the synchronous export during a clean measurement.

Top-level fields:

- `schema`: exact version above.
- `source`: real `GH.debug.gfx.scene` marker, caller-supplied core SHA256 (nullable if not supplied), separate page bundle ID, source quality/tick/state/time, drawing-buffer size, native camera matrix/projection/fov/aspect/near/far/zoom/layers, background/environment intensity, and last native renderer counters. Those native counters include all gfx passes and are **not** the isolated world-pass comparator.
- `geometries`: map keyed by native geometry UUID, with object UUID suffix for separately frozen skin/morph poses. Original expanded/normalized position, normal, UV and vertex-color arrays keep `itemSize`, `count`, values. Original index, groups and drawRange are retained. A null drawRange count means native infinity. Extra attribute names and native InstancedBufferGeometry count are retained; arbitrary shader attributes are not evaluated.
- `materials`: map keyed by native material UUID. PBR/base/emissive/opacity/side/blend/depth/color/vertex-color flags and texture metadata are retained. Texture pixels, GLSL and uniform graphs are **not** serialized; this prevents accidental recursive scene/resource export. Unsupported shader and material semantics remain explicit.
- `objects`: native UUID/id/name/type/path/parent ID; source world matrix, effective ancestor visibility, own visibility, own layers plus ancestor layer chain, frustum/cast/receive/order flags. Parent layers are metadata, not ANDed into a child's own layers (matching Three traversal). Each object references a geometry and its material list. `surfaces` are the actual intersection of native groups/material-array visibility/drawRange, with original index ranges and explicit indices. Single-material objects correctly ignore geometry material groups. `topologyKey` shares equal geometry/topology independently of material overrides.
- `objects[].instances`: original InstancedMesh count, local instance matrices and optional colors. Zero matrices/counts are retained, not compacted. These map to existing MultiMesh submissions; ordinary meshes are not newly batched. Shader-driven InstancedBufferGeometry keeps its native multiplicity but uses identity transforms because custom GPU vertex logic is unported; this is a prominent approximation, not equivalent FX.
- `objects[].skin`: frozen pose marker plus bind matrices, bone graph/world matrices/inverses. Positions come from the actual native `getVertexPosition()` after cache refresh. Frozen normals are recomputed area-weighted, explicitly approximate; tangents/native normal shader semantics and live bone deformation are not equivalent. Original skinIndex/skinWeight are not redundantly serialized as a second large buffer in v1. Full live skeleton import is a later stage.
- `objects[].owners`: semantic actor1..9 plus rig0/1 and relative rig traversal paths, K9 rig index/team where available, and physics body/prop index/type→object links (including rag `char.root`). Native UUIDs are only snapshot-local; semantic owner/path is the proposed cross-run matching boundary. Player FP ownership is included only if the native `fpbody.rig.root` handle exists; absent mapping must not be invented.
- `lights`: original matrices/position/target/color/intensity/range/decay/angle/layers/shadow metadata. Native Godot light energy/shadow models are approximate.
- `counts`: exact exported unique vertices, vertex references, objects, materials, geometries, surfaces, instances, enumerated triangles, frozen skins, lights and categorized omissions. This is source inventory, not an assertion all objects pass the captured camera's frustum.
- `unsupported` and `parity`: explicit defects/omissions and global flags `renderOnly=true`, `frozenScene=true`, `fullAI=false`, `highParity=false`, `additionalBatching=false`. No ranking versus original High full-game is permitted.

Both worlds use right-handed Y-up/-Z-forward coordinates. Matrices are Three column-major16: basis columns0..2/4..6/8..10, translation12..14. Godot front faces use clockwise winding, so triangle index pairs are reversed at import; vertices, normal directions and coordinate space are not mirrored. UVs and vertex colors retain source values. Godot has20 visibility bits versus Three32; higher bits are recorded as unsupported. Native source frustumCulled=false maps through `RenderingServer.instance_set_ignore_culling`, rather than inventing giant bounds.

## Bounded browser transfer

Evaluate `browser-exporter.js`, then call:

```js
const header = __ghGodotExport.capture({coreSHA256: 'actual-core-sha'});
// Only small counts/source/parity/inventory is returned. All arrays stay in page.
__ghGodotExport.begin();
// Repeatedly read and append UTF-8 bytes DIRECTLY to a file, never join full scene:
const part = __ghGodotExport.readChunk(1048576); // {chunk, done, totalChars}
// Continue until done. Each chunk is <=maxChars+1 UTF16 code units;
// surrogate pairs stay together. Hash the file incrementally in the runner.
__ghGodotExport.release();
```

The reader emits the exact JSON stream in bounded chunks, and serializes numeric arrays only16K values at a time. No full-scene JSON string is created. Capture failure1 (`RangeError: Invalid string length` from full JSON.stringify) remains preserved by root; the new header exposes exact numeric scalar counts and sampled byte-size estimates plus the20 largest buffers before extraction. No geometry/object content is cut to satisfy string limits. The assembled file remains the v1 JSON object; the importer does not need a new container format.
