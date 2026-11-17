import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractAudioOwner, estimateOutputStart } from "../scripts/performance/audio_latency_probe.js";

test("output mapping uses related output clocks once; latency properties are metadata, not added", () => {
  const sample = { state: "running", currentTime: 2.005, sampleRate: 48000, afterMS: 1010,
    timestamp: { contextTime: 1.9, performanceTime: 1000 }, baseLatency: .01, outputLatency: .05 };
  const result = estimateOutputStart(sample, 2.003, 1000);
  assert.equal(result.valid, true); assert.ok(Math.abs(result.estimatedMS - 103) < 1e-9);
  assert.ok(result.estimatedMS > 20, "a real budget exceedance is not adjusted by subtracting latency metadata");
  for (const patch of [ { timestamp: { contextTime: 0, performanceTime: 0 } },
    { afterMS: 1300 }, { state: "suspended" }, { currentTime: 1 },
    { timestamp: { contextTime: 1.9, performanceTime: 1100 } } ])
    assert.equal(estimateOutputStart({ ...sample, ...patch }, 2.003, 1000).valid, false);
  assert.equal(estimateOutputStart(sample, 1.8, 1000).valid, false);
});

test("actual qc→eZ/T/S0 owner runs native dry metal/brass without initE/Dw/B$ dependencies", () => {
  const owner = extractAudioOwner(readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8"));
  function run() {
    let seed = 8171, created = 0; const starts = [], draws = [];
    const math = Object.create(Math);
    math.random = () => { const v = ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); draws.push(v); return v; };
    const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
    const node = () => { created++; return { gain: param(), frequency: param(), Q: param(), playbackRate: param(),
      connect() {}, disconnect() {}, start(...args) { starts.push(args); }, stop() {} }; };
    const ctx = { currentTime: 2, sampleRate: 48000, createGain: node, createBiquadFilter: node,
      createBufferSource: node, createOscillator: node };
    const api = new Function("Math", owner + "\nreturn eZ();")(math), state = api._engine;
    Object.assign(state, { ctx, nyq: 21600, revIn: node() }); state.bus.sfx = node(); state.buf.white = { duration: 3 };
    for (let i = 0; i < 6; i++) api.casing(null, "metal", "brass");
    assert.deepEqual(api._errors, []); assert.equal(state.voices.length, 6); assert.ok(starts.length > 6);
    assert.ok(state.voices.every(v => v.t === 2.003 && v.cat === "casing"));
    return { draws, created, starts, voices: state.voices.map(v => [v.rate, v.st, v.level, v.srcs.length, v.nodes.length]) };
  }
  assert.deepEqual(run(), run(), "same native source/seed/manual white graph produces identical descriptors in both arms");
  assert.throws(() => extractAudioOwner("unknown source"), /boundary/);
});
