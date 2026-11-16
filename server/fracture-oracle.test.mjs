import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadBundle } from './fixtures/bundle-probe.mjs';
const { THREE: T } = loadBundle(new URL('../game/core/game.js', import.meta.url));
const source = readFileSync(new URL('../scripts/performance/fracture_oracle.js', import.meta.url), 'utf8');
function fixture({ mismatch = false, noise = false, occluded = false, throwRead = false, refreshError = false, refreshThrow = false, resetError = false } = {}) {
  const original = new T.MeshStandardMaterial({ transparent: true, side: T.DoubleSide }), single = original.clone(); single.forceSinglePass = true;
  const mesh = new T.Mesh(new T.PlaneGeometry(2, 2).translate(0, 2, 0), single), scene = new T.Scene(); scene.add(mesh);
  const camera = new T.PerspectiveCamera(60, 1, .1, 100); camera.position.set(4, 3, 6); camera.lookAt(0, 2, 0); camera.updateMatrixWorld();
  const pane = { id: 4, mesh, axis: 2, pos: 0, a0: -1, a1: 1, y0: 1, y1: 3 };
  const target = value => ({ texture: { value }, clone() { return target(0); }, dispose() { this.disposed = true; } });
  const e0 = target(17), e1 = target(21), meter = { e0, e1, reset: false, enabled: true, adapt: { uniforms: {} }, down: { uniforms: {} } };
  let current = null, drawImage = {}, renderCount = 0, error = 0, nativeCacheValid = true, resetCalls = 0, nativeCacheRebuilds = 0;
  const modeCounts = { A: 0, B: 0 };
  const gl = { NO_ERROR: 0, TEXTURE0: 1000, DRAW_BUFFER0: 2000, NONE: 0, drawingBufferWidth: 16, drawingBufferHeight: 16,
    _active: 1000, isContextLost: () => false, getError() { const previous = error; error = 0; return previous; },
    readPixels(_x, _y, _w, _h, _format, _type, bytes) {
      if (throwRead) throw Error('mock readback failed');
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4, contribution = !occluded && !drawImage.hidden && x > 3 && x < 13 && y > 3 && y < 13 ? 3 : 0;
        bytes[i] = 20 + x + contribution + (mismatch && drawImage.mode === 'B' ? 2 : 0) + (noise ? drawImage.ordinal % 2 : 0);
        bytes[i + 1] = 20 + y; bytes[i + 2] = 35; bytes[i + 3] = 255;
      }
    },
  };
  for (const name of ['PIXEL_PACK_BUFFER', 'PACK_ALIGNMENT', 'PACK_ROW_LENGTH', 'PACK_SKIP_ROWS', 'PACK_SKIP_PIXELS', 'RGBA', 'UNSIGNED_BYTE']) gl[name] = name;
  gl.bindBuffer = gl.pixelStorei = () => {};
  const renderer = { autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: false, toneMappingExposure: 1.3,
    shadowMap: { needsUpdate: false }, info: { render: { calls: 77 }, autoReset: false },
    getContext: () => gl, getRenderTarget: () => current, setRenderTarget(value) { current = value; }, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    getClearColor: color => color.setRGB(.1, .2, .3), getClearAlpha: () => .5, setClearColor() {},
    getViewport: value => value.copy(new T.Vector4(0, 0, 16, 16)), getScissor: value => value.copy(new T.Vector4(0, 0, 16, 16)), getScissorTest: () => false,
    setViewport() {}, setScissor() {}, setScissorTest() {},
    resetState() { resetCalls++; nativeCacheValid = false; current = null; if (resetError) error = 1282; }, initRenderTarget() {},
    copyTextureToTexture(from, to) { to.value = from.value; }, renderBufferDirect() {},
  };
  const nativeDirect = renderer.renderBufferDirect;
  const g = { renderer, scene, vmScene: new T.Scene(), camera, vmCamera: new T.PerspectiveCamera(), quality: 'high', preparation: {}, q: {},
    meter, composer: { readBuffer: {}, writeBuffer: {}, renderToScreen: true }, _passes: [], uniforms: { uTime: { value: 42 } },
    time: 10, _reflectAt: 9, _shadowAt: 9, _hasPrev: true, _blurK: 2, _turn: 3,
    _lastCam: new T.Vector3(1, 2, 3), _prevQ: new T.Quaternion(), _reproj: new T.Matrix4(), snapExposure() { meter.reset = true; },
    render() {
      if (!nativeCacheValid) { nativeCacheRebuilds++; nativeCacheValid = true; }
      if (resetCalls && refreshThrow) throw Error('mock native refresh failed');
      if (resetCalls && refreshError) error = 1282;
      renderCount++; renderer.info.render.calls++; renderer.toneMappingExposure = 4;
      const mode = mesh.material === original ? 'A' : 'B'; modeCounts[mode]++;
      drawImage = { hidden: !mesh.visible, mode, ordinal: modeCounts[mode] };
      if (mesh.visible) {
        renderer.renderBufferDirect(camera, scene, mesh.geometry, mesh.material, mesh);
        if (mesh.material === original) { original.version += 2; renderer.renderBufferDirect(camera, scene, mesh.geometry, mesh.material, mesh); }
      }
      const temp = meter.e0; meter.e0 = meter.e1; meter.e1 = temp; meter.e0.texture.value++;
    },
  };
  const ctx = { GH: { debug: { gfx: g, glass: { panes: [pane], material: original, _singlePaneMaterial: single, _singlePaneProof: () => true }, stats: () => ({ state: 'paused' }) } } };
  vm.runInNewContext(source, ctx);
  const beforeCamera = camera.position.toArray(), beforeProjection = camera.projectionMatrix.toArray();
  const verifyRestore = () => {
    assert.deepEqual(camera.position.toArray(), beforeCamera); assert.deepEqual(camera.projectionMatrix.toArray(), beforeProjection);
    assert.equal(mesh.material, single); assert.equal(mesh.visible, true); assert.equal(renderer.renderBufferDirect, nativeDirect);
    assert.equal(meter.e0, e0); assert.equal(meter.e1, e1); assert.equal(e0.texture.value, 17); assert.equal(e1.texture.value, 21);
    assert.equal(renderer.toneMappingExposure, 1.3); assert.equal(renderer.info.render.calls, 77); assert.equal(g.time, 10);
  };
  return { api: ctx.__fractureOracle, verifyRestore, original, renderer, g, mesh, renderCount: () => renderCount,
    nativeState: () => ({ nativeCacheValid, resetCalls, nativeCacheRebuilds }) };
}
test('exact ABBA both faces requires visible contribution and restores identities/history without version rollback', () => {
  const f = fixture(), report = f.api.run({ panes: 1, oblique: false });
  assert.equal(report.status, 'pass'); assert.equal(report.samples.length, 2);
  assert.ok(report.samples.every(row => row.visible && row.stable && row.ab.full.channels === 0 && row.absence.roi.pixels > 0));
  assert.ok(report.samples.every(row => row.captures[0].mainDraws === 2 && row.captures[1].mainDraws === 1));
  assert.ok(report.versionDeltas.original > 0); assert.equal(report.restoreErrors.length, 0); f.verifyRestore();
  assert.equal(report.normalRefresh.complete, true); assert.equal(f.nativeState().nativeCacheRebuilds, 1);
  assert.equal(f.nativeState().resetCalls, 2); assert.equal(f.nativeState().nativeCacheValid, false);
  f.g.render(0); assert.equal(f.nativeState().nativeCacheRebuilds, 2, 'following native frame rebuilds invalidated private cache');
  assert.ok(JSON.stringify(report).length < 20000);
});
test('reproducible material mismatch fails strict exact', () => {
  const f = fixture({ mismatch: true }), report = f.api.run({ panes: 1, oblique: false });
  assert.equal(report.status, 'fail'); assert.ok(report.samples[0].ab.full.channels > 0); f.verifyRestore();
});
test('AA/BB noise is nondeterministic rather than a tolerance pass', () => {
  const f = fixture({ noise: true }), report = f.api.run({ panes: 1, oblique: false });
  assert.equal(report.status, 'nondeterministic'); f.verifyRestore();
});
test('occluded pane is skipped even with main draws and nonblack screen', () => {
  const f = fixture({ occluded: true }), report = f.api.run({ panes: 1, oblique: false });
  assert.equal(report.status, 'skip'); assert.equal(report.samples[0].absence.roi.pixels, 0); assert.ok(report.samples[0].captures[0].mainDraws > 0); f.verifyRestore();
});
test('readback failure still restores camera/material/render wrapper/exposure histories', () => {
  const f = fixture({ throwRead: true }), report = f.api.run({ panes: 1, oblique: false });
  assert.equal(report.status, 'error'); assert.match(report.error, /mock readback/); f.verifyRestore();
});
test('native refresh GL error is attributed and remains an overall failure despite strict pixel pass', () => {
  const f = fixture({ refreshError: true }), report = f.api.run({ panes: 1, oblique: false });
  assert.equal(report.status, 'error'); assert.equal(report.samples.every(row => row.status === 'pass'), true);
  assert.equal(report.finalGLErrors.includes(1282), true);
  assert.equal(report.glRestore.groups.some(row => row.label === 'restore.normal-native-render' && row.errors.includes(1282)), true);
  assert.equal(report.normalRefresh.complete, false);
  assert.equal(report.glRestore.complete, false); f.verifyRestore();
});
test('native reset error cannot be cleared into a pass by the following refresh', () => {
  const f = fixture({ resetError: true }), report = f.api.run({ panes: 1, oblique: false });
  assert.equal(report.status, 'error'); assert.equal(report.samples.every(row => row.status === 'pass'), true);
  assert.ok(report.glRestore.groups.some(row => row.label === 'restore.native-cache-controls'));
  assert.equal(report.glRestore.complete, false); assert.equal(report.finalGLErrors.includes(1282), true); f.verifyRestore();
});
test('native refresh exception still restores camera/material/exposure and reports failure', () => {
  const f = fixture({ refreshThrow: true }), report = f.api.run({ panes: 1, oblique: false });
  assert.equal(report.status, 'error'); assert.match(report.normalRefresh.exception, /native refresh failed/);
  assert.equal(report.normalRefresh.complete, false); f.verifyRestore();
});
