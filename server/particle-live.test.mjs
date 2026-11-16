import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
const vector = () => ({ x: 0, y: 0, z: 0,
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }, normalize() { return this; } });
const color = { set() { return this; }, setRGB() { return this; } };
const globals = { at: (a, b) => (a + b) / 2, Wd: vector(), Tw: color, Sw: {}, DD: 9.81 };
function actualMethod(signature) {
  const start = source.indexOf(`    ${signature} {`, source.indexOf("_w = class {"));
  const end = source.indexOf("\n    }", start);
  assert.ok(start >= 0 && end > start, signature);
  return vm.runInNewContext(`(function ${source.slice(start + 4, end + 6)})`, globals);
}
const debris = actualMethod("debris(t, e, s, n, i, a, r, l, c = 5)");
const casing = actualMethod("casing(t, e, s)");
const simulate = actualMethod("_simSingles(t, e, s, n)");

function fixture(N) {
  const pool = { N, i: 0, live: 0 };
  for (const key of ["x", "v", "s", "ax"]) pool[key] = new Float32Array(N * 3);
  for (const key of ["ang", "w", "life"]) pool[key] = new Float32Array(N);
  for (const key of ["st", "b", "kind"]) pool[key] = new Uint8Array(N);
  const mesh = { retired: [], instanceColor: {}, instanceMatrix: {}, setColorAt() {},
    setMatrixAt(slot, matrix) { this.retired.push([slot, matrix]); } };
  const owner = { chunks: pool, cases: pool, chunkMesh: mesh, caseMesh: mesh,
    world: { overlap: () => false } };
  return { pool, mesh, owner };
}

for (const [kind, N] of [["cases", 90], ["chunks", 320]]) {
  test(`actual ${kind} ring overflow preserves occupancy and reaches live=0 after expiry`, () => {
    const { pool, mesh, owner } = fixture(N);
    const spawn = serial => kind === "cases"
      ? casing.call(owner, { x: serial, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, serial % 3)
      : debris.call(owner, serial, 1, 0, 0, 0, 0, 1, color, 5);
    for (let serial = 0; serial < N; serial++) spawn(serial);
    assert.equal(pool.live, N);
    pool.st[0] = 2; // A settled slot still occupies the ring.
    const count = N * 3 + 7;
    for (let serial = N; serial < count; serial++) {
      spawn(serial);
      assert.equal(pool.live, N, `overwrite ${serial}`);
    }
    assert.equal(pool.i, count % N, "cursor keeps the existing overwrite order");
    assert.equal(pool.x[((count - 1) % N) * 3], count - 1, "latest spawn replaces the same slot");
    assert.equal(pool.life[(count - 1) % N], kind === "cases" ? 9 : 4.75, "lifetimes remain unchanged");
    simulate.call(owner, pool, mesh, 20, kind === "cases");
    assert.equal(pool.live, 0);
    assert.ok(pool.st.every(state => state === 0));
    assert.equal(mesh.retired.length, N, "each occupied slot retires once");
    Object.defineProperty(owner, "world", { configurable: true, get() { throw Error("empty pool scanned"); } });
    assert.doesNotThrow(() => simulate.call(owner, pool, mesh, 1, kind === "cases"));
    assert.equal(mesh.retired.length, N, "empty pool does not rewrite matrices");
    Object.defineProperty(owner, "world", { value: { overlap: () => false } });
    spawn(count);
    assert.equal(pool.live, 1, "an empty slot increments occupancy again");
    pool.x[((count) % N) * 3 + 1] = -50;
    simulate.call(owner, pool, mesh, 0.1, kind === "cases");
    assert.equal(pool.live, 0, "falling out of the world also retires once");
  });
}
