// Explicit, local-only developer instrumentation. Importing this module does
// nothing; normal gameplay does not load it. Adapted from work/browser-next/diagnostic.js.
const VERSION = "render-dev-v1";
const DEFAULT_LIMITS = { frames: 1200, spans: 12000, gpu: 512, marks: 128, workers: 512, errors: 64 };
const DEFAULT_GPU_SCOPES = ["gfx.render", "render.world", "render.reflection", "shadow.render", "render.VM", "render.postprocess"];
const text = value => String(value ?? "").slice(0, 240);
const countKeys = ["draws", "instancedDraws", "instances", "submissions", "programUses", "uniformCalls", "matrixUniformCalls", "shaderCompiles", "programLinks"];
function ring(capacity) {
  let data = [], next = 0, total = 0;
  return {
    push(value) { total++; if (data.length < capacity) data.push(value); else { data[next] = value; next = (next + 1) % capacity; } },
    clear() { data = []; next = total = 0; },
    values() { return data.length < capacity ? data.slice() : data.slice(next).concat(data.slice(0, next)); },
    coverage() { return { capacity, total, retained: data.length, dropped: total - data.length }; },
  };
}
function counters() {
  return { ...Object.fromEntries(countKeys.map(key => [key, 0])), materials: new Set(), programs: new Set(),
    idsTruncated: false, materialRuns: 0, firstMaterial: null, lastMaterial: null };
}
function mergeCounts(target, source) {
  for (const key of countKeys) target[key] += source[key];
  if (source.firstMaterial !== null) {
    target.materialRuns += source.materialRuns - (target.lastMaterial === source.firstMaterial ? 1 : 0);
    target.firstMaterial ??= source.firstMaterial; target.lastMaterial = source.lastMaterial;
  }
  for (const key of ["materials", "programs"]) for (const id of source[key]) {
    if (target[key].size < 2048) target[key].add(id); else target.idsTruncated = true;
  }
  target.idsTruncated ||= source.idsTruncated;
}
function exportCounts(value) {
  return { ...Object.fromEntries(countKeys.map(key => [key, value[key]])), materialRuns: value.materialRuns,
    uniqueMaterials: value.materials.size, uniquePrograms: value.programs.size, idsTruncated: value.idsTruncated };
}

/** Install only after GH.ready. No RAF, FPS cap, simulation or scene changes. */
export function installRenderDiagnostics(GH = globalThis.GH, options = {}) {
  const debug = GH?.debug, gfx = debug?.gfx, renderer = gfx?.renderer;
  if (!renderer || !GH.ready) throw Error("Install render diagnostics after GH.ready / GH.debug.gfx");
  if (GH.renderDiagnostics?.installed) return GH.renderDiagnostics;
  // Both tools wrap the same methods. Refuse double instrumentation explicitly.
  if (globalThis.__diag?.installed) throw Error("Stop __diag before installing render diagnostics");
  const perf = options.performance || globalThis.performance, now = () => perf.now();
  const gl = renderer.getContext(), canvas = renderer.domElement;
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) =>
    [key, Math.max(1, Math.min(65536, Math.floor(Number(options.limits?.[key]) || fallback)))]));
  const buffers = Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, ring(value)]));
  const config = { gpu: options.gpu !== false, gpuEveryFrames: Math.max(1, Math.min(600, Math.floor(Number(options.gpuEveryFrames) || 11))),
    counters: options.counters !== false, uniformCounts: options.uniformCounts === true,
    driverTimings: options.driverTimings === true, trace: options.trace === true };
  const gpuScopes = (options.gpuScopes || DEFAULT_GPU_SCOPES).slice(0, 64).map(text);
  if (!gpuScopes.length) gpuScopes.push("gfx.render");
  const patches = [], stack = [], countStack = [], summaries = new Map();
  const ids = new WeakMap(); let nextObjectID = 1, nextSpanID = 1;
  let installed = true, phase = "installed", frame = 0, inFrame = false, previous = null, reflectionDepth = 0;
  const gpuJitter = Math.min(2, config.gpuEveryFrames - 1);
  let samplingState = 0x47524844, nextGPUFrame = config.gpuEveryFrames, sampleNumber = 0;
  let summaryOverflow = 0, frameWork = null, shadowOwner = null;
  const gpuStrata = new Map();
  let passName = null, extension = null, pending = [], activeQuery = null, selection = null, contextEpoch = 0;
  let gpuSupported = false, gpuFailed = false, contextLost = false;
  const gpuStats = { scheduled: 0, submitted: 0, completed: 0, unavailablePolls: 0, skipped: 0, invalidated: 0,
    disjointEvents: 0, contextLosses: 0, contextRestores: 0, queryErrors: 0 };
  const error = value => buffers.errors.push({ t: now(), message: text(value?.message || value) });
  const id = object => {
    if (!object || (typeof object !== "object" && typeof object !== "function")) return null;
    if (!ids.has(object)) ids.set(object, nextObjectID++);
    return ids.get(object);
  };
  const tick = () => GH.benchmark?.tick ?? null;
  const owner = () => countStack[countStack.length - 1];
  function increment(key, amount = 1) { const scope = owner(); if (scope) scope.counts[key] += amount; }
  function trace(label, start, end, detail) {
    if (!config.trace) return;
    const name = "gh-renderdev:" + label;
    try { perf.measure(name, { start, end, detail }); perf.clearMeasures(name); } catch { /* Optional browser feature. */ }
  }
  function patch(object, key, make, group = "base") {
    if (!object || typeof object[key] !== "function" || patches.some(item => item.object === object && item.key === key)) return;
    if (patches.length >= 256) { error("Wrapper limit 256 reached; coverage is partial"); return; }
    const original = object[key], descriptor = Object.getOwnPropertyDescriptor(object, key), wrapped = make(original);
    try {
      object[key] = wrapped;
      if (object[key] !== wrapped) throw Error("Cannot instrument " + key);
      patches.push({ object, key, original, descriptor, wrapped, group });
    } catch (failure) { error(failure); }
  }
  function unpatch(group) {
    for (let i = patches.length - 1; i >= 0; i--) {
      const item = patches[i]; if (group && item.group !== group) continue;
      if (item.object[item.key] === item.wrapped) {
        if (item.descriptor) Object.defineProperty(item.object, item.key, item.descriptor);
        else delete item.object[item.key];
      } else error("Later wrapper owns " + item.key + "; inactive diagnostic wrapper left beneath it");
      patches.splice(i, 1);
    }
  }
  function invalidateQueries(reason) {
    if (activeQuery) activeQuery.invalid = reason;
    for (const item of pending) { try { gl.deleteQuery(item.query); } catch {} gpuStats.invalidated++; }
    pending = [];
  }
  function acquireExtension() {
    gpuFailed = false; contextLost = !!gl.isContextLost?.();
    try { extension = config.gpu && !contextLost ? gl.getExtension("EXT_disjoint_timer_query_webgl2") : null; }
    catch (failure) { error(failure); extension = null; }
    gpuSupported = !!extension;
  }
  function pollGPU() {
    if (!extension || contextLost || gpuFailed || !pending.length) return;
    try {
      if (gl.isContextLost()) { onLost(); return; }
      if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
        gpuStats.disjointEvents++; invalidateQueries("disjoint"); return;
      }
      for (let i = 0; i < pending.length;) {
        const item = pending[i];
        if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) { gpuStats.unavailablePolls++; i++; continue; }
        const ns = gl.getQueryParameter(item.query, gl.QUERY_RESULT);
        // The disjoint flag can change between availability and result reads.
        if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
          gpuStats.disjointEvents++; invalidateQueries("disjoint"); return;
        }
        buffers.gpu.push({ ...item.meta, frameWork: { ...item.meta.frameWork }, ms: ns / 1e6 }); gpuStats.completed++;
        const stratum = `${item.meta.label}|reflection=${!!item.meta.frameWork?.reflectionCalls}|draws=${item.meta.counts ? item.meta.counts.draws === 0 ? "zero" : "nonzero" : "unknown"}`;
        gpuStrata.set(stratum, (gpuStrata.get(stratum) || 0) + 1);
        gl.deleteQuery(item.query); pending.splice(i, 1);
      }
    } catch (failure) { gpuStats.queryErrors++; error(failure); invalidateQueries("query-error"); gpuFailed = true; }
  }
  function beginGPU(scope) {
    if (!selection || selection !== scope.label || !extension || gpuFailed || contextLost || !inFrame) return null;
    selection = null; // Only the first matching invocation in this sampled frame.
    try {
      if (activeQuery || pending.length >= 8 || gl.isContextLost() ||
          gl.getParameter(extension.GPU_DISJOINT_EXT) || gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
        gpuStats.skipped++; return null;
      }
      const query = gl.createQuery(); if (!query) { gpuStats.skipped++; return null; }
      const item = { query, meta: { frame, tick: tick(), t: scope.start, phase, span: scope.id,
        label: scope.label, parent: scope.parent, contextEpoch, inclusive: true, frameWork } };
      // Do not claim ownership until beginQuery returns successfully.
      try { gl.beginQuery(extension.TIME_ELAPSED_EXT, query); }
      catch (failure) { gl.deleteQuery(query); throw failure; }
      activeQuery = item; gpuStats.submitted++; return item;
    } catch (failure) { gpuStats.queryErrors++; error(failure); gpuFailed = true; return null; }
  }
  function endGPU(item) {
    if (!item || activeQuery !== item) return;
    activeQuery = null;
    try {
      if (item.invalid || contextLost || gl.isContextLost()) {
        if (!gl.isContextLost() && gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) === item.query)
          gl.endQuery(extension.TIME_ELAPSED_EXT);
        gl.deleteQuery(item.query); gpuStats.invalidated++; return;
      }
      gl.endQuery(extension.TIME_ELAPSED_EXT); pending.push(item);
    } catch (failure) { gpuStats.queryErrors++; gpuStats.invalidated++; error(failure); try { gl.deleteQuery(item.query); } catch {} }
  }
  function onLost() {
    if (contextLost) return;
    contextLost = true; contextEpoch++; gpuStats.contextLosses++; invalidateQueries("context-lost");
    // Do not preventDefault: game/webgl-context.js owns restoration policy.
  }
  function onRestored() {
    contextEpoch++; gpuStats.contextRestores++; invalidateQueries("context-restored"); acquireExtension(); wrapShadow();
    // Native context listeners may replace shadowMap after this listener. The
    // next gfx invocation also checks identity, independent of listener order.
  }
  function scope(label, callback, hasCounters = false, description = null) {
    if (!installed) return callback();
    label = text(label);
    const parent = stack[stack.length - 1];
    const item = { id: nextSpanID++, label, frame: inFrame ? frame : frame + 1, tick: tick(), phase,
      parent: parent?.id ?? null, start: now(), childMS: 0, ...(description || {}) };
    if (hasCounters && config.counters) { item.counts = counters(); countStack.push(item); }
    stack.push(item); const query = beginGPU(item); let failed = false;
    try { return callback(); } catch (failure) { failed = true; throw failure; }
    finally {
      endGPU(query);
      const end = now(), inclusiveMS = end - item.start, selfMS = Math.max(0, inclusiveMS - item.childMS);
      stack.pop(); if (parent) parent.childMS += inclusiveMS;
      const row = { ...item, inclusiveMS, selfMS, failed }; delete row.childMS;
      if (item.counts) {
        countStack.pop(); const countsParent = owner();
        if (countsParent) mergeCounts(countsParent.counts, item.counts);
        row.counts = exportCounts(item.counts);
      }
      if (query) query.meta.counts = row.counts || null;
      if (!summaries.has(label) && summaries.size < 128) summaries.set(label, { calls: 0, inclusiveMS: 0, selfMS: 0, maxMS: 0, failed: 0 });
      const summary = summaries.get(label);
      if (summary) { summary.calls++; summary.inclusiveMS += inclusiveMS; summary.selfMS += selfMS;
        summary.maxMS = Math.max(summary.maxMS, inclusiveMS); summary.failed += +failed;
        if (row.counts) {
          const totals = summary.counterTotals ||= {};
          for (const key of [...countKeys, "materialRuns"]) totals[key] = (totals[key] || 0) + row.counts[key];
          totals.materialDistinctPerCallSum = (totals.materialDistinctPerCallSum || 0) + row.counts.uniqueMaterials;
          totals.programDistinctPerCallSum = (totals.programDistinctPerCallSum || 0) + row.counts.uniquePrograms;
        }
      } else summaryOverflow++;
      buffers.spans.push(row); trace(label, item.start, end, { frame: item.frame, tick: item.tick, span: item.id, parent: item.parent });
    }
  }
  function timed(object, key, label, group = "base") {
    patch(object, key, original => function (...args) { return scope(label, () => original.apply(this, args)); }, group);
  }
  function describe(scene, camera) {
    const layers = camera?.layers?.mask ?? null;
    const override = scene?.overrideMaterial?.type || (scene?.overrideMaterial ? "material" : null);
    const label = scene === gfx.scene ? reflectionDepth ? "reflection" : camera !== gfx.camera ? "world-other-camera" :
      layers === 4 ? "fx-layer2" : layers === 8 ? "distortion" : override ? "ao-normal" : "world" :
      scene === gfx.vmScene ? override ? "VM-velocity" : "VM" : "postprocess";
    return { label: "render." + label, scene: scene === gfx.scene ? "world" : scene === gfx.vmScene ? "VM" : scene?.type || "other",
      camera: camera === gfx.camera ? "main" : camera === gfx.vmCamera ? "VM" : camera?.type || "other",
      layers, override, composerPass: passName, target: renderer.getRenderTarget?.()?.uuid || "screen" };
  }
  function wrapPasses() {
    unpatch("passes");
    (gfx.composer?.passes || []).forEach((pass, index) => {
      const label = `composer.${index}.${text(pass.constructor?.name || "pass")}`;
      patch(pass, "render", original => function (...args) {
        if (!installed) return original.apply(this, args);
        const previousPass = passName; passName = label;
        try { return scope(label, () => original.apply(this, args), true); } finally { passName = previousPass; }
      }, "passes");
    });
  }
  function wrapBots() {
    unpatch("bots");
    for (const bot of debug.match?.bots || []) { timed(bot, "update", "bots.update", "bots"); timed(bot, "idle", "bots.idle", "bots"); }
  }
  function wrapShadow() {
    if (shadowOwner === renderer.shadowMap) return;
    unpatch("shadow"); // Release the old native shadow object and its wrapper.
    shadowOwner = renderer.shadowMap || null;
    patch(shadowOwner, "render", original => function (...args) {
      return scope("shadow.render", () => original.apply(this, args), true);
    }, "shadow");
  }
  const api = {
    version: VERSION,
    get installed() { return installed; },
    mark(label) {
      phase = text(label); const t = now(); buffers.marks.push({ t, phase, frame, tick: tick() });
      if (config.trace) {
        const name = "gh-renderdev:" + phase;
        try { perf.mark(name); perf.clearMarks(name); globalThis.console?.timeStamp?.(name); } catch {}
      }
    },
    phaseMark(label) { return api.mark(label); },
    // Synchronous explicit probe boundary; does not pretend to time async work.
    scope(label, callback) { return scope("custom." + text(label), callback); },
    recordWorkerTiming(sample) {
      if (!installed) return;
      if (!sample?.worker || !sample.label || !Number.isFinite(sample.durationMS) || sample.durationMS < 0 ||
          !Number.isFinite(sample.startMS) || !Number.isFinite(sample.timeOrigin))
        throw TypeError("Worker sample needs worker, label, durationMS, startMS and worker performance.timeOrigin");
      buffers.workers.push({ worker: text(sample.worker), label: text(sample.label), durationMS: sample.durationMS,
        startMS: sample.startMS, timeOrigin: sample.timeOrigin, receivedAt: now(), frame, tick: sample.tick ?? null,
        evidence: "caller-supplied worker-internal performance timing; not inferred from page wait time" });
    },
    reset() {
      if (stack.length) throw Error("Reset diagnostics outside an active instrumented call");
      invalidateQueries("reset");
      for (const buffer of Object.values(buffers)) buffer.clear();
      summaries.clear(); frame = 0; previous = null; nextSpanID = 1;
      summaryOverflow = 0; gpuStrata.clear(); samplingState = 0x47524844; sampleNumber = 0; nextGPUFrame = config.gpuEveryFrames;
      for (const key of Object.keys(gpuStats)) gpuStats[key] = 0;
      acquireExtension();
      api.mark(phase); return api;
    },
    export() {
      if (installed) pollGPU();
      return { version: VERSION, installed, phase, config: { ...config, gpuScopes }, limits,
        source: { module: import.meta.url, core: options.source || null,
          adaptedFrom: "work/browser-next/diagnostic.js; run_browser.py phase/export conventions" },
        coverage: Object.fromEntries(Object.entries(buffers).map(([key, value]) => [key, value.coverage()])),
        summaries: Object.fromEntries([...summaries].map(([key, value]) => [key, { ...value, ...(value.counterTotals ? { counterTotals: { ...value.counterTotals } } : {}) }])),
        summaryOverflow, summaryCoverage: "all calls since reset; raw spans/frames are bounded rings; labels capped at 128; distinct-per-call sums are not global unique IDs",
        ...Object.fromEntries(Object.entries(buffers).map(([key, value]) => [key, value.values()])),
        gpuState: { supported: gpuSupported, enabled: config.gpu && !!extension && !gpuFailed && !contextLost,
          pending: pending.length, contextEpoch, jitterFrames: gpuJitter, sampleStrata: Object.fromEntries(gpuStrata), ...gpuStats },
        timingModel: {
          cpuThread: "page JavaScript renderer main thread; performance.now wall duration includes browser/driver API waits and instrumentation",
          cpuSelf: "inclusiveMS minus directly instrumented child spans; uninstrumented work and probe overhead remain in selfMS; do not sum inclusive parents and children",
          frame: "gfx.render invocation, not presented frame or full M0 tick; update spans before it join the next frame number; use tick/start/parent for attribution",
          gpu: "GPU-clock elapsed command interval, including command-stream bubbles/CPU feed gaps; not active hardware utilization or pure shader busy time, never GPU-process CPU time. One non-nested query per sampled gfx frame, first matching scope only, scopes rotate with deterministic private xorshift jitter (never Math.random); inclusive nested work. frameWork.reflectionCalls and counts.draws separate empty-shadow/reflection strata",
          gpuJoin: "gpu.span = spans.id and gpu.frame = frames.frame; raw span can have rolled out; missing/invalid samples are not zero",
          workers: "only explicit worker-internal samples are recorded; no OS thread ID or scheduling inferred",
          threads: "driver/raster/compositor/worker thread attribution requires separate CDP trace with thread metadata; trace=true emits UserTiming/timeStamp correlation",
          counters: "inclusive per scope; parent numeric counts include children. Material runs follow actual renderBufferDirect sequence; distinct IDs capped at 2048 per scope",
          gaps: "Three private getParameters/o0/D/cache-hit reasons are inaccessible from public wrappers; use isolated source probe or CPU profile. No multi-draw extension calls, GPU queue/presentation latency or full-frame simulation boundary observed",
          overhead: "opt-in passive wrappers/clock reads/sets/query calls add CPU and possibly GPU/driver cost. Do not use these runs as uninstrumented FPS acceptance. uniformCounts/driverTimings/trace are heavier independent switches; no gl.finish, result wait, readPixels or extra RAF",
        },
        environment: { timeOrigin: perf.timeOrigin, ua: globalThis.navigator?.userAgent || null,
          hardwareConcurrency: globalThis.navigator?.hardwareConcurrency ?? null, dpr: globalThis.devicePixelRatio ?? null,
          viewport: [globalThis.innerWidth ?? null, globalThis.innerHeight ?? null],
          buffer: [canvas?.width ?? null, canvas?.height ?? null], quality: gfx.quality, scale: gfx.q?.scale,
          state: GH.G?.state, hidden: globalThis.document?.hidden ?? null, warming: !!gfx._warming,
          preparationPending: !!gfx.preparation?.pending, shaderPrograms: renderer.info?.programs?.length ?? null,
          activeWrappers: patches.length, contextLost },
      };
    },
    stop() {
      if (!installed) return api;
      if (stack.length) throw Error("Stop diagnostics outside an active instrumented call");
      installed = false; invalidateQueries("stop"); unpatch(); shadowOwner = null;
      canvas?.removeEventListener?.("webglcontextlost", onLost);
      canvas?.removeEventListener?.("webglcontextrestored", onRestored);
      return api;
    },
  };
  GH.renderDiagnostics = api;
  acquireExtension();
  canvas?.addEventListener?.("webglcontextlost", onLost);
  canvas?.addEventListener?.("webglcontextrestored", onRestored);
  for (const [object, key, label] of [
    [gfx.scene, "updateMatrixWorld", "matrix.world"], [gfx.vmScene, "updateMatrixWorld", "matrix.VM"],
    [debug.player, "update", "player"], [debug.arsenal, "update", "arsenal"], [debug.match, "update", "match"],
    [debug.physics, "update", "physics"], [debug.glass, "update", "glass"], [debug.vm, "update", "vm.update"],
    [debug.fpbody, "update", "fpbody"], [debug.fx, "update", "fx.update"], [debug.ctx?.audio, "update", "audio"],
    [debug.ctx?.hud, "update", "HUD"],
  ]) timed(object, key, label);
  wrapBots(); wrapPasses(); wrapShadow();
  patch(debug.match, "createBots", original => function (...args) { const result = original.apply(this, args); if (installed) wrapBots(); return result; });
  patch(gfx, "_build", original => function (...args) {
    if (installed) unpatch("passes");
    const result = original.apply(this, args); if (installed) { wrapPasses(); wrapShadow(); } return result;
  });
  patch(gfx, "preRender", original => function (...args) {
    if (!installed) return original.apply(this, args);
    if (frameWork) frameWork.reflectionCalls++;
    reflectionDepth++; try { return scope("reflection.total", () => original.apply(this, args)); } finally { reflectionDepth--; }
  });
  patch(renderer, "render", original => function (scene, camera, ...args) {
    if (!installed) return original.call(this, scene, camera, ...args);
    const description = describe(scene, camera);
    return scope(description.label, () => original.call(this, scene, camera, ...args), true, description);
  });
  if (config.counters) {
    patch(renderer, "renderBufferDirect", original => function (...args) {
      if (installed) {
        const current = owner();
        if (current) {
          const material = id(args[3]), counts = current.counts; counts.submissions++;
          if (counts.lastMaterial !== material) counts.materialRuns++;
          counts.firstMaterial ??= material; counts.lastMaterial = material;
          if (counts.materials.size < 2048) counts.materials.add(material); else counts.idsTruncated = true;
        }
      }
      return original.apply(this, args);
    });
    for (const key of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
      patch(gl, key, original => function (...args) {
        if (installed) { increment("draws"); if (key.endsWith("Instanced")) { increment("instancedDraws"); increment("instances", Number(args[key === "drawArraysInstanced" ? 3 : 4]) || 0); } }
        return original.apply(this, args);
      });
    }
    patch(gl, "useProgram", original => function (program) {
      if (installed) {
        increment("programUses"); const counts = owner()?.counts;
        if (counts) { if (counts.programs.size < 2048) counts.programs.add(id(program)); else counts.idsTruncated = true; }
      }
      return original.call(this, program);
    });
    for (const [key, counter] of [["compileShader", "shaderCompiles"], ["linkProgram", "programLinks"]])
      patch(gl, key, original => function (...args) { if (installed) increment(counter); return original.apply(this, args); });
    if (config.uniformCounts) for (const key of [
      ...[1, 2, 3, 4].flatMap(n => [`uniform${n}f`, `uniform${n}fv`, `uniform${n}i`, `uniform${n}iv`, `uniform${n}ui`, `uniform${n}uiv`]),
      ...["2", "3", "4", "2x3", "2x4", "3x2", "3x4", "4x2", "4x3"].map(n => `uniformMatrix${n}fv`),
    ]) patch(gl, key, original => function (...args) {
      if (installed) { increment("uniformCalls"); if (key.startsWith("uniformMatrix")) increment("matrixUniformCalls"); }
      return original.apply(this, args);
    });
  }
  if (config.driverTimings) for (const key of ["linkProgram", "getProgramInfoLog", "getShaderInfoLog", "getProgramParameter", "getActiveUniform", "getActiveAttrib", "getUniformLocation", "getAttribLocation"]) {
    // linkProgram already has a counter wrapper; wrap that wrapper deliberately.
    const prior = patches.find(item => item.object === gl && item.key === key);
    if (prior) { const original = prior.wrapped; const wrapped = function (...args) { return scope("gl." + key, () => original.apply(this, args)); };
      gl[key] = wrapped; prior.wrapped = wrapped;
    } else timed(gl, key, "gl." + key);
  }
  patch(gfx, "render", original => function (...args) {
    if (!installed) return original.apply(this, args);
    const start = now(); wrapShadow(); frame++; inFrame = true; frameWork = { reflectionCalls: 0 }; pollGPU();
    if (config.gpu && frame >= nextGPUFrame) {
      selection = gpuScopes[sampleNumber++ % gpuScopes.length]; gpuStats.scheduled++;
      // Private sampling RNG never consumes gameplay/benchmark random numbers.
      samplingState ^= samplingState << 13; samplingState ^= samplingState >>> 17; samplingState ^= samplingState << 5;
      nextGPUFrame = frame + config.gpuEveryFrames + (samplingState >>> 0) % (gpuJitter * 2 + 1) - gpuJitter;
    }
    let failed = false;
    try { return scope("gfx.render", () => original.apply(this, args), true); }
    catch (failure) { failed = true; throw failure; }
    finally {
      if (selection) gpuStats.skipped++;
      selection = null; inFrame = false;
      buffers.frames.push({ frame, t: start, intervalMS: previous === null ? null : start - previous,
        submitMS: now() - start, tick: tick(), phase, state: GH.G?.state,
        hidden: globalThis.document?.hidden ?? null, warming: !!gfx._warming,
        preparationPending: !!gfx.preparation?.pending, ...frameWork, failed }); previous = start; frameWork = null;
    }
  });
  api.mark("installed"); return api;
}
