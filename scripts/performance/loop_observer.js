/* Diagnostic INIT script. Wraps requested callbacks; requests ZERO new RAFs.
 * API: __loopPhase.mark(label), reset(label), export(), restore().
 * No core/FPS/cadence/clock changes. Install before the native animation loop.
 */
(() => {
  'use strict';
  if (globalThis.__loopPhase) throw Error('loop-phase observer already installed');
  const win = globalThis, now = performance.now.bind(performance);
  const nativeRAF = win.requestAnimationFrame;
  const rafDescriptor = Object.getOwnPropertyDescriptor(win, 'requestAnimationFrame');
  const limit = 32768, callbackLimit = 4096, orphanLimit = 128;
  const rows = [], orphans = [], labels = ['init'], modes = [], callbacks = [], marks = [];
  const ids = new WeakMap(), gameIDs = new Set(), objectIDs = new WeakMap();
  let nextObjectID = 1, sequence = 0, requestSequence = 0, phase = 0, active = true, current = null;
  let dropped = 0, orphanDropped = 0, callbackDropped = 0, attached = null;
  const hooks = [], restoreConflicts = [];
  function objectID(value) {
    if (!value || typeof value !== 'object' && typeof value !== 'function') return 0;
    let id = objectIDs.get(value);
    if (!id) objectIDs.set(value, id = nextObjectID++);
    return id;
  }
  function index(values, value) {
    let id = values.indexOf(value);
    if (id < 0) id = values.push(value) - 1;
    return id;
  }
  function callbackID(fn) {
    let id = ids.get(fn);
    if (id !== undefined) return id;
    if (callbacks.length >= callbackLimit) { callbackDropped++; ids.set(fn,0); return 0; }
    id = callbacks.length + 1;
    ids.set(fn, id);
    callbacks.push({id, name:fn.name || '', arity:fn.length});
    return id;
  }
  function attach() {
    const gfx = win.GH?.debug?.gfx;
    if (!gfx || gfx === attached || typeof gfx.render !== 'function' || hooks.length >= 16) return;
    attached = gfx;
    const own = Object.getOwnPropertyDescriptor(gfx, 'render'), original = gfx.render;
    function observedRender(...args) {
      if (!active) return Reflect.apply(original, this, args);
      const stats = win.GH?.loopStats;
      const sample = {before:now(), after:0, tick:stats?.logicalTicks ?? null,
        submittedBefore:stats?.renderFrames ?? null, dt:args[0], error:false};
      const parent = current;
      try { return Reflect.apply(original, this, args); }
      catch (error) { sample.error=true; throw error; }
      finally {
        sample.after=now();
        if (parent) {
          parent.renderCount++;
          parent.renderCPU += sample.after-sample.before;
          if (parent.renders.length < 8) parent.renders.push(sample);
          else parent.renderSamplesDropped++;
          if (parent.callbackID) gameIDs.add(parent.callbackID);
        } else if (orphans.length < orphanLimit) orphans.push({...sample, phase});
        else orphanDropped++;
      }
    }
    gfx.render = observedRender;
    hooks.push({gfx, own, original, wrapper:observedRender});
  }
  function observedRAF(callback) {
    // Preserve native validation of non-callable arguments and return handles.
    if (typeof callback !== 'function') return Reflect.apply(nativeRAF,this,[callback]);
    const requestAt=now(), requestID=++requestSequence, requestedFrom=current?.sequence ?? null;
    let requestReturnAt=null, nativeHandle=null;
    nativeHandle=Reflect.apply(nativeRAF, this, [function observedCallback(timestamp, ...args) {
      if (!active) return Reflect.apply(callback, this, [timestamp,...args]);
      const entry = now();
      attach();
      const stats = win.GH?.loopStats, gfx = win.GH?.debug?.gfx;
      // Do not spend callback identities on transient boot/warmup polling.
      const id = stats ? callbackID(callback) : 0;
      const benchmark = win.GH?.benchmark;
      const row = stats ? {sequence:++sequence, callbackID:id, phase,
        requestID, requestAt, requestReturnAt, requestedFrom, nativeHandle,
        timestamp, entry, exit:0, tickBefore:stats.logicalTicks, tickAfter:null,
        submittedBefore:stats.renderFrames, submittedAfter:null,
        clockID:objectID(stats), benchmarkID:objectID(benchmark),
        mode:index(modes, stats.mode ?? ''), modeAfter:null,
        hidden:!!document.hidden, prepBefore:!!gfx?.preparation?.pending,
        prepErrorBefore:!!gfx?.preparation?.error,
        online:!!document.body?.classList?.contains('online-session'),
        compatibility:!!benchmark?.fixedDelta && benchmark.followNativeLoop !== true,
        renderCount:0, renderCPU:0, renders:[],renderSamplesDropped:0,error:false} : null;
      const previous = current; current = row;
      try { return Reflect.apply(callback, this, [timestamp,...args]); }
      catch (error) { if(row) row.error=true; throw error; }
      finally {
        if(row) {
          const after=win.GH?.loopStats;
          row.exit=now(); row.tickAfter=after?.logicalTicks ?? null;
          row.submittedAfter=after?.renderFrames ?? null;
          row.modeAfter=index(modes,after?.mode ?? '');
          row.prepAfter=!!gfx?.preparation?.pending;
          row.droppedDebt=after?.dropped ?? null;
          if(row.tickAfter>row.tickBefore && id) gameIDs.add(id);
          if(rows.length<limit) rows.push(row); else dropped++;
        }
        current=previous;
      }
    }]);
    requestReturnAt=now();
    return nativeHandle;
  }
  win.requestAnimationFrame=observedRAF;
  const api = win.__loopPhase = {
    kind:'passive-existing-RAF-and-native-gfx-render-v1',
    mark(label) {
      phase=labels.length < 256 ? index(labels,String(label)) : 0;
      if(marks.length<512) marks.push({phase,at:now(),tick:win.GH?.loopStats?.logicalTicks ?? null});
      return phase;
    },
    reset(label='reset') {
      rows.length=orphans.length=marks.length=0;
      dropped=orphanDropped=0;
      api.mark(label);
    },
    export() {
      return {kind:api.kind,active,limits:{rows:limit,callbacks:callbackLimit,orphanRenders:orphanLimit},
        dropped,rawDropped:dropped,orphanDropped,callbackDropped,labels:[...labels],modes:[...modes],
        callbacks:[...callbacks],gameCallbackIDs:[...gameIDs],marks:[...marks],rows:[...rows],
        orphanRenders:[...orphans],restoreConflicts:[...restoreConflicts],
        metadata:{userAgent:navigator.userAgent,timeOrigin:performance.timeOrigin,
          devicePixelRatio:win.devicePixelRatio,width:win.innerWidth,height:win.innerHeight,
          visibilityState:document.visibilityState},
        contract:['No extra requestAnimationFrame, timers, GPU queries, FPS override or simulation work.',
          'gameCallbackIDs inferred from render or logical-tick activity; filter rows by these IDs after capture.',
          'timestamp is native RAF timestamp; entry/exit and render before/after are performance.now in the same time origin.',
          'requestAt/requestReturnAt locate the actual existing RAF request call; requestedFrom links the issuing callback row, if any.',
          'tickBefore/tickAfter are actual loopStats counters, not guessed simulation calls.',
          'Instrumentation has observer CPU cost. This capture is diagnostic, not clean primary performance.',
          'Callback return/throw and native cancellation handles are preserved; scheduled wrappers become pass-through after restore.']};
    },
    restore() {
      active=false;
      if(win.requestAnimationFrame===observedRAF) {
        if(rafDescriptor) Object.defineProperty(win,'requestAnimationFrame',rafDescriptor);
        else delete win.requestAnimationFrame;
      } else restoreConflicts.push('requestAnimationFrame has a later owner');
      for(const hook of hooks) {
        if(hook.gfx.render!==hook.wrapper) { restoreConflicts.push('gfx.render has a later owner'); continue; }
        if(hook.own) Object.defineProperty(hook.gfx,'render',hook.own);
        else delete hook.gfx.render;
      }
      return {active,restoreConflicts:[...restoreConflicts]};
    }
  };
})();
