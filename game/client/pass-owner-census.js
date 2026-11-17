// Explicit diagnostic only. Normal startup does not import this module.
const PASSES = ["outside", "world", "reflection", "ao-normal", "shadow", "VM", "VM-override", "fx-layer2", "distortion", "postprocess"];
const OWNERS = ["unclassified", "hotel.batch", "actor.body", "actor.weapon", "FP.body", "FP.weapon", "glass.shards", "glass.intact", "glass.pane", "physics.casing", "physics.chunks", "FX.particles", "FX.distortion", "world.instanced", "world.other", "postprocess", "skinned.other", "VM.other", "points.lines", "shared.arrays"];
const FIELDS = ["submissions", "draws", "triangles", "Dcalls", "parameters", "uniformLists", "programBinds", "bufferCalls", "bufferBytes", "textureCalls", "textureBytes", "drawTimed", "drawWallMS", "parameterTimed", "parameterWallMS", "uploadTimed", "uploadWallMS", "allocationBytes", "clipCalls", "clipTimed", "clipWallMS", "clipRejected"];

export function installPassOwnerCensus(GH = globalThis.GH, options = {}) {
  const d = GH?.debug, g = d?.gfx, r = g?.renderer, gl = r?.getContext();
  if (!GH?.ready || !gl) throw Error("Pass-owner census requires ready GH");
  if (globalThis.__ghOwnerCensus?.installed) throw Error("Census already installed");
  const perf = options.performance || globalThis.performance, every = Math.max(1, options.sampleEvery || 32);
  const objects = new WeakMap(), arrays = new WeakMap(), patches = [], rows = new Float64Array(PASSES.length * OWNERS.length * FIELDS.length);
  const passCalls = new Float64Array(PASSES.length), passMS = new Float64Array(PASSES.length);
  const bodySnapshots = { calls: 0, inclusiveWallMS: 0 };
  let installed = true, active = false, pass = 0, row = -1, reflection = 0, frames = 0, conflicts = 0;
  let sampleState = 0x47484332;
  function sample() { // Private high bits avoid locking onto alternating position/normal uploads.
    sampleState ^= sampleState << 13; sampleState ^= sampleState >>> 17; sampleState ^= sampleState << 5;
    return (sampleState >>> 16) % every === 0;
  }
  const index = (p, o) => (p * OWNERS.length + o) * FIELDS.length;
  const add = (offset, field, value = 1) => { if (offset >= 0) rows[offset + field] += value; };
  function patch(object, key, make) {
    if (!object || typeof object[key] !== "function" || patches.some(p => p.object === object && p.key === key)) return;
    const original = object[key], descriptor = Object.getOwnPropertyDescriptor(object, key), wrapped = make(original);
    object[key] = wrapped; patches.push({ object, key, original, descriptor, wrapped });
  }
  function tag(mesh, owner) {
    if (!mesh) return;
    objects.set(mesh, owner);
    const geometry = mesh.geometry;
    if (geometry) {
      for (const a of Object.values(geometry.attributes || {})) {
        const array = a.isInterleavedBufferAttribute ? a.data.array : a.array;
        if (array) tagArray(array, owner);
      }
      if (geometry.index) tagArray(geometry.index.array, owner);
    }
    for (const attribute of [mesh.instanceMatrix, mesh.instanceColor]) if (attribute?.array) tagArray(attribute.array, owner);
    if (mesh.skeleton?.boneMatrices) tagArray(mesh.skeleton.boneMatrices, owner);
    if (mesh.skeleton?.boneTexture?.image?.data) tagArray(mesh.skeleton.boneTexture.image.data, owner);
  }
  function tagArray(array, owner) { const prior = arrays.get(array); arrays.set(array, prior === undefined || prior === owner ? owner : 19); }
  function tagTree(root, owner) { root?.traverse?.(o => { if (o.isMesh || o.isPoints || o.isLine) tag(o, owner); }); }
  function tagRig(rig, bodyOwner, gunOwner) {
    if (!rig) return;
    rig.root?.traverse?.(o => { if (o.isMesh || o.isPoints || o.isLine) tag(o, o === rig.body || o.skeleton && o.skeleton === rig.body?.skeleton ? bodyOwner : gunOwner); });
    tag(rig.body, bodyOwner);
    patch(rig, "setWeapon", original => function (...args) { const v = original.apply(this, args); tagTree(this.gun?.root, gunOwner); return v; });
  }
  for (const mesh of d.world?.meshes || []) tag(mesh, 1);
  for (const bot of d.match?.bots || []) for (const rig of bot.rigs || []) tagRig(rig, 2, 3);
  tagRig(d.fpbody?.op, 4, 5); tag(d.fpbody?.view, 4); tag(d.fpbody?.rest, 4);
  tag(d.glass?.shards, 6); tag(d.glass?.intact, 7);
  for (const p of d.glass?.panes || []) tag(p.mesh, 8);
  patch(d.glass, "_fracture", original => function (pane) { const v = original.call(this, pane); tag(pane.mesh, 8); return v; });
  tag(d.physics?.caseMesh, 9); tag(d.physics?.chunkMesh, 10);
  tag(d.fx?.p?.mesh, 11); tag(d.fx?.distort?.mesh, 12);
  patch(g.bodyBoundsObserver, "afterWorldSnapshot", original => function (...args) {
    const start = active ? perf.now() : 0;
    try { return original.apply(this, args); }
    finally { if (active) { bodySnapshots.calls++; bodySnapshots.inclusiveWallMS += perf.now() - start; } }
  });
  patch(g.bodyBoundsObserver, "outsideClip", original => function (object, camera, scene) {
    if (!active || objects.get(object) !== 2) return original.call(this, object, camera, scene);
    const target = index(pass, 2), timed = sample(), start = timed ? perf.now() : 0;
    add(target, 18);
    try { const rejected = original.call(this, object, camera, scene); if (rejected) add(target, 21); return rejected; }
    finally { if (timed) { add(target, 19); add(target, 20, perf.now() - start); } }
  });
  function owner(object) {
    let value = objects.get(object);
    if (value === undefined) {
      value = pass === 9 ? 15 : object?.isSkinnedMesh ? 16 : pass === 5 || pass === 6 ? 17 : object?.isPoints || object?.isLine || object?.isLine2 ? 18 : object?.isInstancedMesh ? 13 : 14;
      tag(object, value);
    }
    return value;
  }
  function classify(scene, camera) {
    if (scene === g.vmScene) return scene.overrideMaterial ? 6 : 5;
    if (scene !== g.scene) return 9;
    if (reflection) return 2;
    if (scene.overrideMaterial) return 3;
    return camera.layers?.mask === 4 ? 7 : camera.layers?.mask === 8 ? 8 : 1;
  }
  patch(g, "preRender", original => function (...args) { reflection++; try { return original.apply(this, args); } finally { reflection--; } });
  patch(r, "render", original => function (scene, camera) {
    const previous = pass; pass = classify(scene, camera);
    const start = active ? perf.now() : 0, p = pass;
    try { return original.call(this, scene, camera); }
    finally { if (active) { passCalls[p]++; passMS[p] += perf.now() - start; } pass = previous; }
  });
  patch(r.shadowMap, "render", original => function (...args) {
    const previous = pass; pass = 4; const start = active ? perf.now() : 0;
    try { return original.apply(this, args); }
    finally { if (active) { passCalls[4]++; passMS[4] += perf.now() - start; } pass = previous; }
  });
  patch(r, "renderBufferDirect", original => function (camera, scene, geometry, material, object, group) {
    const previous = row; row = active ? index(pass, owner(object)) : -1;
    add(row, 0); const timed = row >= 0 && sample(), start = timed ? perf.now() : 0;
    try { return original.call(this, camera, scene, geometry, material, object, group); }
    finally { if (timed) { add(row, 11); add(row, 12, perf.now() - start); } row = previous; }
  });
  for (const key of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) patch(gl, key, original => function (...args) {
    if (active && row >= 0) {
      add(row, 1); const count = key.startsWith("drawArrays") ? args[2] : args[1];
      const instances = key.endsWith("Instanced") ? args[key.startsWith("drawArrays") ? 3 : 4] : 1;
      if (args[0] === gl.TRIANGLES) add(row, 2, count * instances / 3);
    }
    return original.apply(this, args);
  });
  patch(gl, "useProgram", original => function (...args) { if (active) add(row, 6); return original.apply(this, args); });
  for (const key of ["bufferData", "bufferSubData", "texSubImage2D"]) patch(gl, key, original => function (...args) {
    if (!active) return original.apply(this, args);
    const texture = key === "texSubImage2D";
    let data = key === "bufferSubData" ? args[2] : args[1];
    if (texture) { data = null; for (let i = args.length - 1; i >= 0; i--) if (ArrayBuffer.isView(args[i])) { data = args[i]; break; } }
    const arrayOwner = arrays.get(data), target = arrayOwner === undefined ? row >= 0 ? row : index(pass, 0) : index(pass, arrayOwner);
    let bytes = ArrayBuffer.isView(data) || data instanceof ArrayBuffer ? data.byteLength : 0;
    if (!texture && data && Number.isFinite(data.byteLength)) {
      const element = data.BYTES_PER_ELEMENT || 1, remaining = Math.max(0, data.byteLength - (args[3] || 0) * element);
      bytes = args[4] ? Math.min(remaining, args[4] * element) : remaining;
    }
    if (key === "bufferData" && typeof data === "number") add(target, 17, data);
    add(target, texture ? 9 : 7); add(target, texture ? 10 : 8, bytes);
    const timed = sample(), start = timed ? perf.now() : 0;
    try { return original.apply(this, args); }
    finally { if (timed) { add(target, 15); add(target, 16, perf.now() - start); } }
  });
  patch(g, "render", original => function (...args) {
    active = installed && GH.G?.state === "playing" && !globalThis.document?.hidden && GH.benchmark?.tick > 0 && GH.benchmark.tick < 3600;
    if (active) frames++;
    try { return original.apply(this, args); } finally { active = false; row = -1; pass = 0; }
  });
  const previousHook = globalThis.__ghOwnerCensus;
  const api = {
    installed: true,
    get currentRow() { return active ? row : -1; },
    select() { if (active) add(row, 3); },
    parameters(offset) { if (!active || offset < 0) return -1; add(offset, 4); return sample() ? perf.now() : -1; },
    parameterEnd(offset, start) { if (start >= 0) { add(offset, 13); add(offset, 14, perf.now() - start); } },
    list() { if (active) add(row, 5); },
    export() {
      const table = [];
      for (let p = 0; p < PASSES.length; p++) for (let o = 0; o < OWNERS.length; o++) {
        const offset = index(p, o), values = Array.from(rows.subarray(offset, offset + FIELDS.length));
        if (values.some(Boolean)) table.push({ pass: PASSES[p], owner: OWNERS[o], ...Object.fromEntries(FIELDS.map((f, i) => [f, values[i]])) });
      }
      return { version: "pass-owner-census-v2", diagnosticOnly: true, frames, sampleEvery: every, sampling: "private xorshift high bits", table,
        passes: PASSES.map((label, i) => ({ label, calls: passCalls[i], inclusiveWallMS: passMS[i] })), bodySnapshots: { ...bodySnapshots }, conflicts,
        metadataHooksRequired: true, source: options.source || null,
        limits: ["Active playing visible ticks 1..3599 only. No gameplay/RNG/visibility changes.",
          "Submissions and actual GL draws differ. Row draw timing is sampled renderBufferDirect inclusive wall time, not all owner work or GPU time.",
          "Parameter/upload timing samples are included in draw/pass spans; never add parent/child times. Samples do not estimate a guaranteed recoverable budget.",
          "Known source arrays label uploads before queue construction; new/unknown arrays remain unclassified or current-draw owned. Shared arrays are reported separately.",
          "Buffer storage allocations are separate from payload bytes. Texture bytes are full typed-array argument sizes, an upper bound rather than rectangle/offset-consumed bytes; DOM/compressed/PBO uploads are not measured. Context loss/quality rebuild require a fresh diagnostic run."] };
    },
    stop() {
      installed = active = api.installed = false;
      for (const p of patches.reverse()) {
        if (p.object[p.key] !== p.wrapped) { conflicts++; continue; }
        if (p.descriptor) Object.defineProperty(p.object, p.key, p.descriptor); else delete p.object[p.key];
      }
      if (globalThis.__ghOwnerCensus === api) {
        if (previousHook === undefined) delete globalThis.__ghOwnerCensus; else globalThis.__ghOwnerCensus = previousHook;
      }
    },
  };
  globalThis.__ghOwnerCensus = api; return api;
}
