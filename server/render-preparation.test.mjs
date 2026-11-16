import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createRenderPreparation, finishShaderJobs, waitForDraw } from "../game/client/render-preparation.js";

const deferred = () => Promise.withResolvers();
const tick = () => new Promise(resolve => setImmediate(resolve));

test("shader completion alone cannot release entry before the real draw completes", async () => {
  const shader = deferred(), firstDraw = deferred();
  let drew = false, entered = false;
  const preparation = createRenderPreparation(async () => {
    await shader.promise;
    drew = true;
    await firstDraw.promise;
  });
  preparation.request("startup");
  const entry = preparation.wait().then(() => { entered = true; });
  await tick();
  assert.equal(preparation.pending, true);
  shader.resolve();
  await tick();
  assert.equal(drew, true);
  assert.equal(entered, false);
  assert.equal(preparation.pending, true);
  firstDraw.resolve();
  await entry;
  assert.equal(entered, true);
  assert.equal(preparation.pending, false);
});

test("quality and resize serialize and an old draw cannot release a newer request", async () => {
  const first = deferred(), next = deferred(), events = [];
  const preparation = createRenderPreparation(async reason => {
    events.push(reason);
    await (reason === "quality" ? first : next).promise;
  });
  preparation.request("quality", () => events.push("build"));
  await tick();
  preparation.request("resize", () => events.push("resize-target"));
  let ready = false;
  const entry = preparation.wait().then(() => { ready = true; });
  first.resolve();
  await tick();
  assert.deepEqual(events, ["build", "quality", "resize-target", "resize"]);
  assert.equal(ready, false);
  assert.equal(preparation.pending, true);
  next.resolve();
  await entry;
});

test("failure blocks entry, retries work, and context loss invalidates old completion", async () => {
  const failure = Error("draw failed");
  let fail = true;
  const preparation = createRenderPreparation(async () => { if (fail) throw failure; });
  preparation.request("startup");
  await assert.rejects(preparation.wait(), failure);
  assert.equal(preparation.error, failure);
  fail = false;
  await preparation.request("retry");
  await preparation.wait();
  assert.equal(preparation.error, null);
  const draw = deferred();
  const lost = createRenderPreparation(() => draw.promise);
  lost.request("startup");
  await tick();
  lost.invalidate(Error("context lost"));
  draw.resolve();
  await assert.rejects(lost.wait(), /context lost/);
  assert.match(lost.error.message, /context lost/);
});

test("shader drain includes jobs registered while an earlier batch is pending", async () => {
  const first = deferred(), second = deferred();
  const jobs = [first.promise];
  let ready = false;
  const drain = finishShaderJobs(jobs).then(() => { ready = true; });
  jobs.push(second.promise);
  first.resolve(null);
  await tick();
  assert.equal(ready, false);
  second.resolve(null);
  await drain;
  assert.equal(jobs.length, 0);
  await assert.rejects(finishShaderJobs([Promise.resolve(Error("bad shader"))]), /bad shader/);
});

test("the actual telemetry wrapper preserves rapid quality changes back to the current preset", async () => {
  const source = await readFile(new URL("../game/client/telemetry.js", import.meta.url), "utf8");
  const changes = [], preparation = createRenderPreparation(async () => {});
  const gfx = {
    quality: "high", preparation,
    setQuality(value) {
      return preparation.request("quality", () => { changes.push(value); this.quality = value; });
    },
    setRenderScale() {},
  };
  const sandbox = { gfx, software: false, performance, navigator: { hardwareConcurrency: 8, deviceMemory: 16 },
    policy: { reset() {} }, reset() {} };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf("  const originalQuality ="), source.indexOf("  // An old desktop/high")), sandbox);
  gfx.setQuality("high");
  assert.deepEqual(changes, []);
  gfx.setQuality("medium");
  gfx.setQuality("high");
  await preparation.wait();
  assert.deepEqual(changes, ["medium", "high"]);
  assert.equal(gfx.quality, "high");
});

test("draw fence waits for GPU completion and rejects a lost context", async () => {
  let signaled = false, lost = false, deleted = 0;
  const gl = {
    ALREADY_SIGNALED: 1, CONDITION_SATISFIED: 2, WAIT_FAILED: 3,
    isContextLost: () => lost, fenceSync: () => ({}), flush() {},
    clientWaitSync: () => signaled ? 1 : 0, deleteSync() { deleted++; },
  };
  let ready = false;
  const draw = waitForDraw({ getContext: () => gl }).then(() => { ready = true; });
  await tick();
  assert.equal(ready, false);
  signaled = true;
  await draw;
  assert.equal(deleted, 1);
  signaled = false;
  const interrupted = waitForDraw({ getContext: () => gl });
  lost = true;
  await assert.rejects(interrupted, /context lost/);
  assert.equal(deleted, 2);
});

test("audio preparation selects current weapons; playing never runs background PCM synthesis", async () => {
  const source = await readFile(new URL("../game/core/game.js", import.meta.url), "utf8");
  const start = source.indexOf("    function currentSoundKeys(weapons)");
  const end = source.indexOf("    let Pt =", start);
  const cache = {}, baked = [], state = { state: "playing" };
  const engine = { ctx: { sampleRate: 48000, currentTime: 0 }, indoor: 1, indoorT: 1,
    acc: 0, clock: 0, occCache: new Map(), bakeQ: ["gun:smg:near:0"], bakeTick: 0,
    stats: { bakeMs: 0, bakeMax: 0 }, lowHealth: 0 };
  const sandbox = { o: engine, performance, setTimeout, GH: { G: state },
    GHBoot: { familyOf: value => value },
    B$: () => ["gun:ar:near:0", "gun:pistol:near:0", "gun:smg:near:0", "exp:0", "k9:howl:-:0"],
    Dw: () => ({ d: cache }), Nb: (_rate, key) => { baked.push(key); cache[key] = {}; },
    A() {}, v() {}, l0() {}, $0() {}, H() {}, ut() {}, Z() {}, Gc() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + ";this.update=_t;this.prepare=prepareCurrent;this.ready=soundsReady", sandbox);
  for (let i = 0; i < 8; i++) sandbox.update(1 / 60);
  assert.deepEqual(baked, []);
  await sandbox.prepare(["ar", "pistol"]);
  assert.deepEqual(baked, ["gun:ar:near:0", "gun:pistol:near:0", "exp:0"]);
  assert.equal(sandbox.ready(["ar", "pistol"]), true);
  state.state = "menu";
  sandbox.update(1 / 60);
  assert.equal(baked.at(-1), "gun:smg:near:0");
});
