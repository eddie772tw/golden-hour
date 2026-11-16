(() => {
  "use strict";
  window.__diag?.restore?.();
  const limits = { frames: 7200, renderCalls: 65536, gpu: 1024, marks: 128, errors: 64 };
  const ring = capacity => ({
    data: [], next: 0, dropped: 0,
    push(value) {
      if (this.data.length < capacity) this.data.push(value);
      else { this.data[this.next] = value; this.next = (this.next + 1) % capacity; this.dropped++; }
    },
    values() { return this.data.length < capacity ? this.data.slice() : this.data.slice(this.next).concat(this.data.slice(0, this.next)); },
    clear() { this.data.length = 0; this.next = this.dropped = 0; },
  });
  const buffers = Object.fromEntries(Object.entries(limits).map(([key, limit]) => [key, ring(limit)]));
  let installed = false, phase = "diagnostic", parts = {}, totals = {}, patches = [];
  let gfx, debug, gl, extension, queries = [], frameNumber = 0, activeFrame = 0, previous = 0, reflectionDepth = 0;
  let gpuEnabled = false, gpuSkipped = 0, gpuDropped = 0;
  let deepEnabled = false, passLabel = 'outside-render', shadowCalls = 0, shadowDraws = 0, queryIDs = new WeakMap(), nextQueryID = 1;
  const driverQueries = [], driverTotals = {}, shadowPasses = [];
  const now = () => performance.now();
  const error = value => buffers.errors.push({ t: now(), message: String(value?.message || value) });
  function add(target, label, ms) {
    const item = target[label] ||= { calls: 0, ms: 0, max: 0 };
    item.calls++; item.ms += ms; item.max = Math.max(item.max, ms);
  }
  function record(label, ms) { add(parts, label, ms); add(totals, label, ms); }
  function patch(object, key, make) {
    if (!object || typeof object[key] !== "function") return;
    if (patches.length >= 256) { error("Wrapper limit reached; additional objects were not instrumented"); return; }
    const original = object[key], wrapped = make(original);
    object[key] = wrapped;
    patches.push({ object, key, original, wrapped });
  }
  function timed(object, key, label) {
    patch(object, key, original => function (...args) {
      const start = now();
      try { return original.apply(this, args); }
      finally { record(label, now() - start); }
    });
  }
  function dropQueries() {
    for (const item of queries) {
      try { gl.deleteQuery(item.query); } catch {}
      gpuDropped++;
    }
    queries = [];
  }
  function pollGPU() {
    if (!queries.length) return;
    try {
      if (gl.isContextLost() || gl.getParameter(extension.GPU_DISJOINT_EXT)) { dropQueries(); return; }
      for (let i = 0; i < queries.length;) {
        const item = queries[i];
        if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) { i++; continue; }
        buffers.gpu.push({ frame: item.frame, t: item.t, phase: item.phase,
          reflection: item.reflection, ms: gl.getQueryParameter(item.query, gl.QUERY_RESULT) / 1e6 });
        gl.deleteQuery(item.query);
        queries.splice(i, 1);
      }
    } catch (failure) { error(failure); dropQueries(); gpuEnabled = false; }
  }
  function beginGPU() {
    // An odd stride alternates parity instead of locking onto 30 Hz reflections.
    if (!gpuEnabled || frameNumber % 11) return null;
    try {
      // Never wait for a query, and never nest another timer's active query.
      if (gl.isContextLost() || queries.length >= 8 || gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
        gpuSkipped++; return null;
      }
      const query = gl.createQuery();
      if (!query) { gpuSkipped++; return null; }
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      return { query, frame: frameNumber, t: now(), phase };
    } catch (failure) { error(failure); gpuEnabled = false; return null; }
  }
  function describe(scene, camera) {
    const layers = camera?.layers?.mask ?? null;
    const override = scene?.overrideMaterial?.type || (scene?.overrideMaterial ? "material" : null);
    let label;
    if (scene === gfx.scene) {
      label = reflectionDepth ? "reflection" : camera !== gfx.camera ? "world-other-camera" :
        layers === 4 ? "fx-layer2" : layers === 8 ? "distortion" : override ? "ao-normal" : "world";
    } else if (scene === gfx.vmScene) label = override ? "VM-velocity" : "VM";
    else label = "postprocess";
    return { label, scene: scene === gfx.scene ? "world" : scene === gfx.vmScene ? "VM" : scene?.type || "other",
      camera: camera === gfx.camera ? "main" : camera === gfx.vmCamera ? "VM" : camera?.type || "other",
      layers, override };
  }
  function wrapBots() {
    for (const bot of debug.match?.bots || []) {
      if (patches.some(item => item.object === bot && item.key === "update")) continue;
      timed(bot, "update", "bots.update");
      timed(bot, "idle", "bots.idle");
    }
  }
  const api = window.__diag = {
    get installed() { return installed; },
    install({ gpu = true, deep = false } = {}) {
      if (installed) return api;
      debug = window.GH?.debug;
      if (!debug?.gfx) throw Error("Install __diag after GH.debug.gfx is available");
      gfx = debug.gfx;
      gl = gfx.renderer.getContext();
      deepEnabled = deep;
      extension = gpu ? gl.getExtension("EXT_disjoint_timer_query_webgl2") : null;
      gpuEnabled = !!extension;
      if (gpuEnabled && window.__perf?.gpuSupported)
        error("Existing __perf GPU instrumentation detected: use a fresh page with only __diag installed to avoid nested queries");
      for (const [object, key, label] of [
        [gfx.scene, "updateMatrixWorld", "matrix.world"], [gfx.vmScene, "updateMatrixWorld", "matrix.VM"],
        [debug.player, "update", "player"], [debug.arsenal, "update", "arsenal"],
        [debug.match, "update", "match"], [debug.physics, "update", "physics"],
        [debug.glass, "update", "glass"], [debug.vm, "update", "vm.update"],
        [debug.fpbody, "update", "fpbody"], [debug.fx, "update", "fx.update"],
        [debug.ctx?.audio, "update", "audio"], [debug.ctx?.hud, "update", "HUD"],
        [debug.world, "raycast", "raycast"], [debug.world, "clear", "world.clear"],
      ]) timed(object, key, label);
      wrapBots();
      if (deepEnabled) {
        for (const bot of debug.match.bots) for (const key of ['_perceive','_pickGoal','_goTo','_shoot']) timed(bot,key,'bot.'+key);
        timed(debug.nav,'path','nav.path');
        patch(debug.physics,'_step',original => function (body,...args) {
          const start=now();try{return original.call(this,body,...args);}finally{record('physics.step.'+body.type,now()-start);}
        });
        const wrapUnit=unit=>{for(const key of ['_brain','_think','_plan'])timed(unit,key,'k9.'+key);};
        for(const pool of debug.match.k9.pool)for(const unit of pool)wrapUnit(unit);
        patch(debug.match.k9,'_make',original=>function(...args){const unit=original.apply(this,args);wrapUnit(unit);return unit;});
        for (const key of ['linkProgram','getProgramInfoLog','getShaderInfoLog','getProgramParameter','getActiveUniform','getActiveAttrib','getUniformLocation','getAttribLocation'])
          patch(gl,key,original=>function(object,...args){
            let id=object && queryIDs.get(object);if(object && !id){id=nextQueryID++;queryIDs.set(object,id);}
            const t=now();try{return original.call(this,object,...args);}finally{
              const ms=now()-t;add(driverTotals,key,ms);
              if(driverQueries.length<4096 && (ms>=.5 || key==='getProgramInfoLog'))driverQueries.push({t,ms,key,id,parameter:args[0],frame:activeFrame,
                tick:window.GH.benchmark?.tick ?? null,pass:passLabel,preparation:gfx.preparation?.pending || false});
            }
          });
        patch(gfx.renderer.shadowMap,'render',original=>function(...args){
          const start=now(),before=gfx.renderer.info.render.calls,trianglesBefore=gfx.renderer.info.render.triangles,requested=this.needsUpdate;
          try{return original.apply(this,args);}finally{
            const ms=now()-start,draws=gfx.renderer.info.render.calls-before;
            shadowCalls++;shadowDraws+=draws;record('shadow.render',ms);
            if(draws && shadowPasses.length<7200)shadowPasses.push({t:start,ms,draws,triangles:gfx.renderer.info.render.triangles-trianglesBefore,
              requested,frame:activeFrame,tick:window.GH.benchmark?.tick ?? null,pass:passLabel});
          }
        });
      }
      patch(debug.match, "createBots", original => function (...args) {
        const result = original.apply(this, args); wrapBots(); return result;
      });
      patch(gfx, "preRender", original => function (...args) {
        const start = now(); reflectionDepth++;
        try { return original.apply(this, args); }
        finally { reflectionDepth--; record("reflection.total", now() - start); }
      });
      patch(gfx.renderer, "render", original => function (scene, camera, ...args) {
        const description = describe(scene, camera), start = now();
        const priorPass=passLabel,drawsBefore=this.info.render.calls,shadowBefore=shadowDraws;
        const renderTarget=this.getRenderTarget();
        passLabel=description.label;
        const matrixKey = scene === gfx.scene ? "matrix.world" : scene === gfx.vmScene ? "matrix.VM" : "";
        const matrixMS = parts[matrixKey]?.ms || 0, matrixCalls = parts[matrixKey]?.calls || 0;
        try { return original.call(this, scene, camera, ...args); }
        finally {
          const ms = now() - start;
          record(`render.${description.label}`, ms);
          buffers.renderCalls.push({ t: start, frame: activeFrame, phase, ...description, ms,
            draws:this.info.render.calls-drawsBefore,shadowDraws:shadowDraws-shadowBefore,
            target:renderTarget?.uuid || 'screen',tick:window.GH.benchmark?.tick ?? null,
            matrixMS: (parts[matrixKey]?.ms || 0) - matrixMS,
            matrixCalls: (parts[matrixKey]?.calls || 0) - matrixCalls });
          passLabel=priorPass;
        }
      });
      patch(gfx, "render", original => function (...args) {
        const start = now(), framePhase = phase;
        frameNumber++; activeFrame = frameNumber;
        pollGPU();
        const query = beginGPU(), cpuStart = now();
        let failed = false;
        try { return original.apply(this, args); }
        catch (failure) { failed = true; throw failure; }
        finally {
          const cpuMS = now() - cpuStart;
          if (query) {
            try { gl.endQuery(extension.TIME_ELAPSED_EXT); query.reflection = (parts["reflection.total"]?.calls || 0) > 0; queries.push(query); }
            catch (failure) { error(failure); try { gl.deleteQuery(query.query); } catch {} gpuDropped++; }
          }
          record("gfx.render", cpuMS);
          buffers.frames.push({ frame: frameNumber, t: start, phase: framePhase,
            interval: previous ? start - previous : null, cpuMS, parts,
            state: window.GH.G.state, hidden: document.hidden, warming: !!gfx._warming,
            pending: !!gfx.preparation?.pending, quality: gfx.quality, scale: gfx.q.scale,
            calls: gfx.renderer.info.render.calls, triangles: gfx.renderer.info.render.triangles, failed });
          previous = start; parts = {}; activeFrame = 0;
        }
      });
      installed = true;
      api.mark("installed");
      return api;
    },
    mark(label) { phase = String(label); buffers.marks.push({ t: now(), phase });
      if(deepEnabled){performance.mark('gh-diag-'+phase);console.timeStamp('gh-diag-'+phase);} },
    reset() {
      dropQueries();
      for (const buffer of Object.values(buffers)) buffer.clear();
      parts = {}; totals = {}; previous = frameNumber = activeFrame = gpuSkipped = gpuDropped = 0;
      driverQueries.length=shadowPasses.length=0;for(const key of Object.keys(driverTotals))delete driverTotals[key];
      shadowCalls=shadowDraws=0;
      api.mark(phase);
    },
    export() {
      pollGPU();
      return { version: 1, installed, inclusiveTimings: true, phase, limits,
        dropped: Object.fromEntries(Object.entries(buffers).map(([key, buffer]) => [key, buffer.dropped])),
        gpuSupported: !!extension, gpuEnabled, gpuPending: queries.length, gpuSkipped, gpuDropped,
        gpuSampling: { everyFrames: 11, frameJoin: "gpu.frame = frames.frame",
          reflectionIndicator: "gpu.reflection; also frames.parts['reflection.total'].calls" },
        totals, ...Object.fromEntries(Object.entries(buffers).map(([key, buffer]) => [key, buffer.values()])),
        deep:{enabled:deepEnabled,timeOrigin:performance.timeOrigin,driverTotals,driverQueries,shadowPasses,shadowCalls,shadowDraws,
          programs:deepEnabled?gfx.renderer.info.programs.map(p=>({id:queryIDs.get(p.program),rendererID:p.id,cacheKey:p.cacheKey})).filter(p=>p.id):[],
          queryID:'WeakMap ID of existing WebGL program/shader object; no extra GL queries',
          limits:'Passive wrappers add diagnostic overhead. No browser trace collected by this exporter.'},
        environment: gfx ? { ua: navigator.userAgent, dpr: devicePixelRatio,
          viewport: [innerWidth, innerHeight], quality: gfx.quality, scale: gfx.q.scale,
          canvas: [gfx.renderer.domElement.width, gfx.renderer.domElement.height] } : null };
    },
    restore() {
      for (let i = patches.length - 1; i >= 0; i--) {
        const item = patches[i];
        if (item.object[item.key] === item.wrapped) item.object[item.key] = item.original;
        else error(`Later wrapper owns ${item.key}; it was left unchanged`);
      }
      patches = []; dropQueries(); installed = false;
      return api;
    },
  };
})();
