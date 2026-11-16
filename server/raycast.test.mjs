import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
// Execute the shipped implementation without initializing WebGL or a DOM.
const worldClass = source.match(/\bMw = (class \{[\s\S]*?\n  \});/)[1];
const World = vm.runInNewContext(`(${worldClass})`, { Gd: 4, Nr: 1e-4 });

// Frozen pre-optimization oracle from e3f040c, including its edge-case arithmetic.
function linearRaycast(t, e, s, n, i, a, r, l, c = false) {
  Math.abs(n) < 1e-9 && (n = 1e-9), Math.abs(i) < 1e-9 && (i = 1e-9), Math.abs(a) < 1e-9 && (a = 1e-9);
  let h = 1 / n, f = 1 / i, u = 1 / a, d = this.cols, m = r, p = null, x = 0;
  for (let g = 0, b = d.length; g < b; g++) {
    let v = d[g];
    if (v.off || v.noRay || v.pane || c && v.water) continue;
    let y = (v.x0 - t) * h, M = (v.x1 - t) * h, w = y < M ? y : M, T = y < M ? M : y, S = 0;
    y = (v.y0 - e) * f, M = (v.y1 - e) * f;
    let E = y < M ? y : M, _ = y < M ? M : y;
    E > w && (w = E, S = 1), _ < T && (T = _), !(w > T) && (y = (v.z0 - s) * u, M = (v.z1 - s) * u, E = y < M ? y : M, _ = y < M ? M : y, E > w && (w = E, S = 2), _ < T && (T = _), !(w > T || w < 0 || w >= m) && (m = w, p = v, x = S));
  }
  return p ? (l && (l.t = m, l.col = p, l.nx = x === 0 ? n > 0 ? -1 : 1 : 0, l.ny = x === 1 ? i > 0 ? -1 : 1 : 0, l.nz = x === 2 ? a > 0 ? -1 : 1 : 0), true) : false;
}

function compare(world, ray) {
  const args = ray.slice(0, 7), ignoreWater = ray[7] ?? false;
  const actual = { untouched: true }, expected = { untouched: true };
  assert.equal(world.raycast(...args, actual, ignoreWater), linearRaycast.call(world, ...args, expected, ignoreWater));
  assert.deepEqual(actual, expected);
  assert.equal(world.raycast(...args, null, ignoreWater), linearRaycast.call(world, ...args, null, ignoreWater));
}

function fill(world, count = 80) {
  for (let j = 0; j < count; j++) world.addCollider(100 + j, -1, 100, 100.5 + j, 1, 101);
  return world;
}

test("closest hits preserve insertion and slab-axis ties despite grid order", () => {
  const world = new World();
  const first = world.addCollider(2, -1, 2, 3, 1, 3);
  const second = world.addCollider(-2, -1, 2, 3, 1, 3);
  fill(world);
  const out = {};
  assert.ok(world.raycast(-2, 0, -2, 1, 0, 1, 10, out));
  assert.ok(world._rayQ.indexOf(second) < world._rayQ.indexOf(first));
  assert.equal(out.col, first);
  assert.deepEqual([out.t, out.nx, out.ny, out.nz], [4, -1, 0, 0]);
  compare(world, [-2, 0, -2, 1, 0, 1, 10]);
});

test("flags, live toggles, new colliders, exact endpoints and degenerate rays match linear oracle", () => {
  const world = fill(new World());
  const flags = [{ off: true }, { noRay: true }, { pane: {} }, { water: true }, { noMove: true }, {}];
  const cols = flags.map((flag, j) => world.addCollider(1 + j, -1, -1, 1.1 + j, 1, 1, "test", flag));
  for (const ignore of [false, true]) compare(world, [0, 0, 0, 1, 0, 0, 20, ignore]);
  for (const col of cols) {
    col.off = !col.off;
    for (const ignore of [false, true]) compare(world, [0, 0, 0, 1, 0, 0, 20, ignore]);
  }
  world.addCollider(-1, 2, -1, 1, 3, 1);
  for (const ray of [
    [0, 0, 0, 0, 1, 0, 2], [0, 0, 0, 0, 1, 0, 2.00001],
    [0, 2.5, 0, 0, 1, 0, 10], [0, 2, 0, 0, 1, 0, 10],
    [0, 0, 0, 0, 0, 0, 1], [0, 0, 0, -1e-12, 1, -1e-12, 10],
    [0, 0, 0, 2, 0, 0, 10], [0, 0, 0, 1, 0, 0, 0], [0, 0, 0, 1, 0, 0, -1],
    [4, 0, 4, -1, 0, -1, 8], [-4, 0, -4, 1, 1, 1, 8],
  ]) compare(world, ray);
  for (const length of [0, 0.00001, 0.01, 0.02, 0.03, 10]) {
    const a = { x: 0, y: 0, z: 0 }, b = { x: length, y: 0, z: 0 };
    const expected = length < 1e-4 || !linearRaycast.call(world, 0, 0, 0, 1, 0, 0, length - 0.02, null, true);
    assert.equal(world.clear(a, b), expected);
  }
});

test("grid cell cap and fallback are bounded; query scratch never aliases movement", () => {
  const world = fill(new World());
  world.addCollider(1, -1, 1, 2, 1, 2);
  const retained = world.query(-4, -4, 8, 8), before = Array.from(retained);
  const original = world.query;
  let calls = 0;
  world.query = function (...args) {
    calls++;
    const [x0, z0, x1, z1, scratch] = args;
    const cells = (Math.floor(x1 / 4) - Math.floor(x0 / 4) + 1) * (Math.floor(z1 / 4) - Math.floor(z0 / 4) + 1);
    assert.ok(cells <= Math.max(1, Math.min(64, Math.floor(this.cols.length / 4))));
    assert.equal(scratch, this._rayQ);
    assert.notEqual(scratch, this._q);
    return original.apply(this, args);
  };
  compare(world, [0.5, 0, 1.5, 1, 0, 0, 3]);
  assert.equal(calls, 2);
  assert.deepEqual(Array.from(retained), before);
  for (const ray of [
    [0, 0, 0, 1, 0, 1, 300], [0, 0, 0, 1, 0, 0, Infinity],
    [NaN, 0, 0, 1, 0, 0, 1], [0, Infinity, 0, 1, 0, 0, 1],
    [0, 0, 0, Infinity, 0, 0, 1], [0, 0, 0, 1, 0, 0, NaN],
    [1e100, 0, 1e100, 1, 0, 1, 1],
  ]) compare(world, ray);
  assert.equal(calls, 2, "large/nonfinite rays retain the linear path");
});

test("boolean rays stop at the first qualifying collider", () => {
  const world = new World();
  world.addCollider(1, -1, 1, 2, 1, 2);
  const later = world.addCollider(4, -1, 4, 5, 1, 5);
  let visits = 0;
  Object.defineProperty(later, "off", { get() { visits++; return false; } });
  assert.equal(world.raycast(0, 0, 0, 1, 0, 1, 300, null), true);
  assert.equal(visits, 0);
  assert.equal(world.raycast(0, 0, 0, 1, 0, 1, 300, {}), true);
  assert.equal(visits, 1);
});

test("seeded captured-map rays have zero differences from the original implementation", () => {
  // Existing extract_world.py capture; fixture flags omit panes/water, covered above.
  const map = JSON.parse(readFileSync(new URL("./world.json", import.meta.url), "utf8"));
  const world = new World();
  for (const col of map.colliders) world.addCollider(...col.min, ...col.max, "map", { noRay: col.noRay, noMove: col.noMove });
  let seed = 0x4a17c9;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let queries = 0;
  const query = world.query;
  world.query = function (...args) { queries++; return query.apply(this, args); };
  for (let j = 0; j < 12000; j++) {
    const x = random() * 76 - 38, y = random() * 14 - 3, z = random() * 62 - 28;
    let dx = random() * 2 - 1, dy = random() * 2 - 1, dz = random() * 2 - 1;
    if (j % 7 === 0) dx = 0;
    if (j % 11 === 0) dz = -1e-12;
    const norm = Math.hypot(dx, dy, dz) || 1;
    compare(world, [x, y, z, dx / norm, dy / norm, dz / norm, [0.14, 0.78, 2.6, 8, 60, 140, 260, 300][j % 8], !!(j % 2)]);
  }
  assert.ok(queries > 0 && queries < 24000, "exercise both indexed and fallback paths");
});

test("particle matrix uploads occur only after real writes, including clears", () => {
  const method = source.slice(source.indexOf("    _simSingles(t, e, s, n) {"), source.indexOf("    wake(t) {", source.indexOf("    _simSingles(t, e, s, n) {")));
  const vector = () => ({ set() { return this; } });
  const clear = {};
  const Particle = vm.runInNewContext(`(class {${method}})`, {
    DD: 9.81, Sw: clear, xr: vector(), pu: vector(), Vc: vector(), X9: vector(),
    Sg: { setFromAxisAngle() { return this; } }, K9: { compose() { return {}; } },
  });
  const physics = new Particle();
  physics.world = { overlap() { return null; } };
  const pool = (state, life, y = 2) => ({
    N: 1, live: state ? 1 : 0, st: [state], life: [life], x: [0, y, 0], v: [0, 0, 0],
    s: [.1, .1, .1], ax: [1, 0, 0], w: [0], ang: [0], b: [0], kind: [0],
  });
  for (const [name, data, writes] of [
    ["empty", pool(0, 5), 0], ["settled", pool(2, 5), 0],
    ["moving", pool(1, 5), 1], ["fading", pool(2, .5), 1],
    ["expired", pool(2, .001), 1], ["out of world", pool(1, 5, -50), 1],
  ]) {
    const matrices = [], mesh = { instanceMatrix: { needsUpdate: false }, setMatrixAt(slot, value) { matrices.push([slot, value]); } };
    physics._simSingles(data, mesh, .016, true);
    assert.equal(matrices.length, writes, name);
    assert.equal(mesh.instanceMatrix.needsUpdate, !!writes, name);
    if (name === "expired" || name === "out of world") {
      assert.equal(matrices[0][1], clear, name);
      assert.equal(data.live, 0, name);
    }
  }
});
