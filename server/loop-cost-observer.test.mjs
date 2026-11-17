import test from "node:test";
import assert from "node:assert/strict";
import { installLoopCostObserver } from "../game/client/loop-cost-observer.js";

function fixture(options = {}) {
  let time = 0, nativeCalls = 0;
  const data = function () { nativeCalls++; return 17; }, sub = function () { nativeCalls++; return 23; };
  const gl = { bufferData: data, bufferSubData: sub };
  const GH = { ready: true, loopStats: {}, debug: { gfx: { renderer: { getContext: () => gl } } } };
  const observer = installLoopCostObserver(GH, { performance: { now: () => time }, ...options });
  return { observer, GH, gl, data, sub, advance: ms => { time += ms; }, nativeCalls: () => nativeCalls };
}

test("bounded numeric callback ring reports drops while all-callback aggregate is retained", () => {
  const f = fixture({ capacity: 2 }), o = f.observer;
  for (let i = 0; i < 4; i++) {
    o.beginCallback(0, false, true, true); f.advance(i + 1); o.endCallback(true);
  }
  const result = o.export();
  assert.deepEqual(result.callbacks.map(r => r[0]), [3, 4]);
  assert.deepEqual(result.coverage, { total: 4, retained: 2, dropped: 2, capacity: 2, incompleteTicks: 0, abortedCallbacks: 0 });
  assert.equal(result.groups[0].inclusiveCallbackMS, 10);
  assert.equal(result.groups[0].maxCallbackMS, 4);
  assert.equal(result.overhead.clockReads, 8);
});

test("optional GL upload counters preserve calls/returns and WebGL2 typed-array offset/length units", () => {
  const f = fixture({ uploads: true }), o = f.observer;
  o.beginCallback(1, true, true, true); o.beginTick(0); o.enter(7);
  assert.equal(f.gl.bufferSubData(1, 0, new Float32Array(10), 2, 3), 23); // 12 payload bytes
  assert.equal(f.gl.bufferSubData(1, 0, new Uint16Array(10), 3, 0), 23); // 14 remaining bytes
  assert.equal(f.gl.bufferData(1, new Uint8Array(8), 2), 17); // eight payload bytes
  assert.equal(f.gl.bufferData(1, 1024, 2), 17); // storage allocation, not uploaded payload
  assert.equal(f.gl.bufferSubData(1, 0, new DataView(new ArrayBuffer(9)), 1, 3), 23);
  o.endTick(); o.endCallback(true);
  const phase = o.export().groups[0].scopes[0].phases.find(p => p.name === "FX");
  assert.equal(phase.uploadPayloadBytes, 37); assert.equal(phase.bufferAllocationBytes, 1024); assert.equal(phase.uploadCalls, 5);
  f.gl.bufferData(1, new Uint8Array(4), 2);
  assert.equal(o.export().uploads.ignoredOutsideCallbacks, 1);
  o.stop(); assert.equal(f.gl.bufferData, f.data); assert.equal(f.gl.bufferSubData, f.sub);
  assert.equal(f.nativeCalls(), 6);
});

test("throwing GL calls are passed through without recording a successful upload and stop respects another wrapper", () => {
  const f = fixture(); const failure = Error("native upload error");
  f.gl.bufferSubData = () => { throw failure; };
  f.observer.stop();
  const o = installLoopCostObserver(f.GH, { uploads: true, performance: { now: () => 0 } });
  o.beginCallback(0, true, true, true);
  assert.throws(() => f.gl.bufferSubData(1, 0, new Uint8Array(4)), error => error === failure);
  o.endCallback(false);
  assert.ok(o.export().groups[0].scopes.every(s => s.phases.every(p => p.uploadCalls === 0)));
  const wrapped = f.gl.bufferData;
  const later = function () { return wrapped.apply(this, arguments); };
  f.gl.bufferData = later; o.stop(); assert.equal(f.gl.bufferData, later);
  assert.equal(f.gl.bufferData(1, new Uint8Array(4), 2), 17);
  assert.equal(o.export().uploads.ignoredOutsideCallbacks, 0, "an unowned outer wrapper cannot keep recording after stop");
});

test("install is explicit, default leaves GL untouched, and no browser/GPU scheduling API is used", () => {
  const f = fixture();
  assert.equal(f.gl.bufferData, f.data); assert.equal(f.gl.bufferSubData, f.sub);
  assert.equal(f.observer.export().coverage.total, 0);
  assert.throws(() => installLoopCostObserver(f.GH), /already active/);
  f.observer.beginCallback(0, true, true, true);
  assert.throws(() => f.observer.reset(), /outside/);
  assert.throws(() => f.observer.stop(), /outside/);
  f.observer.endCallback(true); f.observer.stop();
  assert.throws(() => installLoopCostObserver({ ready: false }), /GH.ready/);
});
