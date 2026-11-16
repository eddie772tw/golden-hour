import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
let nextMaterial = 0;
class Material {
  constructor() {
    Object.assign(this, { uuid: `material-${++nextMaterial}`, id: nextMaterial, version: 0, visible: true, side: 0, shadowSide: null,
      depthTest: true, colorWrite: true, alphaTest: 0, alphaToCoverage: false, alphaHash: false, clipShadows: false, clippingPlanes: null,
      clipIntersection: false, wireframe: false, wireframeLinewidth: 1, linewidth: 1, disposed: 0 });
    this.listeners = new Map();
  }
  onBeforeCompile() {}
  setValues(values) { Object.assign(this, values); }
  copy(other) {
    for (const key of Object.keys(other)) if (!["uuid", "listeners", "disposed"].includes(key)) this[key] = other[key];
    return this;
  }
  clone() { return new this.constructor().copy(this); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  dispose() { this.disposed++; this.listeners.get("dispose")?.({ target: this }); }
}
class Vector {
  constructor(x = 0, y = 0, z = 0, w = 0) { Object.assign(this, { x, y, z, w }); }
  copy(other) { Object.assign(this, other); return this; }
  multiply(other) { this.x *= other.x; this.y *= other.y; return this; }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
}
class Object3D { onBeforeShadow() {} onAfterShadow() {} }
class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    Object.assign(this, { geometry, material, isMesh: true, visible: true, castShadow: true,
      children: [], layers: { test: () => true }, modelViewMatrix: { multiplyMatrices() {} },
      matrixWorld: {}, frustumCulled: false });
  }
}
function fixture() {
  const sandbox = { Ta: Material, T_: 3200, S_: 3201, je: Object3D, jf: class {}, It: Vector, me: Vector,
    Hc: 0, Ua: 1, nn: 2, dM: 1, Zh: 3, Xn: 0, no: 0, lY: "", cY: "",
    We: class extends Material { constructor(options) { super(); this.setValues(options); } },
    ne: class { setAttribute() {} }, Yt: class {}, ae: Mesh,
    Vs: class { constructor(w, h) { this.texture = {}; this.width = w; this.height = h; } dispose() {} },
    console,
  };
  vm.createContext(sandbox);
  const types = source.slice(source.indexOf("K3 = class extends Ta {"), source.indexOf(", Q6 = class extends Ta {"));
  const start = source.indexOf("  function hY(o, t, e) {");
  const end = source.indexOf("  var fY =", start);
  vm.runInContext(`var ${types};\n${source.slice(start, end)};this.ShadowMap=hY;this.Depth=K3;this.Distance=X3`, sandbox);
  const draws = [], properties = new WeakMap(), previous = {}, state = {
    setBlending() {}, setScissorTest() {}, viewport() {},
    buffers: { depth: { getReversed: () => false, setTest() {} }, color: { setClear() {} } },
  };
  const renderer = { state, localClippingEnabled: false, getRenderTarget: () => previous,
    getActiveCubeFace: () => 2, getActiveMipmapLevel: () => 3,
    setRenderTarget(...args) { this.lastTarget = args; }, clear() {},
    properties: { get(m) { if (!properties.has(m)) properties.set(m, {}); return properties.get(m); } },
    renderBufferDirect(camera, scene, geometry, material, object, group) {
      draws.push({ camera, scene, geometry, material, object, group, map: material.map,
        alphaMap: material.alphaMap, side: material.side, alphaTest: material.alphaTest,
        displacementMap: material.displacementMap, clipShadows: material.clipShadows });
    },
  };
  const shadowMap = new sandbox.ShadowMap(renderer, { update: object => object.geometry }, { maxTextureSize: 8192 });
  shadowMap.enabled = true; shadowMap.autoUpdate = false; shadowMap.needsUpdate = true; shadowMap.type = 2;
  const camera = { layers: {} }, shadowCamera = { matrixWorldInverse: {} };
  const light = { name: "sun", shadow: { autoUpdate: true, needsUpdate: false, map: { texture: {} },
    camera: shadowCamera, mapSize: new Vector(4096, 4096), getFrameExtents: () => new Vector(1, 1),
    getViewportCount: () => 1, getViewport: () => new Vector(0, 0, 1, 1), updateMatrices() {},
    getFrustum: () => ({ intersectsObject: object => object.inFrustum !== false }) } };
  const node = (flags = {}, attrs = {}) => Object.assign(new Mesh({ morphAttributes: {}, attributes: {}, groups: [], ...attrs },
    Object.assign(new Material(), { map: {}, alphaMap: null, displacementMap: null, displacementScale: 1, displacementBias: 0 })), flags);
  function render(nodes, lights = [light]) {
    const scene = { visible: true, layers: { test: () => true }, children: nodes };
    shadowMap.needsUpdate = true;
    shadowMap.render(lights, scene, camera);
    return draws.slice(-nodes.length);
  }
  return { sandbox, renderer, shadowMap, light, camera, shadowCamera, draws, properties, previous, node, render };
}

function installActualProgramGate(f) {
  const records = new WeakMap(), programs = new Map(), calls = { parameters: 0 };
  const uniforms = { map: {}, seq: [], setValue() {}, setOptional() {} };
  const ctx = { E: -1, _: null, n0: false, e0: false, S: {}, y: {}, xd: "linear", Q1: 0,
    m0: {}, P: 1, F: 1080, f0: { isScene: true, environment: null },
    H0: { get(material) { if (!records.has(material)) records.set(material, {}); return records.get(material); } },
    Y0: { resetTextureUnits() {} }, ct: { get: () => null }, et: { get: () => null },
    Z0: { useProgram: () => false, buffers: { depth: { getReversed: () => false } } },
    j0: { logarithmicDepthBuffer: false }, k0: { update() {} }, v0: { uniform: {} },
    Y: () => false, Z() {}, st: { refreshMaterialUniforms() {} }, dg: { seqWithValue: () => [], upload() {} },
    g: { state: { lights: { state: { version: 1 } }, shadowsArray: [], transmissionRenderTarget: {} } },
    P0: {
      getParameters(material, _lights, _shadows, _scene, object) {
        calls.parameters++;
        return { outputColorSpace: "linear", skinning: object.isSkinnedMesh === true,
          instancing: object.isInstancedMesh === true, batching: object.isBatchedMesh === true,
          instancingColor: object.isInstancedMesh === true && object.instanceColor !== null,
          instancingMorph: object.isInstancedMesh === true && object.morphTexture !== null,
          vertexAlphas: false, vertexTangents: false, morphTargets: false, morphNormals: false,
          morphColors: false, morphTargetsCount: 0, toneMapping: 0 };
      },
      getProgramCacheKey: p => JSON.stringify([p.skinning, p.instancing, p.instancingColor, p.instancingMorph]),
      getUniforms: () => ({}),
      acquireProgram(parameters, key) {
        if (!programs.has(key)) programs.set(key, { program: {}, getUniforms: () => uniforms });
        return programs.get(key);
      },
    },
  };
  vm.createContext(ctx);
  const start = source.indexOf("      function o0(g0, G0, K0) {", source.indexOf("this.compileAsync"));
  const end = source.indexOf("      function W(g0, G0) {", start);
  vm.runInContext(source.slice(start, end) + ";this.select=D", ctx);
  const draw = f.renderer.renderBufferDirect;
  f.renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    ctx.select(camera, { isScene: true, environment: null }, geometry, material, object);
    return draw.call(this, camera, scene, geometry, material, object, group);
  };
  return calls;
}

test("actual renderer program-change gate stops rebuilding cached parameters when shadow geometry alternates", () => {
  const f = fixture(), calls = installActualProgramGate(f);
  const nodes = [f.node(), f.node({ isSkinnedMesh: true }),
    f.node({ isInstancedMesh: true, instanceColor: null, morphTexture: null })];
  f.render(nodes);
  assert.equal(calls.parameters, 3);
  for (let frame = 0; frame < 3; frame++) f.render(nodes);
  assert.equal(calls.parameters, 3, "per-kind metadata remains current on the actual D -> o0 -> getParameters path");
});

test("actual ShadowMap assigns stable bounded default materials per current geometry feature combination", () => {
  const f = fixture(), plain = f.node(), skin = f.node({ isSkinnedMesh: true }),
    instances = f.node({ isInstancedMesh: true, instanceColor: null, morphTexture: null }),
    colored = f.node({ isInstancedMesh: true, instanceColor: {}, morphTexture: null });
  const first = f.render([plain, skin, instances, colored]).map(d => d.material);
  assert.equal(new Set(first).size, 4, "geometry changes must not thrash one material's currentProgram");
  for (let frame = 0; frame < 3; frame++)
    assert.deepEqual(f.render([plain, skin, instances, colored]).map(d => d.material), first);
  const original = f.render([instances])[0].material;
  instances.instanceColor = {};
  assert.equal(f.render([instances])[0].material, first[3], "read current instanceColor rather than caching by object identity");
  instances.instanceColor = null;
  assert.equal(f.render([instances])[0].material, original);
  instances.morphTexture = {};
  assert.notEqual(f.render([instances])[0].material, original);
  assert.equal(f.light.shadow.mapSize.x, 4096);
  assert.deepEqual(f.renderer.lastTarget, [f.previous, 2, 3]);
});

test("morph attributes/count changes, batched meshes and alpha/clipping/displacement remain on the legacy path", () => {
  const f = fixture(), ordinary = f.node(), original = f.render([ordinary])[0].material;
  const cases = [
    n => { n.geometry.morphAttributes.position = [1]; },
    n => { n.geometry.morphAttributes.normal = [1, 2]; },
    n => { n.geometry.morphAttributes.color = []; },
    n => { n.isBatchedMesh = true; },
    n => { n.material.alphaTest = 0.4; },
    n => { n.material.alphaToCoverage = true; },
    n => { n.material.alphaHash = true; },
    n => { n.material.displacementMap = {}; },
    n => { f.renderer.localClippingEnabled = true; n.material.clipShadows = true; n.material.clippingPlanes = [{}]; },
  ];
  for (const change of cases) {
    const n = f.node(); change(n);
    const draw = f.render([n])[0];
    assert.notEqual(draw.material, original);
    assert.equal(draw.map, n.material.map);
    assert.equal(draw.alphaMap, n.material.alphaMap);
    assert.equal(draw.displacementMap, n.material.displacementMap);
  }
  const morph = f.node({}, { morphAttributes: { position: [1] } });
  const legacy = f.render([morph])[0].material;
  morph.geometry.morphAttributes.position.push(2);
  assert.equal(f.render([morph])[0].material, legacy, "changing morph count must remain renderer-owned");
  delete morph.geometry.morphAttributes.position;
  assert.equal(f.render([morph])[0].material, original);
});

test("custom before/after shadow callbacks see the legacy shared identity and complete texture contract", () => {
  const f = fixture(), seen = [];
  const plain = f.node(), skin = f.node({ isSkinnedMesh: true });
  const before = function (_r, _o, _c, _s, _g, material) { seen.push([material, material.map, material.alphaMap]); };
  plain.onBeforeShadow = skin.onBeforeShadow = before;
  plain.onAfterShadow = skin.onAfterShadow = function (_r, _o, _c, _s, _g, material) { assert.equal(material, seen.at(-1)[0]); };
  plain.material.alphaMap = {};
  const a = f.render([plain])[0];
  f.render([f.node({ isInstancedMesh: true, instanceColor: null, morphTexture: null })]);
  const b = f.render([skin])[0];
  assert.equal(a.material, b.material, "callbacks keep the original shared depth material");
  assert.equal(seen[0][1], plain.material.map);
  assert.equal(seen[0][2], plain.material.alphaMap);
  const custom = new f.sandbox.Depth(); skin.customDepthMaterial = custom;
  assert.equal(f.render([skin])[0].material, custom);
});

test("point-distance and sun-depth slots are independent; light binding and alpha coverage remain intact", () => {
  const f = fixture(), n = f.node({ isSkinnedMesh: true });
  const depth = f.render([n])[0].material;
  const point = { ...f.light, isPointLight: true };
  const distance = f.render([n], [point])[0].material;
  assert.notEqual(depth, distance);
  assert.equal(distance.isMeshDistanceMaterial, true);
  assert.equal(f.properties.get(distance).light, point);
  const otherPoint = { ...point };
  assert.equal(f.render([n], [otherPoint])[0].material, distance);
  assert.equal(f.properties.get(distance).light, otherPoint);
  n.material.alphaToCoverage = true;
  const masked = f.render([n])[0];
  assert.equal(masked.alphaTest, 0.5);
  assert.equal(masked.map, n.material.map);
  const custom = new f.sandbox.Distance(); n.customDistanceMaterial = custom;
  assert.equal(f.render([n], [point])[0].material, custom);
});

test("material groups retain shadow side, masks, displacement and draw ordering", () => {
  const f = fixture(), node = f.node();
  const a = Object.assign(new Material(), { side: 0, map: {}, alphaMap: null });
  const b = Object.assign(new Material(), { side: 2, map: {}, alphaMap: {}, alphaTest: 0.3,
    displacementMap: {}, displacementScale: 0.2, displacementBias: 0.1 });
  node.material = [a, b];
  node.geometry.groups = [{ start: 0, count: 6, materialIndex: 0 }, { start: 6, count: 9, materialIndex: 1 }];
  f.render([node]);
  assert.equal(f.draws.length, 2);
  assert.deepEqual(f.draws.map(d => d.group), node.geometry.groups);
  assert.deepEqual(f.draws.map(d => d.side), [1, 2]);
  assert.equal(f.draws[1].map, b.map);
  assert.equal(f.draws[1].alphaMap, b.alphaMap);
  assert.equal(f.draws[1].alphaTest, 0.3);
  assert.equal(f.draws[1].displacementMap, b.displacementMap);
});

test("geometry identity and flag mutation cannot grow private slots beyond the fixed bit space", () => {
  const f = fixture(), allocated = new Set();
  for (const point of [false, true]) for (let key = 0; key < 16; key++) {
    const n = f.node({ isInstancedMesh: !!(key & 1), isSkinnedMesh: !!(key & 2),
      instanceColor: key & 4 ? {} : null, morphTexture: key & 8 ? {} : null });
    const light = point ? { ...f.light, isPointLight: true } : f.light;
    allocated.add(f.render([n], [light])[0].material);
    assert.equal(f.render([n], [light])[0].material, f.draws.at(-2).material);
  }
  assert.ok(allocated.size <= 32);
  f.shadowMap.dispose();
  assert.ok([...allocated].every(m => m.disposed === 1));
});

test("only the first camera consumes a requested shadow refresh, and caster filtering/order is preserved", () => {
  const f = fixture(), a = f.node(), hidden = f.node({ visible: false }), noCast = f.node({ castShadow: false }),
    culled = f.node({ frustumCulled: true, inFrustum: false }), b = f.node({ isSkinnedMesh: true });
  const nodes = [a, hidden, noCast, culled, b];
  f.render(nodes);
  assert.deepEqual(f.draws.map(d => d.object), [a, b]);
  const scene = { visible: true, layers: { test: () => true }, children: nodes };
  f.shadowMap.render([f.light], scene, { layers: {} });
  assert.equal(f.draws.length, 2, "main camera does not redraw the reflection's completed shadow map");
  assert.equal(f.shadowMap.needsUpdate, false);
});

test("private slots dispose once and can be recreated; lifecycle hooks release before renderer properties", () => {
  const f = fixture(), n = f.node({ isSkinnedMesh: true });
  const mat = f.render([n])[0].material;
  f.shadowMap.dispose(); f.shadowMap.dispose();
  assert.equal(mat.disposed, 1);
  assert.notEqual(f.render([n])[0].material, mat);
  const calls = [], stub = name => ({ dispose() { calls.push(name); } });
  const rendererStart = source.indexOf("      function L0() {");
  const start = source.indexOf("this.dispose = function() {", rendererStart);
  const end = source.indexOf("\n      };", start);
  const ctx = { e: { removeEventListener() {} }, pt() {}, V0() {}, c0() {}, j() {}, s0() {}, l0: { stop() {} },
    ht: { dispose() {}, removeEventListener() {} } };
  for (const name of ["C0", "J0", "q0", "x0", "H0", "et", "ct", "w0", "Q0", "nt", "P0"]) ctx[name] = stub(name);
  vm.runInNewContext(source.slice(start, end + 9), ctx);
  ctx.dispose();
  assert.ok(calls.indexOf("x0") < calls.indexOf("H0"));
  assert.ok(calls.indexOf("x0") < calls.indexOf("P0"));
  const lostStart = source.indexOf("      function pt(g0) {", end);
  const lostEnd = source.indexOf("      function V0()", lostStart);
  const lost = { x0: stub("lost-slots"), M: false, console: { log() {} } };
  vm.runInNewContext(source.slice(lostStart, lostEnd) + ";this.lost=pt", lost);
  lost.lost({ preventDefault() {} });
  assert.equal(lost.M, true);
  assert.equal(calls.at(-1), "lost-slots");
});


test("custom shadow callbacks permanently retain cross-object shared mutations for both kinds and groups", () => {
  for (const callback of ["onBeforeShadow", "onAfterShadow"]) {
    const f = fixture();
    const ordinary = f.node(), point = { ...f.light, isPointLight: true };
    const privateDepth = f.render([ordinary])[0].material;
    const privateDistance = f.render([ordinary], [point])[0].material;
    const custom = f.node();
    custom.material.alphaTest = 0.4;
    const identities = [];
    custom[callback] = (_r, _o, _c, _s, _g, material) => {
      material.depthTest = false; material.colorWrite = false; identities.push(material);
    };
    f.render([custom]);
    custom.material.alphaTest = 0;
    f.render([custom]);
    const legacyDepth = identities.at(-1);
    assert.notEqual(legacyDepth, privateDepth);
    const grouped = f.node({ isSkinnedMesh: true });
    grouped.material = [new Material(), new Material()];
    grouped.geometry.groups = [{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 }];
    f.render([grouped]);
    for (const draw of f.draws.slice(-2)) {
      assert.equal(draw.material, legacyDepth);
      assert.equal(draw.material.depthTest, false);
      assert.equal(draw.material.colorWrite, false);
    }
    f.render([custom], [point]);
    const legacyDistance = identities.at(-1);
    assert.notEqual(legacyDistance, privateDistance);
    const follow = f.render([ordinary], [point])[0].material;
    assert.equal(follow, legacyDistance);
    assert.equal(follow.depthTest, false);
    assert.equal(follow.colorWrite, false);
    delete custom[callback];
    f.shadowMap.dispose();
    assert.equal(privateDepth.disposed, 1);
    assert.equal(privateDistance.disposed, 1);
    assert.equal(f.render([ordinary])[0].material, legacyDepth, "dispose cannot reset legacy material history");
    assert.equal(f.render([ordinary], [point])[0].material, legacyDistance);
  }
});

test("custom depth callbacks disable both kind caches before any eligible object", () => {
  const f = fixture(), custom = f.node(), material = new f.sandbox.Depth();
  custom.customDepthMaterial = material;
  custom.onBeforeShadow = (_r, _o, _c, _s, _g, selected) => assert.equal(selected, material);
  f.render([custom]);
  const regular = f.node(), skin = f.node({ isSkinnedMesh: true });
  assert.equal(f.render([regular])[0].material, f.render([skin])[0].material);
  const point = { ...f.light, isPointLight: true };
  assert.equal(f.render([regular], [point])[0].material, f.render([skin], [point])[0].material);
});
