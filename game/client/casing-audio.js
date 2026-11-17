// Default-off experiment. The original T voice still owns admission, spatial
// routing, gain, reverb and release. Only its casing source subgraph is pooled.
const toneKeys = new Set(["t","a","hold","d","g","f","f1","ft","type","dest"]);
const noiseKeys = new Set(["t","a","hold","d","g","f","q","rate","type","buf","dest"]);
// Stable bounded reason labels; do not accumulate arbitrary descriptor keys.
export function casingSourceRejection(sources) {
  if (!sources.length || sources.length > 32) return "source-count";
  for (const {kind,options:q} of sources) {
    if (kind !== "tone" && kind !== "noise") return "source-kind";
    const keys = kind === "tone" ? toneKeys : noiseKeys;
    if (Object.keys(q).some(key=>!keys.has(key))) return "unknown-property";
    // partials owns a dest key even when its omitted parameter is undefined.
    // Null/undefined both use the original sum. Real alternate routing does not.
    if (q.dest != null) return "custom-routing";
    if (!Number.isFinite(q.f) || !(q.f > 0)
      || ![q.t??0,q.a??.001,q.hold??0,q.d??.1,q.g??1,q.f1??1,q.ft??1,q.q??.7,q.rate??1].every(v=>Number.isFinite(v)&&v>=0)
      || !((q.a??.001)>0 && (q.d??.1)>0 && (q.ft??1)>0 && (q.rate??1)>0 && (q.q??.7)>0)) return "numeric-range";
    if (kind === "tone" ? q.type && q.type !== "sine"
      : !["bandpass","lowpass","highpass"].includes(q.type) || q.buf && q.buf !== "white") return "waveform-or-buffer";
  }
  return null;
}
export function supportsCasingSources(sources) { return casingSourceRejection(sources) === null; }
export function createCasingAudio(context, white, { register = node => node,
  unregister = node => node.disconnect(), Node = globalThis.AudioWorkletNode,
  slots = 12, timeoutMs = 5000 } = {}) {
  const stats = { status: "preparing", slots, leased: 0, peak: 0, submitted: 0,
    fallback: 0, processorErrors: 0, lateCues: 0, lateFrames: 0, maxLateFrames: 0,
    firstSamples: 0, maxSourceOnsetDelayFrames: 0, warmed: 0, expiredSources: 0,
    descriptorFallback: 0, descriptorReasons: {}, apiPastStartSources: 0, deliveryMissCues: 0, maxDeliveryMissFrames: 0,
    timings: [], timingDropped: 0,
    maxCommandLeadFrames: 0, minCommandLeadFrames: null };
  const pool = [], api = { stats, ready: null, lease };
  function fail(error) {
    stats.status = "failed";
    stats.error = String(error?.message || error);
  }
  api.ready = (async () => {
    if (!context.audioWorklet || !Node || !white?.getChannelData
      || ![44100,48000].includes(context.sampleRate) || white.sampleRate !== context.sampleRate) {
      stats.status = "unsupported";
      return;
    }
    let timer;
    try {
      await Promise.race([
        (async () => {
          await context.audioWorklet.addModule(new URL("./casing-worklet.js", import.meta.url));
          if (stats.status === "failed") return;
          await Promise.all(Array.from({ length: slots }, () => new Promise((resolve, reject) => {
            const node = register(new Node(context, "gh-casing-source", {
              numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
              processorOptions: { white: white.getChannelData(0) },
            }));
            const slot = { node, token: 0, busy: false };
            pool.push(slot);
            node.onprocessorerror = () => {
              stats.processorErrors++;
              fail("casing AudioWorklet processor error");
              reject(Error(stats.error));
            };
            node.port.onmessage = ({ data }) => {
              if (data.type === "ready") { stats.warmed++; resolve(); }
              if (data.type === "accepted") {
                const timing = stats.timings[data.cueId-1];
                if (timing) { timing.arrivalFrame=data.arrivalFrame; timing.expiredSources=data.expiredSources; }
                stats.expiredSources += data.expiredSources || 0;
                if (data.deliveryMissFrames > 0) {
                  stats.deliveryMissCues++;
                  stats.maxDeliveryMissFrames = Math.max(stats.maxDeliveryMissFrames,data.deliveryMissFrames);
                }
                const lead = data.leadFrames;
                stats.minCommandLeadFrames = Math.min(stats.minCommandLeadFrames ?? lead, lead);
                stats.maxCommandLeadFrames = Math.max(stats.maxCommandLeadFrames, lead);
                if (lead < 0) {
                  stats.lateCues++;
                  stats.lateFrames += -lead;
                  stats.maxLateFrames = Math.max(stats.maxLateFrames, -lead);
                }
              }
              if (data.type === "firstSample") {
                const timing = stats.timings[data.cueId-1];
                if (timing) timing.firstNonzeroFrame=data.frame;
                stats.firstSamples++;
                stats.maxSourceOnsetDelayFrames = Math.max(stats.maxSourceOnsetDelayFrames, data.frame-data.scheduledFrame);
              }
            };
          })));
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error("casing worklet warm timeout")), timeoutMs); }),
      ]);
      if (stats.status !== "failed") stats.status = "ready";
    } catch (error) {
      fail(error);
      for (const { node } of pool) { unregister(node); node.port.close?.(); }
      pool.length = 0;
    } finally { clearTimeout(timer); }
  })();
  function lease(destination) {
    const slot = stats.status === "ready" && pool.find(slot => !slot.busy);
    if (!slot) { stats.fallback++; return null; }
    slot.busy = true;
    const token = ++slot.token;
    stats.leased++;
    stats.peak = Math.max(stats.peak, stats.leased);
    slot.node.connect(destination);
    let released = false;
    return {
      submit(commands, originals) {
        const rejection = stats.status !== "ready" ? "not-ready" : casingSourceRejection(originals);
        if (rejection) {
          stats.fallback++; stats.descriptorFallback++;
          stats.descriptorReasons[rejection] = (stats.descriptorReasons[rejection] || 0)+1;
          return false;
        }
        const cueId = ++stats.submitted;
        const requestedFrame = Math.ceil(Math.min(...commands.map(c=>c.start))*context.sampleRate);
        const effectiveMainFrame = Math.ceil(Math.min(...commands.map(c=>Math.max(c.start,c.issuedAt)))*context.sampleRate);
        stats.apiPastStartSources += commands.filter(c=>c.issuedAt>c.start).length;
        if (stats.timings.length < 2048) stats.timings.push({cueId,token,requestedFrame,effectiveMainFrame,
          arrivalFrame:null,firstNonzeroFrame:null}); else stats.timingDropped++;
        slot.node.port.postMessage({ type: "cue", token, cueId, commands });
        return true;
      },
      stop(at) { slot.node.port.postMessage({ type: "stop", token, at }); },
      release() {
        if (released) return;
        released = true;
        slot.node.port.postMessage({ type: "release", token });
        slot.node.disconnect();
        slot.busy = false;
        stats.leased--;
      },
    };
  }
  return api;
}
