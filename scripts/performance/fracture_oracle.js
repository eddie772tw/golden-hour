/* Eval once, then __fractureOracle.run({panes:3,oblique:true,source:{...}}).
 * One synchronous evaluation, paused/ready High scene, outside formal FPS.
 * Snapshot/uniform and meter-copy algorithm reused from reflection/browser-probe.js.
 */
(() => {
  'use strict';
  const d = globalThis.GH?.debug, g = d?.gfx, r = g?.renderer, glass = d?.glass;
  if (!r || !glass) throw Error('GH.debug gfx/glass required');
  let busy = false;
  const saveProperties = (obj, keys) => keys.map(key => [key, Object.getOwnPropertyDescriptor(obj, key)]);
  const restoreProperties = (obj, rows) => { for (const [key, descriptor] of rows) descriptor ? Object.defineProperty(obj, key, descriptor) : delete obj[key]; };
  function snapshotObject(obj) {
    const rows = Object.entries(obj || {}).map(([key, value]) => [key, value,
      value && !value.isTexture && (value.isMatrix4 || value.isMatrix3 || value.isQuaternion || value.isVector2 || value.isVector3 || value.isVector4 || value.isColor) ? value.clone() : null]);
    return () => { for (const [key, value, clone] of rows) { obj[key] = value; if (clone) value.copy(clone); } };
  }
  function vector4() { return { x: 0, y: 0, z: 0, w: 0, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; this.w = v.w; return this; } }; }
  function compare(a, b, roi) {
    const all = { pixels: 0, channels: 0, maxDelta: 0 }, local = { pixels: 0, channels: 0, maxDelta: 0 };
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      const index = (y * a.width + x) * 4; let changed = false, inside = x >= roi.x0 && x < roi.x1 && y >= roi.y0 && y < roi.y1;
      for (let c = 0; c < 4; c++) {
        const delta = Math.abs(a.data[index + c] - b.data[index + c]);
        if (delta) { changed = true; all.channels++; all.maxDelta = Math.max(all.maxDelta, delta);
          if (inside) { local.channels++; local.maxDelta = Math.max(local.maxDelta, delta); } }
      }
      if (changed) { all.pixels++; if (inside) local.pixels++; }
    }
    return { full: all, roi: local };
  }
  function liveTriangles(pane) {
    const positions = pane.mesh?.geometry?.attributes?.position?.array; let live = 0;
    if (!positions) return 0;
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i + 3] - positions[i], ay = positions[i + 4] - positions[i + 1], az = positions[i + 5] - positions[i + 2];
      const bx = positions[i + 6] - positions[i], by = positions[i + 7] - positions[i + 1], bz = positions[i + 8] - positions[i + 2];
      if (ay * bz - az * by || az * bx - ax * bz || ax * by - ay * bx) live++;
    }
    return live;
  }
  const api = globalThis.__fractureOracle = {
    run({ panes = 3, oblique = true, source = null } = {}) {
      if (busy) throw Error('Fracture oracle is already running');
      if (d.stats().state !== 'paused' || g.preparation?.pending || g.preparation?.error) throw Error('Paused ready scene required');
      if (g.quality !== 'high' && g.quality !== 'ultra') throw Error('High/Ultra composer required');
      const single = glass._singlePaneMaterial, original = glass.material;
      if (!single || single.forceSinglePass !== true || single === original || !glass._singlePaneProof) throw Error('Fractured-pane candidate handles required');
      const gl = r.getContext(); if (gl.isContextLost()) throw Error('Context is lost');
      const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      if (!(width > 0 && height > 0 && width * height <= 8294400)) throw Error('Framebuffer must be at most 3840x2160 pixels');
      const errors = () => { const list = []; for (let i = 0; i < 8; i++) { const value = gl.getError(); if (value === gl.NO_ERROR) break; list.push(value); } return list; };
      const priorErrors = errors(); if (priorErrors.length) throw Error('Preexisting GL errors: ' + priorErrors.join(','));
      const selected = glass.panes.filter(p => p.mesh && p.mesh.material === single && p.mesh.visible && !p.gone)
        .sort((a, b) => liveTriangles(b) - liveTriangles(a)).slice(0, Math.max(1, Math.min(3, panes | 0)));
      const report = { version: 'fracture-gpu-oracle-v3', source, strictExact: true, paused: true, framebuffer: [width, height],
        materials: { original: original.id, single: single.id, originalForceSinglePass: original.forceSinglePass, singleForceSinglePass: single.forceSinglePass },
        eligibleStanding: glass.panes.filter(p => p.mesh?.material === single && !p.gone).length, selected: selected.map(p => p.id), samples: [], skipped: [],
        limitations: ['GPU pixel-equivalence oracle only, no FPS or GPU utilization claim.', 'Working framebuffer/reflection/postprocess targets are overwritten; a fresh normal render is requested after restoration.',
          'Material versions/program cache dirtiness are never rolled back. GL error flags are consumed/reported and cannot be requeued.',
          'Controlled QA only: game/camera/material/uniform/RT/viewport/scissor/clear controls are restored. Raw GL bindings are deliberately not byte-exact restored; native renderer.resetState invalidates caches and the next native draw rebuilds them. No third-party draws may interleave.'] };
      api.failureImages = null; // At most one failed view's four RGBA frames; never included in returned JSON.
      if (!selected.length) { report.status = 'skip'; report.reason = 'No standing pane with original eligibility material identity'; return report; }
      const oldTarget = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel(), meter = g.meter;
      if (!meter?.e0 || !meter?.e1 || !r.copyTextureToTexture) throw Error('GPU exposure history copy unavailable');
      const restores = [], backups = [], direct = r.renderBufferDirect;
      const clear = original.color.clone(); r.getClearColor(clear);
      const alpha = r.getClearAlpha(), viewport = r.getViewport(vector4()), scissor = r.getScissor(vector4()), scissorTest = r.getScissorTest();
      const rendererFields = saveProperties(r, ['autoClear', 'autoClearColor', 'autoClearDepth', 'autoClearStencil', 'toneMappingExposure']);
      const fields = saveProperties(g, ['time', '_reflectAt', '_shadowAt', '_hasPrev', '_blurK', '_turn']);
      const info = { ...r.info.render }, infoAuto = r.info.autoReset;
      for (const value of [g._lastCam, g._prevQ, g._reproj]) if (value?.clone) { const copy = value.clone(); restores.push(() => value.copy(copy)); }
      for (const camera of [g.camera, g.vmCamera]) {
        const props = saveProperties(camera, ['fov', 'aspect', 'near', 'far', 'zoom', 'focus', 'filmGauge', 'filmOffset', 'view', 'matrixAutoUpdate', 'matrixWorldAutoUpdate', 'matrixWorldNeedsUpdate']);
        const rotation = saveProperties(camera.rotation, ['_x', '_y', '_z', '_order']);
        const copies = ['position', 'scale', 'quaternion', 'up', 'matrix', 'matrixWorld', 'matrixWorldInverse', 'projectionMatrix', 'projectionMatrixInverse'].map(key => [camera[key], camera[key].clone()]);
        const layers = camera.layers.mask;
        restores.push(() => { restoreProperties(camera, props); for (const [value, copy] of copies) value.copy(copy); restoreProperties(camera.rotation, rotation); camera.layers.mask = layers; });
      }
      const uniformGroups = new Set([g.uniforms, meter.adapt?.uniforms, meter.down?.uniforms, g.fx?.p?.uniforms, g.fx?.distort?.uniforms, g.fx?.vol?.uniforms]);
      for (const pass of g._passes || []) for (const uniforms of [pass.uniforms, pass.material?.uniforms, pass.mat?.uniforms]) uniformGroups.add(uniforms);
      const uniformSet = new Set();
      for (const uniforms of uniformGroups) for (const uniform of Object.values(uniforms || {})) if (!uniformSet.has(uniform)) { uniformSet.add(uniform); restores.push(snapshotObject(uniform)); }
      for (const [object, keys] of [[r.shadowMap, ['needsUpdate']], [g.composer, ['readBuffer', 'writeBuffer', 'renderToScreen']],
        [meter, ['e0', 'e1', 'reset', 'enabled']], [g.fxPass, ['_warm', 'needsSwap']], [g.vmBlurPass, ['frame', 'needsSwap']],
        [g.scene, ['overrideMaterial', 'background', 'matrixWorldAutoUpdate']], [g.vmScene, ['overrideMaterial', 'background', 'matrixWorldAutoUpdate']],
        [original, ['side', 'forceSinglePass']], [single, ['side', 'forceSinglePass']]]) if (object) { const saved = saveProperties(object, keys); restores.push(() => restoreProperties(object, saved)); }
      g.scene.traverse(object => { if (object.isLight && object.shadow) { const saved = saveProperties(object.shadow, ['needsUpdate']); restores.push(() => restoreProperties(object.shadow, saved)); } });
      for (const pane of selected) { const saved = saveProperties(pane.mesh, ['material', 'visible']); restores.push(() => restoreProperties(pane.mesh, saved)); }
      function resetState() { restoreProperties(g, fields); for (const restore of restores) restore(); restoreProperties(r, rendererFields); r.setClearColor(clear, alpha); }
      function restoreExposure() { for (const [target, backup] of backups) r.copyTextureToTexture(backup.texture, target.texture); r.setRenderTarget(oldTarget, face, mip); }
      function image() {
        const data = new Uint8Array(width * height * 4); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.pixelStorei(gl.PACK_ALIGNMENT, 4); gl.pixelStorei(gl.PACK_ROW_LENGTH, 0); gl.pixelStorei(gl.PACK_SKIP_ROWS, 0); gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        const glErrors = errors(); let hash = 2166136261, nonBlack = 0; const colors = new Set(), stride = Math.max(1, Math.floor(width * height / 1024));
        for (let i = 0; i < data.length; i += 4) {
          for (let c = 0; c < 4; c++) hash = Math.imul(hash ^ data[i + c], 16777619) >>> 0;
          if (data[i] || data[i + 1] || data[i + 2]) nonBlack++;
          if ((i / 4) % stride === 0 && colors.size < 1024) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
        }
        return { data, width, height, hash: hash.toString(16).padStart(8, '0'), nonBlack, sampledColors: colors.size, glErrors };
      }
      function corners(pane) { return [[pane.a0, pane.y0], [pane.a1, pane.y0], [pane.a1, pane.y1], [pane.a0, pane.y1]].map(([a, y]) => g.camera.position.clone().set(pane.axis === 0 ? pane.pos : a, y, pane.axis === 2 ? pane.pos : a)); }
      function roi(pane) {
        const points = corners(pane).map(v => v.project(g.camera));
        if (points.some(v => !Number.isFinite(v.x + v.y + v.z) || v.z <= -1 || v.z >= 1)) return null;
        const x0 = Math.max(0, Math.floor(Math.min(...points.map(v => (v.x + 1) * width / 2))) - 2), x1 = Math.min(width, Math.ceil(Math.max(...points.map(v => (v.x + 1) * width / 2))) + 2);
        const y0 = Math.max(0, Math.floor(Math.min(...points.map(v => (v.y + 1) * height / 2))) - 2), y1 = Math.min(height, Math.ceil(Math.max(...points.map(v => (v.y + 1) * height / 2))) + 2);
        return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1, origin: 'GL bottom-left' } : null;
      }
      let activePane = null, activeDraws = 0;
      const wrapped = function (camera, scene, geometry, material, object) {
        if (object === activePane?.mesh && camera === g.camera && (material === original || material === single)) activeDraws++;
        return direct.apply(this, arguments);
      };
      busy = true; r.renderBufferDirect = wrapped;
      const originalVersion = original.version, singleVersion = single.version;
      try {
        for (const target of [meter.e0, meter.e1]) {
          const backup = target.clone();
          try { r.initRenderTarget(backup); r.copyTextureToTexture(target.texture, backup.texture); } catch (failure) { backup.dispose(); throw failure; }
          backups.push([target, backup]);
        }
        for (const pane of selected) {
          const proof = glass._singlePaneProof(pane.mesh.geometry.attributes.position.array, pane.axis), live = liveTriangles(pane);
          if (!proof || !live) { report.skipped.push({ pane: pane.id, reason: 'Current geometry fails original eligibility proof or has no live triangles' }); continue; }
          const center = g.camera.position.clone().set(pane.axis === 0 ? pane.pos : (pane.a0 + pane.a1) / 2, (pane.y0 + pane.y1) / 2, pane.axis === 2 ? pane.pos : (pane.a0 + pane.a1) / 2);
          const distance = Math.max(g.camera.near * 4, 1.15 * Math.max(pane.y1 - pane.y0, (pane.a1 - pane.a0) / g.camera.aspect) / (2 * Math.tan(g.camera.fov * Math.PI / 360)));
          for (const direction of [1, -1]) for (const angle of oblique ? [0, .3] : [0]) {
            const setCamera = () => { g.camera.up.set(0, 1, 0); g.camera.position.copy(center); g.camera.position.setComponent(pane.axis, pane.pos + direction * distance);
              if (angle) g.camera.position.setComponent(pane.axis === 0 ? 2 : 0, center.getComponent(pane.axis === 0 ? 2 : 0) + distance * angle);
              g.camera.matrixAutoUpdate = true; g.camera.matrixWorldAutoUpdate = true;
              g.camera.lookAt(center); g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld(true); };
            resetState(); setCamera(); const region = roi(pane);
            if (!region) { report.skipped.push({ pane: pane.id, direction, angle, reason: 'Projected ROI is outside view/near/far or invalid' }); continue; }
            const camera = { position: g.camera.position.toArray(), quaternion: g.camera.quaternion.toArray(), fov: g.camera.fov, aspect: g.camera.aspect, near: g.camera.near, far: g.camera.far };
            activePane = pane;
            const capture = (mode, hidden = false, pixels = true) => {
              resetState(); restoreExposure(); setCamera(); pane.mesh.material = mode === 'A' ? original : single; pane.mesh.visible = !hidden;
              g._hasPrev = false; g._reflectAt = null; g._shadowAt = null; r.shadowMap.needsUpdate = true; g.snapExposure();
              r.info.autoReset = false; g.composer.renderToScreen = true; r.setRenderTarget(null); activeDraws = 0;
              g.render(0); r.setRenderTarget(null);
              return pixels ? { ...image(), mode, hidden, mainDraws: activeDraws } : null;
            };
            capture('A', false, false); capture('B', false, false);
            const a1 = capture('A'), b1 = capture('B'), b2 = capture('B'), a2 = capture('A'), absent = capture('A', true);
            const aa = compare(a1, a2, region), bb = compare(b1, b2, region), ab = compare(a1, b1, region), absence = compare(a1, absent, region);
            const imageRows = [a1, b1, b2, a2, absent].map(({ data, ...row }) => row);
            const visible = [a1, b1, b2, a2].every(row => row.mainDraws > 0 && row.nonBlack > width * height * .01 && row.sampledColors > 1) && absence.roi.pixels > 0;
            const noErrors = imageRows.every(row => !row.glErrors.length);
            const stable = aa.full.channels === 0 && bb.full.channels === 0;
            const status = !noErrors ? 'fail' : !stable ? 'nondeterministic' : !visible ? 'skip' : ab.full.channels ? 'fail' : 'pass';
            if (!api.failureImages && (status === 'fail' || status === 'nondeterministic')) api.failureImages = {
              pane: pane.id, direction, angle, width, height, origin: 'GL bottom-left',
              A1: a1.data, B1: b1.data, B2: b2.data, A2: a2.data };
            report.samples.push({ pane: pane.id, axis: pane.axis, bounds: [pane.pos, pane.a0, pane.a1, pane.y0, pane.y1], liveTriangles: live, proof,
              direction, angle, camera, roi: region, order: 'A-B-B-A + A-hidden', captures: imageRows, aa, bb, ab, absence, visible, stable, status,
              reason: status === 'skip' ? 'No proven visible pane contribution (occluded/zero draws/black image)' : null });
            if (status !== 'pass' && angle === 0) break; // Oblique only after frontal proof.
          }
        }
        report.status = report.samples.some(row => row.status === 'fail') ? 'fail' : report.samples.some(row => row.status === 'nondeterministic') ? 'nondeterministic' :
          report.samples.length > 0 && report.samples.every(row => row.status === 'pass') && report.skipped.length === 0 &&
            selected.every(pane => [1, -1].every(direction => report.samples.some(row => row.pane === pane.id && row.direction === direction && row.angle === 0 && row.status === 'pass'))) ? 'pass' : 'skip';
      } catch (failure) { report.status = 'error'; report.error = String(failure?.stack || failure); }
      finally {
        const failures = [], groups = [], attributedGLErrors = []; let checkedGroups = 0;
        const step = (label, callback) => {
          checkedGroups++; let exception = null;
          try { callback(); } catch (failure) { exception = String(failure); failures.push(label + ': ' + exception); }
          const codes = errors();
          if (codes.length) { groups.push({ label, errors: codes }); attributedGLErrors.push(...codes); }
          return { errors: codes, exception, complete: !codes.length && exception === null };
        };
        const restoreNativeControls = () => {
          // Hm.resetState clears native target/program state and calls both
          // WebGLState.reset and WebGLBindingStates.reset. Do not replay raw
          // framebuffer drawBuffers or other private cache-owned bindings.
          r.resetState(); r.setRenderTarget(oldTarget, face, mip);
          r.setViewport(viewport.x, viewport.y, viewport.z, viewport.w);
          r.setScissor(scissor.x, scissor.y, scissor.z, scissor.w); r.setScissorTest(scissorTest);
          r.setClearColor(clear, alpha);
        };
        step('restore.entry-pending-errors', () => {});
        step('restore.scalar-uniform-camera', resetState);
        step('restore.exposure-textures', restoreExposure);
        if (r.renderBufferDirect === wrapped) r.renderBufferDirect = direct; else failures.push('Later renderBufferDirect owner retained');
        step('restore.native-cache-controls', restoreNativeControls);
        g._reflectAt = null; g._shadowAt = null; r.shadowMap.needsUpdate = true;
        report.normalRefresh = { attempted: true, ...step('restore.normal-native-render', () => g.render(0)) };
        // The verification draw legitimately rotates meter/composer histories.
        // Restore the saved game/history identities once more, retaining its
        // normal-camera image in the working framebuffer.
        step('restore.after-refresh-scalars', resetState);
        step('restore.after-refresh-exposure', restoreExposure);
        for (let i = 0; i < backups.length; i++) step('restore.dispose-backup.' + i, () => backups[i][1].dispose());
        step('restore.final-native-cache-controls', restoreNativeControls);
        Object.assign(r.info.render, info); r.info.autoReset = infoAuto;
        g._reflectAt = null; g._shadowAt = null; r.shadowMap.needsUpdate = true;
        report.restoreErrors = failures; report.glRestore = { contract: 'native-cache-invalidation; no arbitrary raw-binding restoration',
          checkedGroups, groups, complete: !failures.length && !groups.length };
        report.finalGLErrors = [...attributedGLErrors, ...errors()]; report.refreshRequested = true;
        report.versionDeltas = { original: original.version - originalVersion, single: single.version - singleVersion };
        if (!report.glRestore.complete || report.finalGLErrors.length) report.status = 'error';
        busy = false; activePane = null;
      }
      api.last = report; return report;
    },
  };
  return { available: true, API: '__fractureOracle.run({panes:3,oblique:true,source:{coreSHA256:"runner hash"}})' };
})();
