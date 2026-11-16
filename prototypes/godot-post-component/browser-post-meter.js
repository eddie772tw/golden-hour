// Diagnostic-only single existing 1x1 read. No render/compile/snap/history update.
(() => {
  const CORE = 'b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b';
  const caps = { jsonBytes: 262144, codeChars: 131072, stringChars: 65536, programs: 8, uniforms: 64, glErrors: 16 };
  const half = word => {
    const sign = word >>> 15 ? -1 : 1, exponent = (word >>> 10) & 31, fraction = word & 1023;
    return exponent === 0 ? sign * fraction * 2 ** -24 : exponent === 31 ? fraction ? NaN : sign * Infinity : sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
  };
  function capture(options = {}) {
    const report = { schema: 'gh-post-meter-evidence-v1', ok: false, errors: [], gaps: [], caps,
      source: { coreSHA256: options.coreSHA256 ?? null, sessionId: options.sessionId ?? null },
      operations: { nativeMeterReads: 0, render: 0, compile: 0, snapExposure: 0 },
      scope: 'Existing paused native High post state; one original 1x1 half-float read, no image/performance/High parity claim' };
    let g, r, gl, savedTarget, savedDraw, savedRead, calls, codeChars = 0;
    const need = (ok, message) => { if (!ok) throw Error(message); };
    const finite = x => { need(typeof x === 'number' && Number.isFinite(x), 'Nonfinite/nonnumeric scalar'); return x; };
    const string = s => { need(typeof s === 'string' && s.length <= caps.stringChars, 'String cap/type'); return s; };
    const vector = (a, length) => { need(a?.length === length, 'Vector/matrix shape'); return Array.from(a, finite); };
    function errors() {
      const out = [];
      for (let i = 0; i < caps.glErrors; i++) {
        const error = gl.getError(); if (error === gl.NO_ERROR) return out; out.push(error);
      }
      out.push('error-drain-cap'); return out;
    }
    function texture(t) {
      need(t?.isTexture, 'Expected existing native Texture');
      return { id: string(t.uuid), name: string(t.name ?? ''), type: t.type, format: t.format,
        colorSpace: t.colorSpace, minFilter: t.minFilter, magFilter: t.magFilter,
        renderTarget: !!t.isRenderTargetTexture };
    }
    function uniformValue(v) {
      if (v == null || typeof v === 'boolean') return v;
      if (typeof v === 'number') return finite(v);
      if (v.isTexture) return { texture: texture(v) };
      if (v.isVector2 || v.isVector3 || v.isVector4) return { vector: vector(v.toArray(), v.isVector2 ? 2 : v.isVector3 ? 3 : 4) };
      if (v.isMatrix3 || v.isMatrix4) return { matrix: vector(v.elements, v.isMatrix3 ? 9 : 16) };
      throw Error('Unknown final uniform type; no recursive serialization');
    }
    function uniforms(table) {
      const keys = Object.keys(table); need(keys.length <= caps.uniforms, 'Uniform cap');
      return Object.fromEntries(keys.map(k => [string(k), uniformValue(table[k].value)]));
    }
    function code(text) {
      string(text); codeChars += text.length; need(codeChars <= caps.codeChars, 'Total code cap'); return text;
    }
    try {
      need(options.coreSHA256 === CORE, 'Exact reviewed source SHA required');
      need(typeof options.sessionId === 'string' && options.sessionId.length <= 128, 'Bounded session ID required');
      const GH = globalThis.GH;
      need(GH?.ready && GH.G?.state === 'paused' && GH.benchmark?.tick === 240, 'Ready paused native tick240 required');
      g = GH.debug?.gfx; need(g && g.quality === 'high', 'Exact GH.debug.gfx High owner required');
      need(!g.preparation?.pending && !g.preparation?.error && !g._warming, 'Preparation/warming not settled');
      r = g.renderer; gl = r.getContext();
      report.glErrorsBefore = errors(); need(!report.glErrorsBefore.length, 'Pre-existing GL errors; retained, read not attempted');
      savedTarget = r.getRenderTarget(); savedDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING); savedRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      need(savedTarget === null && savedDraw === null && savedRead === null, 'Native completed-frame default framebuffer required');
      calls = finite(r.info.render.calls);
      const m = g.meter, u = g.uniforms, material = g.final?.material;
      need(m?.gfx === g && typeof g.readMeter === 'function', 'Exact meter.gfx/readMeter ownership required');
      need(u === g.final.uniforms && u === material?.uniforms, 'Exact gfx/final/material uniform identity required');
      need(u.tAdapt.value === m.e0?.texture && m.texture === m.e0.texture, 'Current e0/tAdapt identity mismatch');
      need(m.e0.isWebGLRenderTarget && m.e0.width === 1 && m.e0.height === 1, 'Existing native 1x1 target required');
      need(m.e0.texture.type === 1016 && m.e0.texture.format === 1023 && m.e0.texture.colorSpace === '', 'Expected source noColor RGBA HalfFloat');
      const framebuffer = r.properties.get(m.e0).__webglFramebuffer;
      need(framebuffer && gl.isFramebuffer(framebuffer), 'Existing e0 framebuffer must already be initialized/valid');
      report.source = { ...report.source, tick: GH.benchmark.tick, state: GH.G.state, quality: g.quality,
        gfxTime: finite(g.time), gameTime: finite(GH.G.time), cameraWorld: vector(g.camera.matrixWorld.elements, 16) };
      report.renderer = { toneMapping: r.toneMapping, outputColorSpace: r.outputColorSpace,
        width: r.domElement.width, height: r.domElement.height, callsBefore: calls };
      need(r.domElement.width === 1920 && r.domElement.height === 1080, 'Reviewed 1920x1080 viewport required');
      report.identity = { gfxFinalUniforms: true, materialUniforms: true, meterGfx: true, e0IsAdapt: true,
        e0: texture(m.e0.texture), e1: texture(m.e1.texture), currentTargetIsNull: true, initializedFramebuffer: true };
      report.exposureParameters = Object.fromEntries(['auto','key','comp','min','max','up','down','clamp'].map(k => [k, finite(g.exposure[k])]));
      report.finalUniforms = uniforms(u);
      report.meter = { resetPending: !!m.reset, width: m.w, height: m.h,
        downsampleA: [m.a.width, m.a.height], downsampleB: [m.b.width, m.b.height],
        lastAdaptUniforms: uniforms(m.adapt.uniforms), lastDownUniforms: uniforms(m.down.uniforms) };
      report.finalSource = { vertex: code(material.vertexShader), fragment: code(material.fragmentShader),
        readMeterMethod: code(String(g.readMeter)) };
      const properties = r.properties.get(material), programs = properties.programs;
      const variants = programs instanceof Map ? [...new Set(programs.values())] : [];
      need(variants.length <= caps.programs, 'Compiled program cap');
      report.compiledCurrentProgram = properties.currentProgram?.id ?? null;
      report.compiled = variants.map(program => {
        const row = { id: program.id, current: program === properties.currentProgram };
        for (const [slot, handle] of [['vertex', program.vertexShader], ['fragment', program.fragmentShader]]) {
          if (!handle || !gl.isShader(handle)) { report.gaps.push('Existing program ' + program.id + ' has no valid ' + slot + ' shader'); row[slot] = null; }
          else row[slot] = code(gl.getShaderSource(handle));
        }
        return row;
      });
      if (!variants.length) report.gaps.push('No existing compiled final programs; no compile forced');
      report.glErrorsAfterMetadata = errors(); need(!report.glErrorsAfterMetadata.length, 'Metadata-query GL errors; retained, read not attempted');
      const decoded = g.readMeter(); report.operations.nativeMeterReads++;
      need(ArrayBuffer.isView(g._mb) && g._mb.constructor.name === 'Uint16Array' && g._mb.length === 4, 'Original readMeter _mb Uint16Array(4) required');
      const words = Array.from(g._mb), independentlyDecoded = words.map(half);
      const jsonNumber = value => Number.isFinite(value) ? value : { nonfinite: String(value) };
      report.read = { words, independentlyDecoded: independentlyDecoded.map(jsonNumber),
        nativeDecoded: { exposure: jsonNumber(decoded.exposure), avg: jsonNumber(decoded.avg) },
        effectiveExposure: jsonNumber(finite(u.uExposure.value) * (1 + (decoded.exposure - 1) * finite(u.uAuto.value))),
        initializedTargetBeforeRead: true };
      need(words[2] === 0 && words[3] === 0x3c00, 'Native meter output blue0/alpha1 witness missing');
      need(Number.isFinite(decoded.exposure) && decoded.exposure > 0 && Number.isFinite(decoded.avg) && decoded.avg > 0, 'Positive finite native E/avg required');
      need(decoded.exposure === independentlyDecoded[0] && decoded.avg === independentlyDecoded[1], 'Native decode disagrees with original raw half words');
    } catch (error) {
      report.errors.push(String(error?.message ?? error));
    } finally {
      if (gl) {
        report.glErrorsAfter = errors();
        if (report.glErrorsAfter.length) report.errors.push('Post-capture GL errors retained');
      }
      if (r && savedTarget === null) {
        report.nativeStateAfter = { targetIsNull: r.getRenderTarget() === null,
          drawFramebufferUnchanged: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === savedDraw,
          readFramebufferUnchanged: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === savedRead,
          callsUnchanged: r.info.render.calls === calls };
        if (!Object.values(report.nativeStateAfter).every(Boolean)) report.errors.push('Native target/FBO/draw-call state changed');
      }
    }
    report.ok = report.errors.length === 0 && report.operations.nativeMeterReads === 1;
    const length = new TextEncoder().encode(JSON.stringify(report)).byteLength;
    if (length > caps.jsonBytes) throw Error('Post evidence output cap exceeded; not truncated');
    report.outputBytesBeforeLengthField = length;
    return report;
  }
  globalThis.__ghPostMeter = Object.freeze({ capture });
})();
