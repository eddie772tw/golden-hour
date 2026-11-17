import test from "node:test";
import assert from "node:assert/strict";
import { installPassOwnerCensus } from "../game/client/pass-owner-census.js";

function fixture() {
  let time = 0; const native = [], pos = new Float32Array(27), bones = new Float32Array(64);
  const mesh = { isMesh: true, isSkinnedMesh: true, geometry: { attributes: { position: { array: pos } } }, skeleton: { boneMatrices: bones } };
  const shards = { isMesh: true, geometry: { attributes: { position: { array: new Float32Array(90) } } } };
  const scene = {}, camera = { layers: { mask: 3 } }, vmScene = {};
  const gl = { TRIANGLES: 4, bufferSubData(...args) { native.push(["buffer", ...args]); time += 2; },
    bufferData(...args) { native.push(["data", ...args]); }, texSubImage2D(...args) { native.push(["texture", ...args]); },
    useProgram() {}, drawElements(...args) { native.push(["draw", ...args]); } };
  const renderer = { getContext: () => gl,
    renderBufferDirect(c, s, geometry, material, object) {
      assert.equal(this, renderer);
      const api = globalThis.__ghOwnerCensus, row = api?.currentRow ?? -1;
      api?.select(); const start = api?.parameters(row); time += 3; api?.parameterEnd(row, start); api?.list();
      gl.useProgram({}); gl.drawElements(4, 9, 5123, 0); return 77;
    },
    shadowMap: { render() { renderer.renderBufferDirect(camera, scene, mesh.geometry, {}, mesh); } },
    render(s, c) {
      gl.bufferSubData(34962, 0, shards.geometry.attributes.position.array, 9, 18);
      gl.texSubImage2D(3553, 0, 0, 0, 4, 4, 6408, 5126, bones);
      this.shadowMap.render(); this.renderBufferDirect(c, s, mesh.geometry, {}, mesh);
    } };
  const rig = { body: mesh, root: { traverse(fn) { fn(mesh); } }, setWeapon() { return 5; } };
  const gfx = { renderer, scene, camera, vmScene, preRender() {}, render() { renderer.render(scene, camera); return 99; } };
  const cases = { isMesh: true, instanceMatrix: { array: new Float32Array(16) } };
  const GH = { ready: true, G: { state: "playing" }, benchmark: { tick: 1 }, debug: { gfx, glass: { shards }, physics: { caseMesh: cases }, match: { bots: [{ rigs: [rig] }] } } };
  return { GH, gfx, gl, renderer, mesh, shards, native, install: () => installPassOwnerCensus(GH, { sampleEvery: 1, performance: { now: () => time++ } }) };
}

test("census preserves native calls and attributes actual draws, metadata and pre-queue uploads by pass and owner", () => {
  const f = fixture(), original = f.gfx.render, oldHook = globalThis.__ghOwnerCensus;
  const api = f.install();
  assert.equal(f.gfx.render(), 99);
  const e = api.export(), body = e.table.find(r => r.pass === "world" && r.owner === "actor.body"), shadow = e.table.find(r => r.pass === "shadow" && r.owner === "actor.body"), glass = e.table.find(r => r.pass === "world" && r.owner === "glass.shards");
  assert.equal(e.frames, 1); assert.equal(body.draws, 1); assert.equal(body.triangles, 3);
  assert.equal(body.parameters, 1); assert.equal(body.uniformLists, 1); assert.equal(body.programBinds, 1);
  assert.equal(body.Dcalls, 1); assert.equal(body.parameterTimed, 1); assert.ok(body.parameterWallMS > 0);
  assert.equal(body.textureBytes, 256); assert.equal(shadow.draws, 1); assert.equal(glass.bufferBytes, 72);
  assert.deepEqual(f.native.filter(r => r[0] === "draw").map(r => r.slice(1)), [[4,9,5123,0],[4,9,5123,0]]);
  f.GH.G.state = "paused"; f.gfx.render(); assert.equal(api.export().frames, 1);
  f.GH.G.state = "playing"; f.GH.benchmark.tick = 3600; f.gfx.render(); assert.equal(api.export().frames, 1);
  api.stop(); assert.equal(f.gfx.render, original); assert.equal(globalThis.__ghOwnerCensus, oldHook);
  f.gfx.render(); assert.equal(api.export().frames, 1);
});

test("zero length means remaining upload elements; allocation bytes and callback throws remain distinct", () => {
  const f = fixture();
  f.renderer.render = function () {
    f.gl.bufferSubData(34962, 0, f.shards.geometry.attributes.position.array, 9, 0);
    f.gl.bufferSubData(34962, 0, new DataView(new ArrayBuffer(20)), 3, 0);
    f.gl.bufferData(34962, 128, 35048);
    throw Error("native failure");
  };
  const api = f.install(); assert.throws(() => f.gfx.render(), /native failure/);
  const e = api.export(), glass = e.table.find(r => r.owner === "glass.shards"), other = e.table.find(r => r.owner === "unclassified");
  assert.equal(glass.bufferBytes, 324); assert.equal(other.bufferBytes, 17); assert.equal(other.allocationBytes, 128);
  assert.equal(api.currentRow, -1); api.stop();
});

test("standalone instance arrays retain their owner and cross-owner geometry arrays are explicitly shared", () => {
  const f = fixture();
  f.GH.debug.world = { meshes: [{ isMesh: true, geometry: f.mesh.geometry }] };
  f.renderer.render = function () {
    f.gl.bufferSubData(34962, 0, f.GH.debug.physics.caseMesh.instanceMatrix.array);
    f.gl.bufferData(34962, f.mesh.geometry.attributes.position.array, 35048, 3, 6);
  };
  const api = f.install(); f.gfx.render();
  const rows = api.export().table;
  assert.equal(rows.find(r => r.owner === "physics.casing").bufferBytes, 64);
  assert.equal(rows.find(r => r.owner === "shared.arrays").bufferBytes, 24);
  assert.ok(rows.every(r => Object.values(r).every(v => typeof v !== "number" || Number.isFinite(v))));
  api.stop();
});
