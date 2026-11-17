import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadBundle } from "./fixtures/bundle-probe.mjs";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
let materials = 0;
class Material {
  constructor(options = {}) {
    Object.assign(this, { id: ++materials, side: 0, forceSinglePass: false, version: 0, envMap: null,
      visible: true, transparent: false, disposed: 0 }, options);
  }
  copy(other) {
    for (const key of Object.keys(other)) if (!["id", "version", "disposed"].includes(key)) this[key] = other[key];
    return this;
  }
  clone() { return new this.constructor().copy(this); }
  onBeforeCompile() {}
  onBeforeRender() {}
  customProgramCacheKey() { return this.onBeforeCompile.toString(); }
  set needsUpdate(value) { if (value) this.version++; }
  dispose() { this.disposed++; }
}
class Attribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; this.updateRanges = []; }
  setUsage() { return this; }
  onUploadCallback() {}
  onUpload(callback) { this.onUploadCallback = callback; return this; }
  clearUpdateRanges() { this.updateRanges.length = 0; }
}
class Geometry {
  constructor() { this.attributes = {}; this.disposed = 0; }
  setAttribute(name, value) { this.attributes[name] = value; return this; }
  dispose() { this.disposed++; }
  computeBoundingSphere() {}
}
class Plane extends Geometry {
  constructor() {
    super();
    this.setAttribute("position", new Attribute(new Float32Array([-0.5,-0.5,0,0.5,-0.5,0,0.5,0.5,0,-0.5,0.5,0]), 3));
  }
}
class Mesh {
  constructor(geometry, material) {
    Object.assign(this, { geometry, material, visible: true, layers: { set() {} },
      modelViewMatrix: { multiplyMatrices() {} }, normalMatrix: { getNormalMatrix() {} } });
  }
  onBeforeRender() {}
  onAfterRender() {}
}
class Instances extends Mesh {
  constructor(...args) { super(...args); this.instanceMatrix = {}; }
  setMatrixAt() {}
}
function fixture(three = null) {
  const ctx = { $e: Material, nn: 2, ne: Geometry, Ge: Plane, Yt: Attribute, ae: Mesh, ia: Instances,
    ww: 16, Uc: 1, LD: new Int32Array(6), f$: {}, Math, Number };
  if (three) Object.assign(ctx, { ne: three.BufferGeometry, Yt: three.BufferAttribute });
  vm.createContext(ctx);
  const rngStart = source.indexOf("  function Re(o = 1) {");
  const rngEnd = source.indexOf("  var at =", rngStart);
  const materialStart = source.indexOf("  function d$() {");
  const materialEnd = source.indexOf("  var Ew =", materialStart);
  const classStart = source.indexOf("Ew = class {");
  const classEnd = source.indexOf("}, LD =", classStart) + 1;
  vm.runInContext(source.slice(rngStart, rngEnd) + source.slice(materialStart, materialEnd) +
    `var ${source.slice(classStart, classEnd)};this.Glass=Ew`, ctx);
  const scene = { children: [], add(mesh) { this.children.push(mesh); }, remove(mesh) { this.children = this.children.filter(n => n !== mesh); } };
  const glass = new ctx.Glass(scene, { addCollider: () => ({}) }, {});
  glass._paneMatrix = () => ({});
  glass.build();
  const pane = (id, axis = "z", w = 1, h = 1, cell = 0.5) => {
    const p = glass.addPane({ axis, pos: 2.25, a0: 0, a1: w, y0: 0, y1: h, cell });
    p.id = id;
    return p;
  };
  return { ctx, glass, scene, pane };
}

test("fractured static panes keep every surviving triangle inside their initial Three bounding sphere", () => {
  const three = loadBundle(new URL("../game/core/game.js", import.meta.url)).THREE;
  const { glass, pane } = fixture(three), v = new three.Vector3();
  glass._spawnShard = () => {}; // Falling shards have a separate mesh and do not deform this pane.
  for (const axis of ["x", "z"]) {
    const p = pane(glass.panes.length, axis, 6, 4);
    p.a0 = 100; p.a1 = 106; p.y0 = 20; p.y1 = 24;
    glass._fracture(p);
    const sphere = p.mesh.geometry.boundingSphere;
    assert.equal(p.mesh.frustumCulled, true);
    assert.ok(sphere && Number.isFinite(sphere.radius));
    const positions = p.mesh.geometry.attributes.position.array;
    const check = () => {
      for (let j = 0; j < positions.length; j += 9) {
        if (positions.slice(j, j + 9).every(x => x === 0)) continue; // Deleted zero-area triangles cannot rasterize.
        for (let k = j; k < j + 9; k += 3)
          assert.ok(v.fromArray(positions, k).distanceTo(sphere.center) <= sphere.radius + 1e-5);
      }
    };
    check();
    for (let cell = 0; cell < p.alive.length - 1; cell++) { glass._breakCell(p, cell, 0, 0, 0, 0); check(); }
  }
});

test("actual pane proof rejects mixed winding/nonplanar/nonfinite triangles and tolerates deleted cells", () => {
  const { glass } = fixture();
  const plane = new Float32Array([0,0,2,1,0,2,0,1,2, 1,0,2,1,1,2,0,1,2]);
  assert.equal(glass._singlePaneProof(plane, 2), true);
  const reversed = plane.slice(); reversed.set(plane.slice(15,18), 9); reversed.set(plane.slice(9,12), 15);
  assert.equal(glass._singlePaneProof(reversed, 2), false);
  const warped = plane.slice(); warped[5] += 0.01;
  assert.equal(glass._singlePaneProof(warped, 2), false);
  const anotherPlane = plane.slice(); for (let i = 11; i < 18; i += 3) anotherPlane[i] = 3;
  assert.equal(glass._singlePaneProof(anotherPlane, 2), false);
  const invalid = plane.slice(); invalid[0] = NaN;
  assert.equal(glass._singlePaneProof(invalid, 2), false);
  plane.fill(0, 0, 9);
  assert.equal(glass._singlePaneProof(plane, 2), true);
  assert.equal(glass._singlePaneProof(new Float32Array(18), 2), false);
});

test("actual Ew fracture assigns only proved panes to one cached material; intact/shards/reset stay unchanged", () => {
  const { glass, pane } = fixture(), sourceMaterial = glass.material;
  for (const axis of ["z", "x"]) {
    const p = pane(glass.panes.length, axis);
    glass._fracture(p);
    assert.notEqual(p.mesh.material, sourceMaterial);
    assert.equal(p.mesh.material, glass._singlePaneMaterial);
    assert.equal(p.mesh.material.forceSinglePass, true);
    assert.equal(p.mesh.material.side, 2);
    assert.equal(p.mesh.material.onBeforeCompile, sourceMaterial.onBeforeCompile);
    assert.equal(p.mesh.material.customProgramCacheKey(), sourceMaterial.customProgramCacheKey());
  }
  assert.equal(glass.intact.material, sourceMaterial);
  assert.equal(glass.shards.material, sourceMaterial);
  assert.equal(sourceMaterial.forceSinglePass, false);
  const cached = glass._singlePaneMaterial, geometries = glass.panes.map(p => p.mesh.geometry);
  glass.reset();
  assert.equal(glass._singlePaneMaterial, cached, "reset retains the warmed program owner");
  assert.equal(cached.disposed, 0);
  assert.ok(geometries.every(g => g.disposed === 1));
});

test("actual material sync copies environment/uniform properties and compile hooks without cloning per pane", () => {
  const { glass } = fixture();
  const cached = glass._paneMaterial();
  const env = {}; glass.material.envMap = env; glass.material.envMapIntensity = 1.25;
  glass.material.opacity = 0.18;
  const hook = () => {}; glass.material.onBeforeCompile = hook;
  const oldVersion = cached.version;
  assert.equal(glass._syncPaneMaterial(), cached);
  assert.equal(cached.envMap, env);
  assert.equal(cached.envMapIntensity, 1.25);
  assert.equal(cached.opacity, 0.18);
  assert.equal(cached.onBeforeCompile, hook);
  assert.equal(cached.customProgramCacheKey(), hook.toString());
  assert.equal(cached.forceSinglePass, true);
  assert.ok(cached.version > oldVersion);
  const probe = glass._preparePaneMaterial();
  assert.equal(probe.material, cached);
  assert.equal(probe.geometry.attributes.crack.count, 4);
  assert.equal(probe.frustumCulled, false);
});

test("actual q draw order has one zero-fragment side for proved panes, and single-pass avoids version bumps", () => {
  const { glass, pane } = fixture(), p = pane(0);
  glass._fracture(p);
  const start = source.indexOf("      function q(g0, G0, K0, it, ft, gt) {");
  const end = source.indexOf("      function o0(g0, G0, K0) {", start);
  const captures = [];
  let view = 1;
  const y = { renderBufferDirect(_c, _s, geometry, material) {
    const xyz = geometry.attributes.position.array;
    for (let i = 0; i < xyz.length; i += 9) {
      const area = ((xyz[i+3]-xyz[i])*(xyz[i+7]-xyz[i+1])-(xyz[i+4]-xyz[i+1])*(xyz[i+6]-xyz[i])) * view;
      if (area !== 0 && (material.side === 2 || (material.side === 0 ? area > 0 : area < 0))) captures.push(i);
    }
  } };
  const ctx = vm.createContext({ y, nn: 2, Ua: 1, Hc: 0 });
  vm.runInContext(source.slice(start, end) + ";this.draw=q", ctx);
  for (view of [1, -1]) {
    captures.length = 0;
    ctx.draw(p.mesh, {}, { matrixWorldInverse: {} }, p.mesh.geometry, glass.material, null);
    const original = [...captures];
    captures.length = 0;
    const version = glass._singlePaneMaterial.version;
    ctx.draw(p.mesh, {}, { matrixWorldInverse: {} }, p.mesh.geometry, glass._singlePaneMaterial, null);
    assert.deepEqual(captures, original, "fragment candidate/index order is unchanged for both camera sides");
    assert.equal(glass._singlePaneMaterial.version, version);
  }
  assert.equal(glass.material.version, 4);
});

test("actual deterministic fracture geometry keeps the safe subset conditional", t => {
  const { glass, pane, scene } = fixture();
  let eligible = 0, rejected = 0;
  for (let id = 0; id < 32; id++) {
    const p = pane(id, id % 2 ? "x" : "z", 4, 3, 0.2);
    glass._fracture(p);
    const safe = glass._singlePaneProof(p.mesh.geometry.attributes.position.array, p.axis);
    assert.equal(p.mesh.material === glass._singlePaneMaterial, safe);
    safe ? eligible++ : rejected++;
    scene.remove(p.mesh); p.mesh.geometry.dispose();
  }
  assert.equal(eligible + rejected, 32);
  assert.ok(eligible > 0);
  t.diagnostic(`Representative 32 seeded 4m x 3m grids: eligible=${eligible}, rejected=${rejected}`);
  // This is a representative grid/seed probe, not the actual hotel's pane ratio.
});

test("actual environment restore updates both materials before captures and syncs the final env map", async () => {
  const { glass } = fixture();
  const oldMap = {};
  glass.material.envMap = oldMap;
  const cached = glass._paneMaterial(), captures = [], env = [{}, {}];
  let cube = 0;
  const ctx = { d: glass, c: { marbleFloor: {}, oakFloor: {}, kitchenFloor: {}, exterior: {}, poolTile: {} },
    n: { vmScene: {} }, i: {}, a: {}, r: { shadowMap: {} }, Je: {}, Yn: 1,
    GHBoot: { policy: { cubeSize: 4 } },
    bm: class { constructor() { this.texture = {}; } dispose() {} },
    xm: class {
      constructor() { this.children = []; this.position = { set() {} }; }
      update() { captures.push([glass.material.envMap, cached.envMap]); }
    },
    ou: class {
      fromScene() { return { texture: { empty: true }, dispose() {} }; }
      fromCubemap() { return { texture: env[cube++], dispose() {} }; }
      dispose() {}
    },
    zr: class {}, VC: async () => {},
  };
  vm.createContext(ctx);
  const start = source.indexOf("    n.restoreEnvironment = async () => {");
  const end = source.indexOf("    await n.restoreEnvironment();", start);
  vm.runInContext(source.slice(start, end), ctx);
  await ctx.n.restoreEnvironment();
  assert.equal(captures.length, 2);
  assert.ok(captures.every(([a, b]) => a === b && a.empty), "neither capture can sample the old clone's GPU environment");
  assert.equal(glass.material.envMap, env[1]);
  assert.equal(cached.envMap, env[1]);
  assert.equal(cached.envMapIntensity, 1.25);
  assert.equal(cached.forceSinglePass, true);
});


test("actual hotel's 124 metadata records retain deterministic strict eligibility and original mesh scopes", t => {
  const rows = JSON.parse(readFileSync(new URL("./fixtures/hotel-panes.json", import.meta.url), "utf8"));
  const { glass, scene } = fixture(), rejected = [];
  let eligible = 0, eligibleTriangles = 0, totalTriangles = 0;
  assert.equal(rows.length, 124);
  for (const row of rows) {
    // Preserve actual cell counts: several hotel panes do not use cell=0.2.
    const p = { ...row, alive: null, mesh: null, count: row.nx * row.ny, total: row.nx * row.ny, col: { off: false } };
    glass.panes.push(p); glass._fracture(p);
    const positions = p.mesh.geometry.attributes.position.array;
    const safe = glass._singlePaneProof(positions, p.axis);
    assert.equal(p.mesh.material === glass._singlePaneMaterial, safe);
    totalTriangles += positions.length / 9;
    if (safe) { eligible++; eligibleTriangles += positions.length / 9; }
    else rejected.push(p.id);
    scene.remove(p.mesh); p.mesh.geometry.dispose();
  }
  assert.equal(eligible, 113);
  assert.deepEqual(rejected, [68, 70, 71, 83, 91, 107, 109, 113, 118, 119, 121]);
  assert.equal(eligibleTriangles, 18624);
  assert.equal(totalTriangles, 21544);
  assert.equal(glass.intact.material, glass.material);
  assert.equal(glass.shards.material, glass.material);
  t.diagnostic(`Actual hotel metadata + actual Ew/Re: ${eligible}/124 eligible; triangles=${eligibleTriangles}/${totalTriangles}`);
});
