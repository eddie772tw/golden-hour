// Root-operated hardware diagnostic. No game init/render/DSP edits.
// Output mapping follows https://webaudio.github.io/web-audio-api/#dom-audiocontext-getoutputtimestamp
const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), x => x.toString(16).padStart(2, "0")).join("");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const finite = x => Number.isFinite(x) ? x : null;
export function extractAudioOwner(source) {
  const begin = source.indexOf("  var qc = Math.PI"), end = source.indexOf("  var fo = eZ();", begin);
  if (begin < 0 || end <= begin) throw Error("Unrecognized qc→fo audio boundary");
  const owner = source.slice(begin, end);
  for (const text of ["function eZ()", "class T {", "function S0(", 'casing: S0', "let mt = A0.currentTime + 3e-3"])
    if (!owner.includes(text)) throw Error("Missing native owner contract: " + text);
  return owner;
}
export function estimateOutputStart(sample, requestedStart, eventMS) {
  const reasons = [];
  const t = sample.timestamp;
  if (sample.state !== "running") reasons.push("context-not-running");
  if (!t || !Number.isFinite(t.contextTime) || !Number.isFinite(t.performanceTime) || t.contextTime <= 0 || t.performanceTime <= 0) reasons.push("zero-or-invalid-output-timestamp");
  if (t && Number.isFinite(t.performanceTime)) {
    if (sample.afterMS - t.performanceTime > 250) reasons.push("timestamp-older-than-250ms");
    if (t.performanceTime - sample.afterMS > 5) reasons.push("timestamp-more-than-5ms-in-future");
    if (t.contextTime > sample.currentTime + 1 / sample.sampleRate) reasons.push("output-position-ahead-of-context");
  }
  if (!Number.isFinite(requestedStart) || !Number.isFinite(eventMS)) reasons.push("invalid-event-or-voice-start");
  const estimatedMS = reasons.length ? null : t.performanceTime + 1000 * (requestedStart - t.contextTime) - eventMS;
  if (estimatedMS !== null && estimatedMS < 0) reasons.push("requested-start-maps-before-event");
  return { valid: reasons.length === 0, estimatedMS, reasons };
}

export async function prepareAudioLatencyProbe({ source, expectedSHA256, seed = 8171 } = {}) {
  if (globalThis.__audioLatencyProbe?.prepared) throw Error("Already prepared; use a fresh page");
  const sourceSHA256 = await sha(new TextEncoder().encode(source));
  if (sourceSHA256 !== expectedSHA256) throw Error("Served core source SHA mismatch");
  const owner = extractAudioOwner(source), factory = new Function("Math", owner + "\nreturn eZ();");
  const ownerSHA256 = await sha(new TextEncoder().encode(owner));
  // Identical manual source PCM in every arm; original init E/Dw/B$ is not called.
  const whitePCM = new Float32Array(48000 * 3); let noiseSeed = 131;
  for (let i = 0; i < whitePCM.length; i++) whitePCM[i] = ((noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0) / 2147483648) - 1;
  const whiteSHA256 = await sha(whitePCM.buffer);
  const devices = async () => {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(x => x.kind === "audiooutput").map(x => ({ deviceId: x.deviceId, groupId: x.groupId, label: x.label })); }
    catch (e) { return { error: String(e) }; }
  };
  const result = { schema: "gh-native-audio-latency-v1", prepared: true, done: false, running: false,
    sourceSHA256, ownerSHA256, nativeSourceUnmodified: true, seed, whiteSHA256,
    order: ["interactive", .001, .001, "interactive", "interactive", .001, .001, "interactive"],
    sampleRateRequested: 48000, steadyMS: 2000, cueSpacingMS: 450, cuesPerArm: 6, budgetMS: 20,
    graph: "Actual eZ/T/S0 metal/brass with manual white PCM, nyq=.45*rate, sfx gain1→destination; original reverb input unconnected. No initE, spatial position, master filter/limiter, worklet or game rendering.",
    estimateFormula: "timestamp.performanceTime + 1000*(voice.t - timestamp.contextTime) - eventMS",
    boundary: "Requested native cue-start output-timestamp estimate only; no baseLatency addition, acoustic/loopback recording, whole-game device acceptance or active hardware utilization claim.",
    clockLimits: { maxTimestampAgeMS: 250, maxFutureMS: 5, requirePositiveTimestamp: true, requireRunningAndAdvancing: true },
    devicesBefore: await devices(), deviceChanges: [], arms: [], errors: [],
    protocolSource: "https://webaudio.github.io/web-audio-api/#dom-audiocontext-getoutputtimestamp" };
  navigator.mediaDevices?.addEventListener("devicechange", () => result.deviceChanges.push(performance.now()));
  addEventListener("error", e => result.errors.push(String(e.message)));
  addEventListener("unhandledrejection", e => result.errors.push(String(e.reason)));
  const button = document.querySelector("#probe-arm");
  if (!button) throw Error("Missing #probe-arm user-gesture button");
  globalThis.__audioLatencyProbe = result;
  button.disabled = false;
  button.onclick = async event => {
    if (result.running || result.done) return;
    const arm = { index: result.arms.length, hint: result.order[result.arms.length],
      eventTrusted: event.isTrusted, activationAtHandler: !!navigator.userActivation?.isActive,
      clickMS: performance.now(), samples: [], cues: [], states: [], errors: [] };
    result.arms.push(arm); result.running = true; button.disabled = true;
    let ctx, poll;
    try {
      if (!arm.eventTrusted || !arm.activationAtHandler) throw Error("A trusted active button gesture is required");
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      // Both construction and resume happen synchronously within the real click.
      ctx = new Audio({ sampleRate: 48000, latencyHint: arm.hint });
      arm.activationAtResume = !!navigator.userActivation?.isActive;
      const resumed = ctx.resume();
      arm.createdState = ctx.state; arm.createdMS = performance.now();
      ctx.addEventListener("statechange", () => arm.states.push({ atMS: performance.now(), state: ctx.state }));
      await resumed;
      if (ctx.state !== "running" || ctx.sampleRate !== 48000) throw Error("Running 48k context required");
      arm.sinkId = typeof ctx.sinkId === "object" ? { type: ctx.sinkId.type } : ctx.sinkId ?? null;
      arm.destination = { channels: ctx.destination.channelCount, maxChannels: ctx.destination.maxChannelCount };
      let rngState = seed >>> 0; const draws = [];
      const math = Object.create(Math);
      math.random = () => { if (draws.length >= 4096) throw Error("RNG trace cap"); const v = ((rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0) / 4294967296); draws.push(v); return v; };
      const api = factory(math), state = api._engine;
      const bus = ctx.createGain(), rev = ctx.createGain(); bus.gain.value = 1; rev.gain.value = 1; bus.connect(ctx.destination);
      const white = ctx.createBuffer(1, whitePCM.length, 48000); white.copyToChannel(whitePCM, 0);
      Object.assign(state, { ctx, nyq: ctx.sampleRate * .45, revIn: rev }); state.buf.white = white; state.bus.sfx = bus;
      const sample = tag => {
        if (arm.samples.length >= 256) throw Error("Clock sample cap");
        const beforeMS = performance.now(); let timestamp = null, error = null;
        try { const t = ctx.getOutputTimestamp(); timestamp = { contextTime: t.contextTime, performanceTime: t.performanceTime }; }
        catch (e) { error = String(e); }
        const row = { tag, beforeMS, currentTime: ctx.currentTime, sampleRate: ctx.sampleRate,
          baseLatency: finite(ctx.baseLatency), outputLatency: finite(ctx.outputLatency), state: ctx.state,
          timestamp, error, afterMS: performance.now() };
        arm.samples.push(row); return arm.samples.length - 1;
      };
      sample("resumed"); poll = setInterval(() => {
        try { sample("steady/poll"); }
        catch (e) { arm.errors.push(String(e)); clearInterval(poll); }
      }, 50);
      await sleep(2000); arm.steadyCompleteMS = performance.now();
      for (let n = 0; n < 6; n++) {
        const eventMS = performance.now(), before = sample("cue-before"), voiceCount = state.voices.length;
        api.casing(null, "metal", "brass");
        const voice = state.voices.at(-1), after = sample("cue-after");
        if (state.voices.length !== voiceCount + 1 || api._errors.length) throw Error("Actual native S0 cue failed: " + JSON.stringify(api._errors));
        const cue = { index: n, eventMS, callEndMS: performance.now(), requestedStart: voice.t,
          requestedEnd: voice.end, voice: { cat: voice.cat, rate: voice.rate, st: voice.st, level: voice.level,
            sources: voice.srcs.length, nodes: voice.nodes.length }, sourceCreatedTotal: state.stats.created,
          sampleIndices: [before, after] };
        arm.cues.push(cue);
        await sleep(25); cue.sampleIndices.push(sample("cue-plus25ms"));
        await sleep(Math.max(0, eventMS + 450 - performance.now()));
      }
      arm.nativeErrors = api._errors.slice(); arm.rngDraws = draws.length;
      arm.rngSHA256 = await sha(new Float64Array(draws).buffer); arm.sourceCreated = state.stats.created;
      sample("end");
      let advances = 0, regressions = 0, previous;
      for (const row of arm.samples) if (row.timestamp?.contextTime > 0 && row.timestamp.performanceTime > 0) {
        if (previous) {
          if (row.timestamp.contextTime > previous.contextTime && row.timestamp.performanceTime > previous.performanceTime) advances++;
          if (row.timestamp.contextTime < previous.contextTime || row.timestamp.performanceTime < previous.performanceTime) regressions++;
        }
        previous = row.timestamp;
      }
      arm.clockProgress = { advances, regressions };
      for (const cue of arm.cues) {
        cue.estimates = cue.sampleIndices.map(i => ({ sampleIndex: i, ...estimateOutputStart(arm.samples[i], cue.requestedStart, cue.eventMS) }));
        const valid = cue.estimates.filter(x => x.valid).map(x => x.estimatedMS);
        cue.rangeMS = valid.length ? [Math.min(...valid), Math.max(...valid)] : null;
        cue.valid = valid.length === cue.estimates.length && advances > 0 && regressions === 0;
        cue.gate = valid.some(x => x > 20) ? "fail" : cue.valid ? "pass" : "invalid";
      }
      arm.gate = arm.cues.some(x => x.gate === "fail") ? "fail" : arm.cues.length === 6 && arm.cues.every(x => x.gate === "pass") ? "pass" : "invalid";
      if (arm.errors.length) arm.gate = "invalid";
    } catch (e) { arm.errors.push(String(e?.stack || e)); arm.gate = "invalid"; }
    finally {
      clearInterval(poll);
      if (ctx) {
        arm.beforeClose = { atMS: performance.now(), state: ctx.state, currentTime: ctx.currentTime,
          baseLatency: finite(ctx.baseLatency), outputLatency: finite(ctx.outputLatency) };
        try { await ctx.close(); arm.closedMS = performance.now(); arm.closedState = ctx.state; }
        catch (e) { arm.errors.push("close: " + e); arm.gate = "invalid"; }
      }
      const finished = result.arms.length === 8;
      button.disabled = finished; button.textContent = finished ? "Completed all arms" : "Start next context (" + (result.arms.length + 1) + "/8)";
      if (finished) {
        result.devicesAfter = await devices();
        result.sameRNG = new Set(result.arms.map(x => x.rngSHA256)).size === 1 && result.arms.every(x => !!x.rngSHA256);
        result.sameGraphShape = new Set(result.arms.map(x => JSON.stringify(x.cues.map(c => [c.voice, c.sourceCreatedTotal])))).size === 1;
        result.sameSinkMetadata = new Set(result.arms.map(x => JSON.stringify(x.sinkId))).size === 1 && !result.deviceChanges.length && JSON.stringify(result.devicesBefore) === JSON.stringify(result.devicesAfter);
        result.comparable = result.sameRNG && result.sameGraphShape && result.sameSinkMetadata && result.arms.every(x => x.closedState === "closed");
        result.endpointLimit = "Default browser sink/device metadata only; unchanged IDs do not prove the OS endpoint was never rerouted. No permissions or setSinkId override.";
      }
      result.done = finished; result.running = false;
    }
  };
  return { prepared: true, sourceSHA256, ownerSHA256, whiteSHA256, order: result.order };
}
globalThis.__prepareAudioLatencyProbe = prepareAudioLatencyProbe;
