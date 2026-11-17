// Explicit diagnostic only. No import-time work, extra RAF, simulation or RNG.
export const LOOP_COST_PHASES = [
  "player.hit.arsenal", "combat.bots", "match", "physics", "glass", "VM",
  "world.callbacks", "FX", "camera", "FPbody", "lighting.sun", "post.listener",
  "audio.present", "HUD.present", "render", "input.endFrame", "loop.other",
];
const N = LOOP_COST_PHASES.length, GROUPS = 8, SLOTS = 4;
const key = (group, slot, phase) => (group * SLOTS + slot) * N + phase;

/** Install after GH.ready. Keep this run separate from primary FPS evidence. */
export function installLoopCostObserver(GH = globalThis.GH, options = {}) {
  if (!GH?.ready || !GH.debug?.gfx || !GH.loopStats) throw Error("Install after GH.ready and native loop initialization");
  if (GH.loopObserver?.active) throw Error("Loop cost observer already active");
  const perf = options.performance || globalThis.performance;
  const capacity = Math.max(1, Math.min(65536, Math.floor(Number(options.capacity) || 4096)));
  const phaseMS = new Float64Array(GROUPS * SLOTS * N);
  const entries = new Float64Array(phaseMS.length), calls = new Float64Array(phaseMS.length);
  const uploadBytes = new Float64Array(phaseMS.length), uploadCalls = new Float64Array(phaseMS.length);
  const allocatedBytes = new Float64Array(phaseMS.length);
  const callbacks = new Float64Array(GROUPS), callbackMS = new Float64Array(GROUPS);
  const callbackMax = new Float64Array(GROUPS), actualTicks = new Float64Array(GROUPS);
  const tickMS = new Float64Array(GROUPS * 3), ticks = new Float64Array(GROUPS * 3);
  const nativeCallbacks = new Float64Array(GROUPS), playingCallbacks = new Float64Array(GROUPS);
  // Eight numeric fields per callback; no row, array or closure per tick/callback.
  const rows = new Float64Array(capacity * 8), patches = [];
  let inCallback = false, inTick = false, group = 0, slot = 3, current = 16;
  let callbackStart = 0, tickStart = 0, stamp = 0, total = 0, ran = 0, due = false, fixed = false;
  let recorded = 0, clocks = 0, transitions = 0, incompleteTicks = 0, abortedCallbacks = 0;
  let ignoredUploads = 0, unknownUploadSizes = 0;
  const readClock = () => { clocks++; return perf.now(); };
  function flush(t) { phaseMS[key(group, slot, current)] += Math.max(0, t - stamp); stamp = t; }
  function enter(phase, count = 1) {
    if (!inCallback) return;
    const t = readClock(); flush(t); current = phase;
    const i = key(group, slot, phase); entries[i]++; calls[i] += count; transitions++;
  }
  function payloadBytes(source, offset, length) {
    if (!source || !Number.isFinite(source.byteLength)) { unknownUploadSizes++; return 0; }
    const element = source.BYTES_PER_ELEMENT || 1;
    const remaining = Math.max(0, source.byteLength - (offset || 0) * element);
    return length ? Math.min(remaining, length * element) : remaining;
  }
  function upload(bytes, allocation = false) {
    if (!inCallback) { ignoredUploads++; return; }
    const i = key(group, slot, current); uploadCalls[i]++;
    if (allocation) allocatedBytes[i] += bytes; else uploadBytes[i] += bytes;
  }
  const api = {
    active: true,
    beginCallback(planned, renderDue, nativeFixed, playing) {
      total = planned; due = renderDue; fixed = nativeFixed; ran = 0;
      group = planned * 2 + (renderDue ? 1 : 0); slot = 3; current = 16;
      callbackStart = stamp = readClock(); inCallback = true; inTick = false;
      nativeCallbacks[group] += nativeFixed ? 1 : 0; playingCallbacks[group] += playing ? 1 : 0;
    },
    beginTick(index) {
      const t = readClock(); flush(t); slot = index; current = 16;
      tickStart = stamp = t; inTick = true; ran++;
    },
    enter,
    endTick() {
      const t = readClock(); flush(t);
      tickMS[group * 3 + slot] += Math.max(0, t - tickStart); ticks[group * 3 + slot]++;
      slot = 3; current = 16; stamp = t; inTick = false;
    },
    endCallback(completed) {
      const t = readClock(); flush(t);
      if (inTick) { incompleteTicks++; inTick = false; }
      if (!completed) abortedCallbacks++;
      const elapsed = Math.max(0, t - callbackStart);
      callbacks[group]++; callbackMS[group] += elapsed; callbackMax[group] = Math.max(callbackMax[group], elapsed);
      actualTicks[group] += ran;
      const i = (recorded % capacity) * 8;
      rows[i] = recorded + 1; rows[i + 1] = callbackStart; rows[i + 2] = elapsed;
      rows[i + 3] = total; rows[i + 4] = ran; rows[i + 5] = due ? 1 : 0;
      rows[i + 6] = fixed ? 1 : 0; rows[i + 7] = completed ? 1 : 0;
      recorded++; inCallback = false;
    },
    reset() {
      if (inCallback) throw Error("Reset outside a game callback");
      for (const a of [phaseMS, entries, calls, uploadBytes, uploadCalls, allocatedBytes,
        callbacks, callbackMS, callbackMax, actualTicks, tickMS, ticks, nativeCallbacks, playingCallbacks, rows]) a.fill(0);
      recorded = clocks = transitions = incompleteTicks = abortedCallbacks = ignoredUploads = unknownUploadSizes = 0;
    },
    export() {
      const groups = [];
      for (let g = 0; g < GROUPS; g++) {
        if (!callbacks[g]) continue;
        const scopes = [];
        for (let s = 0; s < SLOTS; s++) {
          const phases = [];
          for (let p = 0; p < N; p++) {
            const i = key(g, s, p);
            if (!entries[i] && !phaseMS[i] && !uploadCalls[i]) continue;
            phases.push({ name: LOOP_COST_PHASES[p], entries: entries[i], calls: calls[i],
              cpuMS: phaseMS[i], uploadCalls: uploadCalls[i], uploadPayloadBytes: uploadBytes[i], bufferAllocationBytes: allocatedBytes[i] });
          }
          if (phases.length) scopes.push({ tickIndex: s === 3 ? null : s,
            ticks: s === 3 ? null : ticks[g * 3 + s],
            inclusiveTickMS: s === 3 ? null : tickMS[g * 3 + s], phases });
        }
        groups.push({ plannedTicks: g >> 1, renderDue: !!(g & 1), callbacks: callbacks[g],
          nativeFixedCallbacks: nativeCallbacks[g], playingCallbacks: playingCallbacks[g],
          actualTicks: actualTicks[g], inclusiveCallbackMS: callbackMS[g], maxCallbackMS: callbackMax[g], scopes });
      }
      const retained = Math.min(recorded, capacity), raw = [];
      for (let n = recorded - retained; n < recorded; n++) raw.push(Array.from(rows.subarray((n % capacity) * 8, (n % capacity) * 8 + 8)));
      return { schema: "gh-loop-cost-v1", diagnosticOnly: true, active: api.active,
        timingModel: "Renderer main-thread wall time. Callback and tick totals are inclusive parents: do not add them to child phases. Phases are sequential, non-overlapping intervals within a scope; nested game work remains inclusive in its containing phase.",
        scope: "Callback begins after original mode/debt planning; preparation early returns are outside this observer. No extra RAF, simulation, render, input, RNG or GPU timer.",
        callsMeaning: "Phase entries, except combat.bots calls count native bot update/idle calls and world.callbacks count callbacks; no per-small-call timing.",
        uploadModel: "Optional GL bufferData/SubData argument payload bytes, not driver traffic or deferred needsUpdate bytes. Number bufferData allocations are separate. Texture uploads excluded; outside-callback uploads ignored.",
        groups, callbackColumns: ["id", "startMS", "inclusiveMS", "plannedTicks", "actualTicks", "renderDue", "nativeFixed", "completed"], callbacks: raw,
        coverage: { total: recorded, retained, dropped: recorded - retained, capacity, incompleteTicks, abortedCallbacks },
        overhead: { clockReads: clocks, phaseTransitions: transitions, uploadsEnabled: options.uploads === true,
          note: "No automatic overhead subtraction; compare observer-off primary FPS separately. Export/reset allocate outside measurement; hot paths use preallocated numeric arrays." },
        uploads: { ignoredOutsideCallbacks: ignoredUploads, unknownArgumentSizes: unknownUploadSizes }, source: options.source || null };
    },
    stop() {
      if (inCallback) throw Error("Stop outside a game callback");
      api.active = false;
      for (const [owner, name, wrapped, original] of patches) if (owner[name] === wrapped) owner[name] = original;
      patches.length = 0;
    },
  };
  if (options.uploads === true) {
    const gl = GH.debug.gfx.renderer.getContext();
    const data = gl.bufferData, sub = gl.bufferSubData;
    function bufferData(target, source, usage, sourceOffset, length) {
      const result = data.apply(this, arguments);
      if (api.active) {
        if (typeof source === "number") upload(source, true);
        else upload(payloadBytes(source, sourceOffset, length));
      }
      return result;
    }
    function bufferSubData(target, destinationOffset, source, sourceOffset, length) {
      const result = sub.apply(this, arguments);
      if (api.active) upload(payloadBytes(source, sourceOffset, length));
      return result;
    }
    gl.bufferData = bufferData; gl.bufferSubData = bufferSubData;
    patches.push([gl, "bufferData", bufferData, data], [gl, "bufferSubData", bufferSubData, sub]);
  }
  GH.loopObserver = api;
  return api;
}
