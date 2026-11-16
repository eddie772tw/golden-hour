import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
// Stop the bundled Three initializers after the light-state factory, before game startup.
const end = source.indexOf("  var lY =", source.indexOf("  function rY(o)"));
assert.ok(end > 0);
const { three, createStore } = vm.runInNewContext(
  source.slice(0, end) + "return {three:Ct, createStore:rY}; })()", { AbortController }
);
// Exercise the actual renderer selection, including the opt-in and layer masks.
const selection = source.match(/g = q0\.get\(g0, v\.length\), g\.init\([^\n]*?\), v\.push\(g\)/);
assert.ok(selection);
const enter = vm.runInNewContext(`(q0, g0, G0, v) => { let g; ${selection[0]}; return g; }`);

function draw(store, scene, camera, lights, stack = []) {
  const state = enter(store, scene, camera, stack);
  for (const light of lights) {
    if (!light.layers.test(camera.layers)) continue;
    light.updateMatrixWorld();
    light.target?.updateMatrixWorld();
    state.pushLight(light);
    if (light.castShadow) state.pushShadow(light);
  }
  camera.updateMatrixWorld();
  state.setupLights();
  state.setupLightsView(camera);
  stack.pop();
  return state.state.lights.state;
}

test("FX and distortion preserve the world light layout across camera changes", () => {
  const store = createStore({});
  const scene = new three.Scene();
  scene.ghSeparateFxLights = true;
  const main = new three.PerspectiveCamera();
  main.layers.enable(1);
  const mirror = main.clone();
  mirror.position.set(10, 0, 0);
  const sun = new three.DirectionalLight();
  sun.position.set(0, 4, 0);
  sun.castShadow = true;
  const point = new three.PointLight();
  point.position.set(3, 2, 1);
  const spot = new three.SpotLight();
  spot.position.set(0, 0, 5);
  const lights = [sun, point, spot];
  const world = draw(store, scene, main, lights);
  const version = world.version;
  assert.deepEqual(Array.from(world.point[0].position.toArray()), [3, 2, 1]);
  assert.deepEqual(Array.from(world.directional[0].direction.toArray()), [0, 1, 0]);
  assert.equal(world.directionalShadowMap.length, 1);
  for (const layer of [2, 3]) {
    main.layers.set(layer);
    const effects = draw(store, scene, main, lights);
    assert.notEqual(effects, world);
    assert.equal(effects.point.length + effects.spot.length + effects.directional.length, 0);
  }
  const reflected = draw(store, scene, mirror, lights);
  assert.equal(reflected, world);
  assert.equal(reflected.version, version);
  assert.deepEqual(Array.from(reflected.point[0].position.toArray()), [-7, 2, 1]);
  assert.deepEqual(Array.from(reflected.spot[0].position.toArray()), [-10, 0, 5]);
  assert.deepEqual(Array.from(reflected.spot[0].direction.toArray()), [0, 0, 1]);
  point.intensity = 2;
  draw(store, scene, mirror, lights);
  assert.equal(world.point[0].color.r, 2);
  assert.equal(world.version, version);
  draw(store, scene, mirror, [sun, spot]);
  assert.notEqual(world.version, version);
  assert.equal(world.point.length, 0);
  const reduced = world.version;
  draw(store, scene, mirror, lights);
  assert.equal(world.point.length, 1);
  assert.notEqual(world.version, reduced);
});

test("ordinary scenes, nested render depth and dispose retain separate ownership", () => {
  const store = createStore({});
  const scene = new three.Scene(), camera = new three.PerspectiveCamera();
  const point = new three.PointLight();
  const world = draw(store, scene, camera, [point]);
  const version = world.version;
  camera.layers.set(2);
  assert.equal(draw(store, scene, camera, [point]), world);
  assert.notEqual(world.version, version);
  const outer = store.get(scene);
  const targets = outer.state.transmissionRenderTarget;
  scene.ghSeparateFxLights = true;
  const fx = draw(store, scene, camera, []);
  assert.notEqual(fx, world);
  assert.equal(outer.state.transmissionRenderTarget, targets);
  assert.notEqual(draw(store, scene, camera, [], [outer]), fx);
  assert.notEqual(draw(store, new three.Scene(), camera, []), fx);
  store.dispose();
  assert.notEqual(draw(store, scene, camera, []), fx);
});
