import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { prepareWarmDrawCoverage, preparedProgramsReady, retainedProgramCompletion } from "../game/client/shader-warmup.js";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
function owners() {
  let calls = 0, state = 12345;
  const math = Object.create(Math);
  math.random = () => { calls++; state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const context = { console, performance, Math: math, URLSearchParams, AbortController, DOMException, URL, TextEncoder, TextDecoder,
    location: { search: "" }, navigator: { userAgent: "offline-test" }, addEventListener() {},
    localStorage: { getItem() { return null; }, setItem() {} },
    document: { addEventListener() {}, createElement() { throw Error("Unexpected DOM in CPU warmup test"); } },
    setTimeout() {}, clearTimeout() {} };
  context.window = context; context.self = context;
  const cutoff = source.lastIndexOf("\n  As0().catch(");
  assert.ok(cutoff > 0);
  vm.runInNewContext(source.slice(0, cutoff) + "\n globalThis.probe={THREE:Ct,Particle:mb,Muzzle:$w};\n})();", context, { timeout: 10000 });
  return { ...context.probe, randomCalls: () => calls };
}

function fixture() {
  const api = owners(), T = api.THREE;
  const atlas = { texture: new T.Texture(), noise: new T.Data3DTexture(new Uint8Array(4), 1, 1, 1), bookUniform: [] };
  const particle = new api.Particle(8, atlas), distortion = new api.Particle(4, atlas, { distort: true });
  const muzzle = new api.Muzzle({ gfx: { fx: { atlas } } }, {});
  const world = new T.Scene(), view = new T.Scene(), hidden = new T.Group();
  hidden.visible = false; view.add(hidden); hidden.add(muzzle.group);
  world.add(particle.mesh, distortion.mesh);
  particle.mesh.visible = false; distortion.mesh.visible = false;
  const pools = [
    { label: "world-particles", mesh: particle.mesh, scene: world },
    { label: "world-distortion", mesh: distortion.mesh, scene: world },
    { label: "view-muzzle", mesh: muzzle.mesh, scene: view },
  ];
  return { api, particle, distortion, muzzle, hidden, pools };
}

test("actual dormant particle/distortion/muzzle layouts are primed without buffer or RNG changes", () => {
  const f = fixture(), beforeCalls = f.api.randomCalls();
  const arrays = [f.particle.gpu, f.distortion.gpu, f.muzzle.aO.array, f.muzzle.aA.array, f.muzzle.aP.array, f.muzzle.aQ.array];
  const bytes = arrays.map(array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("hex"));
  const before = f.pools.map(({ mesh }) => [mesh.visible, mesh.frustumCulled, mesh.geometry.instanceCount]);
  const prepared = prepareWarmDrawCoverage(f.pools);
  assert.deepEqual(prepared.rows.map(row => row.capacity), [8, 4, f.muzzle.aO.count]);
  for (const { mesh } of f.pools) {
    assert.equal(mesh.geometry.instanceCount, 1);
    assert.equal(mesh.visible, true);
    assert.equal(mesh.frustumCulled, false);
  }
  assert.equal(f.hidden.visible, true);
  prepared.restore(); prepared.restore();
  assert.deepEqual(f.pools.map(({ mesh }) => [mesh.visible, mesh.frustumCulled, mesh.geometry.instanceCount]), before);
  assert.equal(f.hidden.visible, false);
  assert.deepEqual(arrays.map(array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("hex")), bytes);
  assert.equal(f.api.randomCalls(), beforeCalls);
});

test("transaction restores after a draw exception and rolls back partial validation failure", () => {
  const f = fixture(), failure = Error("render failed");
  assert.throws(() => {
    const prepared = prepareWarmDrawCoverage(f.pools);
    try { throw failure; } finally { prepared.restore(); }
  }, failure);
  assert.equal(f.particle.geo.instanceCount, 0);
  assert.equal(f.hidden.visible, false);
  assert.throws(() => prepareWarmDrawCoverage([...f.pools, { label: "bad", mesh: {}, scene: f.pools[0].scene }]), /Unrecognized dormant draw/);
  assert.equal(f.particle.geo.instanceCount, 0);
  assert.equal(f.distortion.mesh.visible, false);
  assert.equal(f.hidden.visible, false);
  f.particle.mesh.castShadow = true;
  assert.throws(() => prepareWarmDrawCoverage(f.pools), /Unrecognized dormant draw/);
});

test("active counts are preserved and detached pools fail closed without leaving state", () => {
  const f = fixture(); f.particle.geo.instanceCount = 3;
  const prepared = prepareWarmDrawCoverage(f.pools);
  assert.equal(f.particle.geo.instanceCount, 3); prepared.restore();
  f.muzzle.group.removeFromParent();
  assert.throws(() => prepareWarmDrawCoverage(f.pools), /Detached dormant draw/);
  assert.equal(f.particle.geo.instanceCount, 3);
  assert.equal(f.particle.mesh.visible, false);
});

function compileHarness(candidate) {
  const front = { isReady: () => true }, state = { back: false };
  const back = { isReady: () => state.back }, material = {};
  const properties = { currentProgram: front, programs: new Map([["back", back], ["front", front]]) };
  const context = { performance, setTimeout, M: false, H0: new Map([[material, properties]]),
    GHBoot: { shaderWarmupCandidate: candidate, preparedProgramsReady },
    compile() { return new Set([material]); } };
  context.y = context;
  const start = source.indexOf("this.compileAsync = function(g0, G0, K0 = null)");
  const end = source.indexOf("\n      let V = null;", start);
  assert.ok(start > 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  return { context, state };
}

test("actual compileAsync candidate waits for both retained transparent-side programs", async () => {
  const { context, state } = compileHarness(true);
  let done = false;
  const promise = context.compileAsync({}, {}).then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(done, false);
  state.back = true;
  await promise;
  assert.equal(done, true);
});

test("actual compileAsync default keeps baseline semantics and lost contexts reject", async () => {
  const baseline = compileHarness(false);
  await baseline.context.compileAsync({}, {});
  assert.equal(baseline.state.back, false);
  const candidate = compileHarness(true);
  const promise = candidate.context.compileAsync({}, {});
  candidate.context.M = true;
  await assert.rejects(promise, /context lost/);
});

test("cached readiness report distinguishes retained-program completion from draw or link validation", () => {
  assert.deepEqual(retainedProgramCompletion({ info: { programs: [{ isReady: () => true }, { isReady: () => false }] } }),
    { retained: 2, complete: 1, allComplete: false, completionOnly: true });
  assert.equal(retainedProgramCompletion({ info: { programs: [] } }).allComplete, false);
});

test("core restores primed pools before visible output and the existing draw fence", () => {
  const warm = source.slice(source.indexOf("n.preparation = globalThis.GHBoot.createRenderPreparation"), source.indexOf("    n.prepare = (reason, change)"));
  assert.ok(warm.indexOf("prepareWarmDrawCoverage") < warm.indexOf("await VC(r, i, a, target)"));
  assert.ok(warm.indexOf("warmCoverage?.restore()") < warm.indexOf("n.composer.renderToScreen = toScreen"));
  assert.ok(warm.indexOf("n.composer.renderToScreen = toScreen") < warm.indexOf("await globalThis.GHBoot.waitForDraw(r)"));
  assert.equal(warm.match(/warmCoverage\?\.restore\(\)/g).length, 2);
});
