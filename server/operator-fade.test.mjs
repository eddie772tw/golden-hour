import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRenderPreparation } from "../game/client/render-preparation.js";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
const shaderContext = vm.createContext({});
vm.runInContext(source.slice(source.indexOf("  function Wk(o) {"), source.indexOf("  var qk =")) +
  source.slice(source.indexOf("  function WN(o) {"), source.indexOf("  var ba =")) +
  ";this.WN=WN;this.Wk=Wk", shaderContext);
const method = signature => {
  const start = source.indexOf(`    ${signature} {`, source.indexOf("oC = class {"));
  const end = source.indexOf("\n    }", start);
  assert.ok(start >= 0 && end > start, signature);
  return vm.runInNewContext(`(function ${source.slice(start + 4, end + 6)})`, {
    WN: shaderContext.WN, Zt: (n, low, high) => Math.max(low, Math.min(high, n)),
  });
};
const prepareFade = method("_prepareFade()");
const setOpacity = method("setOpacity(t)");
const restoreGun = method("_restoreGunMaterials()");
const dispose = method("dispose()");

function material() {
  return shaderContext.Wk({ transparent: false, depthWrite: true, opacity: 1, disposed: 0,
    map: {}, normalMap: {}, defines: { CHARACTER: 1 }, userData: { fill: {}, rim: {} },
    clone() {
      return { ...this, defines: { ...this.defines }, userData: { ...this.userData }, disposed: 0 };
    },
    dispose() { this.disposed++; },
  });
}
function rig(solid = material()) {
  let traversals = 0;
  return { _mat: solid, _fadeMat: null, _opacity: 1,
    body: { material: solid, skeleton: { dispose() {} } }, root: { visible: false, parent: null },
    gun: { root: { traverse() { traversals++; throw Error("body fade must not clone gun materials"); } } },
    get gunTraversals() { return traversals; },
    _prepareFade: prepareFade, setOpacity, _restoreGunMaterials: restoreGun, dispose,
  };
}

test("actual WN/body preparation preserves shader hooks, resources and original state without gun clones", () => {
  const actor = rig(), original = actor.body.material;
  const restore = actor._prepareFade();
  const fade = actor._fadeMat;
  assert.equal(actor.body.material, fade);
  assert.equal(fade.transparent, true);
  assert.equal(fade.depthWrite, true);
  assert.equal(fade.opacity, 0.5);
  assert.equal(fade.customProgramCacheKey(), "gh-operator-5");
  assert.equal(fade.map, original.map);
  assert.equal(fade.normalMap, original.normalMap);
  assert.equal(fade.userData.fill, original.userData.fill);
  assert.equal(fade.userData.rim, original.userData.rim);
  assert.deepEqual(fade.defines, original.defines);
  const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <aomap_fragment>" };
  fade.onBeforeCompile(shader);
  assert.equal(shader.uniforms.ghFill, original.userData.fill);
  assert.match(shader.vertexShader, /vAux = aux/);
  assert.match(shader.fragmentShader, /ghCharacterFill/);
  restore();
  assert.equal(actor.body.material, original);
  assert.equal(actor._opacity, 1);
  assert.equal(actor.root.visible, false);
  assert.equal(fade.opacity, 1);
  assert.equal(fade.disposed, 0, "cached material must retain its warmed program");
  assert.equal(actor.gunTraversals, 0);
  actor.gun = null; // Actual bot.die() drops the gun before the corpse's fade.
  actor.setOpacity(0.4);
  assert.equal(actor.body.material, fade, "later fade uses the existing cache");
  actor.setOpacity(1);
  assert.equal(fade.disposed, 0);
  actor.dispose();
  assert.equal(fade.disposed, 1, "the original rig disposal owns the retained cache");
  assert.equal(original.disposed, 0);
});

test("an already fading body restores its exact material and opacity after the warm probe", () => {
  const actor = rig();
  actor.gun = null;
  actor.setOpacity(0.23);
  const original = actor.body.material;
  actor.root.visible = true;
  const restore = actor._prepareFade();
  restore();
  assert.equal(actor.body.material, original);
  assert.equal(original.opacity, 0.23);
  assert.equal(actor._opacity, 0.23);
  assert.equal(actor.root.visible, true);
});

// Execute Three's actual cache-key and acquire/release code. GL compilation is
// replaced here; real driver keys/timings remain the browser A/B's responsibility.
test("a non-representative WN clone reuses the program retained by the representative", () => {
  const start = source.indexOf("    function g(E) {", source.indexOf("function jX(o)"));
  const end = source.indexOf("    function T(E) {", start);
  const text = source.slice(start, end);
  const removeUniforms = text.slice(0, text.indexOf("    function y(E) {")) + text.slice(text.indexOf("    function M(E, _) {"));
  const cache = vm.createContext({ o: { outputColorSpace: "srgb" }, h: [], i: {},
    r: { mask: 0, disableAll() { this.mask = 0; }, enable(n) { this.mask |= 1 << n; } },
    $X: function (_renderer, key) { this.cacheKey = key; this.usedTimes = 1; this.destroyed = false;
      this.destroy = () => { this.destroyed = true; }; },
  });
  vm.runInContext(removeUniforms + ";this.key=g;this.acquire=M;this.release=w", cache);
  const solid = material(), representative = rig(solid), other = rig(solid);
  representative._prepareFade()();
  other.gun = null;
  other.setOpacity(0.9);
  const params = m => ({ shaderID: "physical", isRawShaderMaterial: false, defines: m.defines,
    customProgramCacheKey: m.customProgramCacheKey(), opaque: !m.transparent,
    vertexColors: true, skinning: true, shadowMapEnabled: true, shadowMapType: 2,
    numDirLights: 1, numPointLights: 4, numDirLightShadows: 1,
    mapUv: "uv", normalMapUv: "uv", outputColorSpace: "srgb-linear" });
  const key = cache.key(params(representative._fadeMat));
  assert.equal(cache.key(params(other._fadeMat)), key);
  assert.notEqual(cache.key(params(solid)), key, "solid and nonopaque require different programs");
  const pinned = cache.acquire(params(representative._fadeMat), key);
  assert.equal(cache.acquire(params(other._fadeMat), key), pinned);
  cache.release(pinned);
  assert.equal(pinned.destroyed, false, "the representative still holds one reference");
  assert.equal(cache.acquire(params(other._fadeMat), key), pinned);
  assert.notEqual(cache.key({ ...params(other._fadeMat), numPointLights: 8 }), key);
  assert.notEqual(cache.key({ ...params(other._fadeMat), shadowMapType: 1 }), key);
});

function warmFixture(failAt, fadeCompilation) {
  const mats = [material(), material()], actors = mats.flatMap(m => [rig(m), rig(m)]);
  const draws = [], compiles = [], targets = [], probes = [], previousTarget = {};
  let fail = failAt;
  const vec = () => ({ y: 1.7, clone() { return { ...this }; }, copy(other) { Object.assign(this, other); return this; } });
  const scene = { overrideMaterial: null, background: {}, remove(mesh) { mesh.removed = true; } };
  const camera = { position: vec(), quaternion: vec(), layers: { mask: 3 }, updateMatrixWorld() {} };
  const gfx = { vmPass: { enabled: false }, vmScene: { overrideMaterial: null, background: {} },
    vmCamera: { layers: { mask: 1 } }, time: 7, uniforms: { uTime: { value: 7 } },
    composer: { renderToScreen: true }, snapExposure() {}, warmRoots: new Set(),
    render() {
      const fading = actors.filter(r => r.body.material.transparent);
      draws.push({ count: fading.length, screen: this.composer.renderToScreen, materials: fading.map(r => r.body.material), probeVisible: probes.at(-1)?.visible });
      if (fading.length && fail === "draw") throw Error("fade draw failed");
      if (fading.length && fail === "shader") renderer.debug.onShaderError();
    },
  };
  const renderer = { debug: { onShaderError: null }, shadowMap: {}, autoClear: true,
    getContext: () => ({ isContextLost: () => false }), getRenderTarget: () => previousTarget,
    setRenderTarget(value) { this.target = value; }, getClearColor(value) { return value; },
    getClearAlpha: () => 1, setClearColor() {},
  };
  const context = { n: gfx, i: scene, a: camera, r: renderer,
    d: { _preparePaneMaterial() {
      const probe = { visible: true, geometry: { disposed: 0, dispose() { this.disposed++; } } };
      probes.push(probe);
      return probe;
    } },
    b: { bots: [{ rigs: actors }], k9: { rigs: () => [] } }, E: { guns: {} }, A: {},
    C: { shown: 0, _weapon() {}, _show() {} }, G: { getDelta() {} }, ghNextFrame: 0, e0: 0, p0: 0,
    Vs: class { constructor() { targets.push(this); } dispose() { this.disposed = true; } }, Yn: 1,
    Dt: class { clone() { return this; } }, performance,
    GHBoot: { createRenderPreparation, stats: {}, finishShaders: async () => {}, waitForDraw: async () => {
      assert.equal(probes.at(-1).visible, false, "pane probe is hidden before the real screen draw");
      assert.equal(probes.at(-1).geometry.disposed, 0, "GPU fence precedes temporary geometry disposal");
    } },
    async VC(renderer, targetScene, targetCamera, target) {
      const count = actors.filter(r => r.body.material.transparent).length;
      compiles.push({ count, renderer, scene: targetScene, camera: targetCamera, target });
      if (count && fail === "compile") throw Error("fade compile failed");
      if (count) await fadeCompilation;
    },
    Rs0() { if (actors.some(r => r.body.material.transparent) && fail === "upload") throw Error("fade upload failed"); },
  };
  vm.createContext(context);
  const start = source.indexOf("    n.preparation = globalThis.GHBoot.createRenderPreparation(");
  const end = source.indexOf("    n.prepare =", start);
  vm.runInContext(source.slice(start, end), context);
  return { gfx, actors, draws, compiles, targets, probes, renderer, previousTarget, scene, camera,
    recover() { fail = null; } };
}

test("actual prepare warms only two body representatives offscreen on every quality/context preparation", async () => {
  const f = warmFixture();
  for (const reason of ["startup", "quality", "context-restore"]) {
    f.draws.length = 0;
    await f.gfx.preparation.request(reason);
    assert.deepEqual(f.draws.map(d => [d.count, d.screen]), [[0, false], [2, false], [0, true]]);
    assert.equal(f.actors.filter(r => r._fadeMat).length, 2);
    assert.ok(f.compiles.some(c => c.count === 2 && c.renderer === f.renderer && c.scene === f.scene && c.camera === f.camera));
    assert.ok(f.actors.every(r => r.body.material === r._mat && r._opacity === 1 && !r.root.visible));
    assert.ok(f.actors.every(r => r.gunTraversals === 0));
    assert.ok(f.actors.filter(r => r._fadeMat).every(r => r._fadeMat.disposed === 0));
    assert.equal(f.draws.at(-1).probeVisible, false);
    assert.ok(f.probes.every(p => p.removed && p.geometry.disposed === 1));
  }
});

test("actual prepare restores body/material/target/pass state and blocks ready when fade compile/draw fails", async () => {
  for (const stage of ["compile", "upload", "draw", "shader"]) {
    const f = warmFixture(stage);
    f.gfx.preparation.request("startup");
    await assert.rejects(f.gfx.preparation.wait(), stage === "shader" ? /Shader linking failed/ : new RegExp(`fade ${stage} failed`));
    assert.ok(f.gfx.preparation.error);
    assert.ok(f.actors.every(r => r.body.material === r._mat && !r.root.visible && r._opacity === 1));
    assert.equal(f.gfx.composer.renderToScreen, true);
    assert.equal(f.gfx._warming, false);
    assert.equal(f.renderer.target, f.previousTarget);
    assert.ok(f.targets.every(t => t.disposed));
    assert.ok(f.probes.every(p => p.removed && p.geometry.disposed === 1));
    assert.ok(f.actors.filter(r => r._fadeMat).every(r => r._fadeMat.disposed === 0));
    f.recover();
    await f.gfx.preparation.request("retry");
    assert.equal(f.gfx.preparation.error, null);
  }
});

test("a context loss while fade compilation is pending restores state without releasing readiness", async () => {
  const compiling = Promise.withResolvers();
  const f = warmFixture(null, compiling.promise);
  f.gfx.preparation.request("startup");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.actors.filter(r => r.body.material.transparent).length, 2);
  assert.equal(f.gfx._warming, false, "regular rendering cannot bypass the gate during async compilation");
  f.gfx.preparation.invalidate(Error("context lost"));
  compiling.resolve();
  await assert.rejects(f.gfx.preparation.wait(), /context lost/);
  assert.ok(f.actors.every(r => r.body.material === r._mat && !r.root.visible && r._opacity === 1));
  assert.equal(f.gfx.composer.renderToScreen, true);
  assert.equal(f.gfx._warming, false);
  assert.equal(f.renderer.target, f.previousTarget);
  assert.ok(f.probes.every(p => p.removed && p.geometry.disposed === 1));
});
