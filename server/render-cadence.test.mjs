import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");

// Execute the owning bundle code: fixtures replace GPU/game work, not scheduling.
function method(owner, signature, globals = {}) {
  const ownerAt = source.indexOf(owner);
  assert.ok(ownerAt >= 0, owner);
  const start = source.indexOf(`    ${signature} {`, ownerAt);
  assert.ok(start >= ownerAt, signature);
  const end = source.indexOf("\n    }", start);
  return vm.runInNewContext(`(function ${source.slice(start + 4, end + 6)})`, globals);
}

function gfx() {
  return {
    time: 0, q: { refl: 0.5, reflectionHz: 30 }, uniformCalls: 0,
    scene: { matrixWorldAutoUpdate: true, updateMatrixWorld() {} },
    uniforms: { uTime: {}, uAuto: {} }, renderer: { info: { reset() {} }, shadowMap: {} },
    fx: { mirrored: false, mirror(on) { this.mirrored = on; } },
    _motion() {}, camera: { position: { distanceToSquared() { return 0; } } },
    _lastCam: { copy() {} }, exposure: { auto: 1 }, rayK: 0,
    bloom: {}, rays: null, composer: { render() {} },
    preRender() { this.uniformCalls++; },
  };
}

const render = method("BM = class {", "render(t)");
test("actual renderer caps High reflections at 30 Hz and refreshes immediately after invalidation", () => {
  const presetsAt = source.indexOf("var c9 = ") + "var c9 = ".length;
  const presets = vm.runInNewContext(`(${source.slice(presetsAt, source.indexOf(", OM =", presetsAt))})`);
  for (const quality of ["high", "ultra"]) {
    const c = gfx();
    c.quality = quality;
    c.q = presets[quality];
    for (let i = 0; i < 120; i++) render.call(c, 1 / 60);
    assert.equal(c.uniformCalls, 60, quality);
    c._reflectAt = null;
    render.call(c, 1 / 240);
    assert.equal(c.uniformCalls, 61);
    assert.equal(c.fx.mirrored, false);
  }
  for (const refl of [0, 0.5]) {
    const c = gfx();
    c.q = { refl, reflectionHz: 0 };
    render.call(c, 1);
    assert.equal(c.uniformCalls, 0);
  }
});

test("actual renderer restores FX mirror mode if the complete preRender chain throws", () => {
  const c = gfx();
  c.preRender = () => { throw Error("reflection failed"); };
  assert.throws(() => render.call(c, 1 / 60), /reflection failed/);
  assert.equal(c.fx.mirrored, false);
  assert.equal(c._reflectAt, undefined, "failed update must be retried");
});

test("actual resize invalidates the reflection before onQuality replaces its target", () => {
  const c = gfx();
  c._reflectAt = 1;
  c._measure = () => ({ x: 1920, y: 1080 });
  c.fx.releaseTargets = () => {};
  c.composer.setSize = () => {};
  c.uniforms.uRes = { value: { set() {} } };
  c.vmCamera = {};
  for (const camera of [c.camera, c.vmCamera]) camera.updateProjectionMatrix = () => {};
  c.onQuality = () => assert.equal(c._reflectAt, null);
  c._resize = method("BM = class {", "_resize()", { innerWidth: 1920, innerHeight: 1080 });
  method("BM = class {", "resize()", { innerWidth: 1920, innerHeight: 1080 }).call(c);
});

test("actual QM reflection restores target/subresource, texture and visibility after a failed draw", () => {
  const chain = () => new Proxy({ x: 1, y: 1, z: 1, w: 1, elements: Array(16).fill(1), normal: { x: 1, y: 1, z: 1 } }, {
    get(target, key) { return key === Symbol.toPrimitive ? () => 1 : key in target ? target[key] : () => proxy; },
  });
  // Independent chain objects are unnecessary here: only state rollback is under test.
  const proxy = chain();
  const camera = { position: proxy, up: proxy, projectionMatrix: proxy, projectionMatrixInverse: proxy,
    matrixWorldInverse: proxy, matrixWorld: proxy, lookAt() {}, updateMatrixWorld() {}, near: 0.1, far: 100 };
  const globals = Object.fromEntries(["yg", "QL", "ZM", "M9", "JL", "tD", "bb", "ru", "xb"].map(key => [key, proxy]));
  const objects = [{ visible: true }, { visible: false }];
  const oldTarget = {}, oldTexture = {};
  const c = { enabled: true, rt: {}, camera, vcam: camera, planeY: 0,
    uni: { tRefl: { value: oldTexture }, uReflMat: { value: proxy } }, hide: objects, scene: {} };
  let target = oldTarget, restored;
  const renderer = {
    getRenderTarget: () => target, getActiveCubeFace: () => 3, getActiveMipmapLevel: () => 2,
    setRenderTarget(value, face, level) { target = value; restored = [face, level]; }, clear() {},
    render() {
      assert.equal(c.uni.tRefl.value, null);
      assert.ok(objects.every(object => !object.visible));
      throw Error("GPU draw failed");
    },
  };
  assert.throws(() => method("QM = class {", "render(t)", globals).call(c, renderer), /GPU draw failed/);
  assert.equal(target, oldTarget);
  assert.deepEqual(restored, [3, 2]);
  assert.equal(c.uni.tRefl.value, oldTexture);
  assert.deepEqual(objects.map(object => object.visible), [true, false]);
});

test("actual bloom disposal releases the high-pass material along with existing resources", () => {
  const c = { renderTargetsHorizontal: [], renderTargetsVertical: [], separableBlurMaterials: [] };
  const disposed = [];
  for (const key of ["renderTargetBright", "materialHighPassFilter", "compositeMaterial", "blendMaterial", "_basic", "_fsQuad"])
    c[key] = { dispose() { disposed.push(key); } };
  method("mg = class o extends Dr {", "dispose()").call(c);
  assert.ok(disposed.includes("materialHighPassFilter"));
  assert.equal(disposed.length, 6);
});
