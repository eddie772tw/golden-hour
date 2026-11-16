import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
const start = source.indexOf("    render(t) {", source.indexOf("BM = class {"));
const end = source.indexOf("\n    }", start);
assert.ok(start >= 0 && end > start);
const render = vm.runInNewContext(`(function ${source.slice(start + 4, end + 6)})`);

function fixture(auto = true) {
  const object = { position: 7, matrixWorld: 0 };
  const passes = [];
  const scene = {
    matrixWorldAutoUpdate: auto, updates: 0,
    updateMatrixWorld() { this.updates++; object.matrixWorld = object.position; },
  };
  const vmScene = { matrixWorldAutoUpdate: true, updates: 0, updateMatrixWorld() { this.updates++; } };
  // Three's renderer checks this flag before calling the scene root updater.
  // Keep fake draw work independent of the actual BM.render method under test.
  const draw = (label, target = scene) => {
    if (target.matrixWorldAutoUpdate === true) target.updateMatrixWorld();
    passes.push({ label, matrixWorld: object.matrixWorld });
  };
  const gfx = {
    scene, vmScene, time: 0, q: { refl: 0.5, reflectionHz: 30 },
    uniforms: { uTime: {}, uAuto: {} },
    renderer: { info: { reset() {} }, shadowMap: {} },
    fx: { mirrored: false, mirror(value) { this.mirrored = value; } },
    _motion() {}, camera: { position: { distanceToSquared() { return 0; } } },
    _lastCam: { copy() {} }, exposure: { auto: 1 }, rayK: 0, bloom: {}, rays: null,
    preRender() { draw("reflection"); },
    composer: { render() {
      for (const label of ["world", "ao-normal", "fx-layer2", "distortion"]) draw(label);
      draw("VM", vmScene); draw("VM-velocity", vmScene);
    } },
  };
  return { gfx, scene, vmScene, object, passes };
}

test("actual BM.render updates dynamic world matrices before all passes, once per frame", () => {
  const c = fixture();
  render.call(c.gfx, 1 / 60);
  assert.equal(c.scene.updates, 1);
  assert.ok(c.passes.every(pass => pass.matrixWorld === 7));
  assert.deepEqual(c.passes.map(pass => pass.label), ["reflection", "world", "ao-normal", "fx-layer2", "distortion", "VM", "VM-velocity"]);
  assert.equal(c.scene.matrixWorldAutoUpdate, true);
  assert.equal(c.vmScene.matrixWorldAutoUpdate, true);
  assert.equal(c.vmScene.updates, 2, "VM update policy is unchanged");
  c.object.position = 13;
  c.passes.length = 0;
  render.call(c.gfx, 1 / 60);
  assert.equal(c.scene.updates, 2, "next frame's dynamic changes must be propagated");
  assert.ok(c.passes.every(pass => pass.matrixWorld === 13));
});

test("actual BM.render preserves a caller-owned matrixWorldAutoUpdate=false policy", () => {
  const c = fixture(false);
  c.object.matrixWorld = 91;
  render.call(c.gfx, 1 / 60);
  assert.equal(c.scene.updates, 0);
  assert.equal(c.scene.matrixWorldAutoUpdate, false);
  assert.ok(c.passes.every(pass => pass.matrixWorld === 91));
});

test("actual BM.render restores the original flag when update/reflection/composer throws", () => {
  for (const stage of ["update", "reflection", "composer"]) {
    const c = fixture();
    const fail = () => { throw Error(stage); };
    if (stage === "update") c.scene.updateMatrixWorld = fail;
    if (stage === "reflection") c.gfx.preRender = fail;
    if (stage === "composer") c.gfx.composer.render = fail;
    assert.throws(() => render.call(c.gfx, 1 / 60), new RegExp(stage));
    assert.equal(c.scene.matrixWorldAutoUpdate, true, stage);
    assert.equal(c.gfx.fx.mirrored, false, "reflection cleanup remains active");
  }
  const c = fixture(false);
  c.gfx.composer.render = () => { throw Error("failed"); };
  assert.throws(() => render.call(c.gfx, 1 / 60), /failed/);
  assert.equal(c.scene.matrixWorldAutoUpdate, false);
});

test("actual BM.render leaves matrices untouched while preparation blocks rendering", () => {
  const c = fixture();
  c.gfx.preparation = { pending: true, error: null };
  render.call(c.gfx, 1 / 60);
  assert.equal(c.scene.updates, 0);
  assert.equal(c.passes.length, 0);
  assert.equal(c.scene.matrixWorldAutoUpdate, true);
  c.gfx._warming = true;
  render.call(c.gfx, 1 / 60);
  assert.equal(c.scene.updates, 1, "the controlled warm draw uses the same matrix scope");
  assert.equal(c.scene.matrixWorldAutoUpdate, true);
});
