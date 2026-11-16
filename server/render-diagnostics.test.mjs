import test from "node:test";
import assert from "node:assert/strict";
import { installRenderDiagnostics } from "../game/client/render-diagnostics.js";
import { loadBundle } from "./fixtures/bundle-probe.mjs";

function fixture() {
  let clock = 0;
  const traces = [], native = [], listeners = new Map(), queries = [];
  const perf = { now: () => clock, timeOrigin: 1000, measure: (...args) => traces.push(["measure", ...args]),
    mark: (...args) => traces.push(["mark", ...args]), clearMarks() {}, clearMeasures() {} };
  const advance = ms => { clock += ms; };
  const canvas = { width: 1920, height: 1080,
    addEventListener(name, fn) { const set = listeners.get(name) || new Set(); set.add(fn); listeners.set(name, set); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatch(name) { for (const fn of listeners.get(name) || []) fn({ preventDefault() { throw Error("diagnostics must not own context restore"); } }); },
  };
  const gl = { QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2, CURRENT_QUERY: 3, active: null, lost: false, disjoint: false,
    availableReads: 0, resultReads: 0, begins: 0, ends: 0, extensionRequests: 0,
    getExtension() { this.extensionRequests++; return { TIME_ELAPSED_EXT: 4, GPU_DISJOINT_EXT: 5 }; },
    isContextLost() { return this.lost; }, getParameter() { return this.disjoint; },
    getQuery() { return this.active; },
    createQuery() { const query = { ready: false, deleted: false }; queries.push(query); return query; },
    deleteQuery(query) { query.deleted = true; },
    beginQuery(_, query) { assert.equal(this.active, null, "queries cannot nest"); this.begins++; this.active = query; },
    endQuery() { assert.ok(this.active); this.ends++; this.active = null; },
    getQueryParameter(query, parameter) {
      if (this.throwQuery) throw Error("timer API failure");
      if (parameter === 1) { this.availableReads++; return query.ready; }
      assert.ok(query.ready, "must not read unavailable GPU result"); this.resultReads++; this.afterResult?.(); return 2000000;
    },
    drawArrays() { native.push("draw"); advance(1); },
    drawElements() { native.push("draw"); advance(1); },
    drawArraysInstanced() { native.push("instanced"); advance(1); },
    drawElementsInstanced() { native.push("instanced"); advance(1); },
    useProgram() { native.push("program"); }, uniformMatrix4fv() { native.push("matrixUniform"); },
    uniform1f() { native.push("uniform"); }, compileShader() { native.push("compile"); },
    linkProgram() { native.push("link"); advance(2); }, getProgramParameter() { native.push("queryProgram"); advance(3); },
  };
  const material = {}, program = {}, shadowMaterial = {};
  const scene = { type: "Scene", updateMatrixWorld() { native.push("worldMatrix"); advance(2); } };
  const vmScene = { type: "Scene", updateMatrixWorld() {} };
  const camera = { layers: { mask: 3 } }, vmCamera = { layers: { mask: 1 } }, reflectionCamera = { layers: { mask: 3 } };
  const renderer = { domElement: canvas, info: { programs: [] }, getContext: () => gl, getRenderTarget: () => null,
    renderBufferDirect(_camera, _scene, _geometry, mat) {
      native.push(mat === material ? "material" : "shadowMaterial");
      gl.useProgram(program); gl.uniformMatrix4fv(); gl.uniform1f(); gl.drawElements();
    },
    shadowMap: { enabled: true, render() { if (this.enabled) renderer.renderBufferDirect(camera, scene, {}, shadowMaterial, {}); } },
    render(s, c) { advance(1); renderer.shadowMap.render(); renderer.renderBufferDirect(c, s, {}, material, {}); advance(2); },
  };
  const player = { update() { native.push("player"); advance(4); return 17; } };
  const bot = { update() { native.push("bot"); advance(5); }, idle() {} };
  const match = { bots: [bot], update() { this.bots.forEach(value => value.update()); advance(1); }, createBots() { this.bots = [{ update() { advance(7); }, idle() {} }]; } };
  const gfx = { renderer, scene, camera, vmScene, vmCamera, quality: "high", q: { scale: 1 },
    preRender() { renderer.render(scene, reflectionCamera); },
    _build() { this.composer = { passes: [{ render() { renderer.render(scene, camera); } }] }; },
    render() { scene.updateMatrixWorld(); if (this.reflection !== false) this.preRender(); this.composer.passes.forEach(pass => pass.render()); },
  };
  gfx._build();
  const GH = { ready: true, G: { state: "playing" }, benchmark: { tick: 0 }, debug: { gfx, player, match } };
  const install = options => installRenderDiagnostics(GH, { performance: perf, ...options });
  const run = () => { GH.benchmark.tick++; gfx.render(1 / 60); };
  return { GH, gfx, renderer, scene, gl, canvas, queries, perf, traces, native, install, run, advance, material, program, listeners };
}

test("explicit install preserves native work, this/return values and stop restores inherited methods", () => {
  const f = fixture(), original = f.gfx.render, sceneFn = f.scene.updateMatrixWorld;
  f.run(); const expected = f.native.slice(); f.native.length = 0;
  const api = f.install({ gpu: false });
  assert.equal(api.installed, true); assert.equal(f.GH.debug.player.update(), 17); f.native.length = 0;
  f.run(); assert.deepEqual(f.native, expected);
  assert.equal(f.install(), api); api.stop();
  assert.equal(f.gfx.render, original); assert.equal(f.scene.updateMatrixWorld, sceneFn);
  assert.equal([...f.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  const count = api.export().coverage.spans.total; f.run(); assert.equal(api.export().coverage.spans.total, count);
});

test("CPU spans retain nesting and self durations; counts/summary survive raw ring rollover", () => {
  const f = fixture(), api = f.install({ gpu: false, uniformCounts: true, limits: { spans: 100 } });
  f.GH.debug.match.update(); f.run();
  const result = api.export(), world = result.spans.find(row => row.label === "render.world");
  const shadow = result.spans.find(row => row.parent === world.id && row.label === "shadow.render");
  assert.ok(shadow); assert.equal(world.inclusiveMS, 5); assert.equal(world.selfMS, 4);
  assert.equal(world.counts.draws, 2); assert.equal(shadow.counts.draws, 1);
  assert.equal(world.counts.submissions, 2); assert.equal(world.counts.uniqueMaterials, 2);
  assert.equal(world.counts.uniformCalls, 4); assert.equal(world.counts.matrixUniformCalls, 2);
  assert.equal(world.counts.programUses, 2); assert.equal(world.counts.uniquePrograms, 1);
  assert.equal(world.counts.materialRuns, 2);
  assert.equal(result.summaries.match.inclusiveMS, 6); assert.equal(result.summaries.match.selfMS, 1);
  assert.equal(result.summaries["bots.update"].calls, 1);
  assert.equal(result.frames[0].reflectionCalls, 1); assert.equal(result.frames[0].intervalMS, null);
  const oldCalls = result.summaries["gfx.render"].calls; f.run();
  assert.equal(result.summaries["gfx.render"].calls, oldCalls, "exports are snapshots");
  const short = fixture(), a = short.install({ gpu: false, limits: { spans: 3, frames: 2 } });
  for (let i = 0; i < 5; i++) short.run();
  const bounded = a.export();
  assert.equal(bounded.spans.length, 3); assert.equal(bounded.frames.length, 2);
  assert.equal(bounded.coverage.frames.dropped, 3); assert.ok(bounded.coverage.spans.dropped > 0);
  assert.equal(bounded.summaries["gfx.render"].calls, 5);
  assert.equal(bounded.summaries["gfx.render"].counterTotals.draws, 20);
});

test("GPU samples are asynchronous, rotate scopes, never nest, and carry draw/stratum evidence", () => {
  const f = fixture(), api = f.install({ gpuEveryFrames: 1, gpuScopes: ["render.world", "shadow.render", "gfx.render"] });
  f.run(); assert.equal(f.gl.begins, 1); assert.equal(f.gl.ends, 1);
  assert.equal(f.gl.resultReads, 0); assert.equal(api.export().gpu.length, 0);
  f.queries[0].ready = true; f.run(); f.queries[1].ready = true; f.run(); f.queries[2].ready = true;
  const result = api.export();
  assert.equal(result.gpu.length, 3); assert.deepEqual(result.gpu.map(row => row.label), ["render.world", "shadow.render", "gfx.render"]);
  assert.deepEqual(result.gpu.map(row => row.ms), [2, 2, 2]);
  assert.deepEqual(result.gpu.map(row => row.counts.draws), [2, 1, 4]);
  assert.ok(result.gpu.every(row => row.frameWork.reflectionCalls === 1));
  for (const row of result.gpu) assert.ok(result.spans.some(span => span.id === row.span));
  assert.equal(f.gl.begins, 3); assert.equal(f.gl.resultReads, 3);
});

test("empty shadow samples are distinguished and existing external timer ownership is respected", () => {
  const f = fixture(), external = {};
  f.renderer.shadowMap.enabled = false; f.gl.active = external;
  const api = f.install({ gpuEveryFrames: 1, gpuScopes: ["shadow.render"] });
  f.run(); assert.equal(f.gl.begins, 0); assert.equal(f.gl.active, external);
  f.gl.active = null; f.run(); f.queries[0].ready = true;
  const result = api.export(); assert.equal(result.gpu[0].counts.draws, 0);
  assert.ok(Object.keys(result.gpuState.sampleStrata).some(key => key.includes("draws=zero")));
  api.stop(); assert.equal(f.gl.ends, 1);
});

test("pending queries are bounded; disjoint before/after result invalidates rather than reporting zero", () => {
  const f = fixture(), api = f.install({ gpuEveryFrames: 1, gpuScopes: ["gfx.render"] });
  for (let i = 0; i < 12; i++) f.run();
  assert.equal(api.export().gpuState.pending, 8); assert.equal(f.queries.length, 8);
  f.gl.disjoint = true; const result = api.export();
  assert.equal(result.gpu.length, 0); assert.equal(result.gpuState.invalidated, 8); assert.ok(f.queries.every(row => row.deleted));
  f.gl.disjoint = false; f.run(); f.queries.at(-1).ready = true; f.gl.afterResult = () => { f.gl.disjoint = true; };
  const second = api.export(); assert.equal(second.gpu.length, 0); assert.equal(second.gpuState.invalidated, 9);
});

test("loss invalidates pending queries; restore reacquires extension; query error recovers via explicit reset", () => {
  const f = fixture(), api = f.install({ gpuEveryFrames: 1, gpuScopes: ["gfx.render"] });
  f.run(); f.gl.lost = true; f.canvas.dispatch("webglcontextlost");
  assert.equal(api.export().gpuState.pending, 0); assert.equal(api.export().gpuState.enabled, false);
  f.gl.lost = false; f.canvas.dispatch("webglcontextrestored");
  assert.equal(f.gl.extensionRequests, 2); f.run(); f.queries.at(-1).ready = true;
  const restored = api.export(); assert.equal(restored.gpu.length, 1); assert.equal(restored.gpu[0].contextEpoch, 2);
  f.run(); f.gl.throwQuery = true; const failed = api.export(); assert.equal(failed.gpuState.enabled, false);
  assert.equal(failed.gpuState.queryErrors, 1); f.gl.throwQuery = false; api.reset(); f.run();
  f.queries.at(-1).ready = true; assert.equal(api.export().gpu.length, 1);
});

test("shadowMap replacement before/after restore and rebuild is observed without retaining old wrappers", () => {
  const f = fixture(), api = f.install({ gpu: false });
  const initialWrapperCount = api.export().environment.activeWrappers;
  const makeShadow = () => ({ enabled: true, render() { f.renderer.renderBufferDirect(f.gfx.camera, f.scene, {}, f.material, {}); } });
  const replace = () => {
    const old = f.renderer.shadowMap, next = makeShadow(), nativeNext = next.render;
    f.renderer.shadowMap = next; return { old, next, nativeNext };
  };
  let prior = f.renderer.shadowMap;
  // Native renderer's restore listener can run either before or after ours.
  for (let i = 0; i < 6; i++) {
    f.gl.lost = true; f.canvas.dispatch("webglcontextlost"); f.gl.lost = false;
    let replacement;
    if (i % 2 === 0) replacement = replace();
    f.canvas.dispatch("webglcontextrestored");
    if (i % 2 !== 0) replacement = replace();
    f.run();
    assert.equal(Object.hasOwn(prior, "render"), true); // Native fake owns its method.
    assert.equal(api.export().environment.activeWrappers, initialWrapperCount);
    // A detached old map must no longer generate diagnostic spans.
    const count = api.export().summaries["shadow.render"].calls;
    prior.render(); assert.equal(api.export().summaries["shadow.render"].calls, count);
    assert.notEqual(replacement.next.render, replacement.nativeNext);
    assert.equal(api.export().spans.filter(row => row.label === "shadow.render").at(-1).counts.draws, 1);
    prior = replacement.next;
  }
  const replacement = replace(); f.gfx._build();
  assert.notEqual(replacement.next.render, replacement.nativeNext, "build catches replacement before another render");
  f.run(); assert.equal(api.export().environment.activeWrappers, initialWrapperCount);
  api.stop(); assert.equal(replacement.next.render, replacement.nativeNext);
});

test("query and CPU scope unwind on exception without swallowing game exception", () => {
  const f = fixture(), failure = Error("native render failed");
  f.renderer.render = () => { throw failure; };
  const api = f.install({ gpuEveryFrames: 1, gpuScopes: ["gfx.render"] });
  assert.throws(f.run, error => error === failure); assert.equal(f.gl.active, null);
  const result = api.export(); assert.equal(result.frames[0].failed, true);
  assert.equal(result.summaries["gfx.render"].failed, 1); api.reset();
});

test("rebuild/createBots instruments fresh objects and releases old wrapper ownership", () => {
  const f = fixture(), oldPass = f.gfx.composer.passes[0], oldFn = oldPass.render;
  const api = f.install({ gpu: false }), wrapperCount = api.export().environment.activeWrappers;
  for (let i = 0; i < 10; i++) { f.gfx._build(); f.GH.debug.match.createBots(); }
  assert.equal(oldPass.render, oldFn); assert.equal(api.export().environment.activeWrappers, wrapperCount);
  f.GH.debug.match.update(); f.run();
  const result = api.export(); assert.equal(result.summaries["bots.update"].inclusiveMS, 7);
  assert.ok(Object.keys(result.summaries).some(key => key.startsWith("composer."))); api.stop();
});

test("trace correlation, worker clock provenance and bounded custom label summaries", () => {
  const f = fixture(), api = f.install({ gpu: false, trace: true, driverTimings: true });
  api.phaseMark("steady"); api.scope("manual", () => { f.gl.linkProgram({}); f.gl.getProgramParameter({}); });
  assert.ok(f.traces.some(row => row[0] === "mark" && row[1] === "gh-renderdev:steady"));
  assert.ok(f.traces.some(row => row[0] === "measure" && row[1] === "gh-renderdev:gl.linkProgram"));
  assert.throws(() => api.recordWorkerTiming({ worker: "nav", durationMS: 1 }), TypeError);
  api.recordWorkerTiming({ worker: "nav", label: "path", startMS: 5, timeOrigin: 2000, durationMS: 3 });
  assert.equal(api.export().workers[0].timeOrigin, 2000);
  for (let i = 0; i < 140; i++) api.scope("label-" + i, () => {});
  const result = api.export(); assert.equal(Object.keys(result.summaries).length, 128); assert.ok(result.summaryOverflow > 0);
  assert.match(result.timingModel.threads, /CDP/); assert.match(result.timingModel.gaps, /getParameters/);
});

test("stop respects later wrappers, and inactive wrappers add no samples beneath them", () => {
  const f = fixture(), api = f.install({ gpu: false }), own = f.gfx.render;
  const later = f.gfx.render = function (...args) { return own.apply(this, args); };
  api.stop(); assert.equal(f.gfx.render, later); const before = api.export().coverage.spans.total;
  f.run(); assert.equal(api.export().coverage.spans.total, before);
  assert.ok(api.export().errors.some(row => row.message.includes("Later wrapper")));
});

test("jitter uses private deterministic state, samples both 30 Hz reflection strata and never consumes Math.random", () => {
  const f = fixture(), api = f.install({ gpuScopes: ["gfx.render", "render.world", "shadow.render", "render.VM", "render.postprocess", "render.reflection"] });
  const originalRandom = Math.random;
  try {
    Math.random = () => { throw Error("sampling must not consume scenario RNG"); };
    for (let i = 0; i < 180; i++) {
      f.gfx.reflection = i % 2 === 0; for (const query of f.queries) query.ready = true; f.run();
    }
  } finally { Math.random = originalRandom; }
  for (const query of f.queries) query.ready = true;
  const result = api.export(), worldSamples = result.gpu.filter(row => row.label === "render.world");
  assert.ok(worldSamples.some(row => row.frameWork.reflectionCalls === 0));
  assert.ok(worldSamples.some(row => row.frameWork.reflectionCalls === 1));
  assert.equal(result.gpuState.jitterFrames, 2);
});

test("actual bundled Three Scene/Camera/Material remain unchanged by observer wrappers", () => {
  const { THREE } = loadBundle(new URL("../game/core/game.js", import.meta.url));
  const f = fixture(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  const material = new THREE.MeshStandardMaterial(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  scene.add(mesh); mesh.position.set(2, 3, 4); scene.updateMatrixWorld();
  f.gfx.scene = scene; f.gfx.camera = camera; f.gfx.preRender = null;
  f.gfx.render = function () { scene.updateMatrixWorld(); this.renderer.render(scene, camera); };
  f.renderer.render = function () { this.renderBufferDirect(camera, scene, mesh.geometry, material, mesh); };
  const snapshot = () => ({ matrix: mesh.matrix.toArray(), world: mesh.matrixWorld.toArray(),
    auto: mesh.matrixAutoUpdate, worldAuto: scene.matrixWorldAutoUpdate, version: material.version, visible: mesh.visible, layers: mesh.layers.mask });
  const before = snapshot(), original = scene.updateMatrixWorld;
  const api = f.install({ gpu: false }); f.run(); assert.deepEqual(snapshot(), before);
  mesh.position.x = 8; f.run(); assert.equal(mesh.matrixWorld.elements[12], 8);
  assert.equal(api.export().spans.find(row => row.label === "render.world").counts.submissions, 1);
  api.stop(); assert.equal(scene.updateMatrixWorld, original); assert.equal(Object.hasOwn(scene, "updateMatrixWorld"), false);
});
