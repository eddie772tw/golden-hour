import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
const start = source.indexOf("    function ghCreateLoopClock() {");
const end = source.indexOf("\n    window.GH.debug =", start);
assert.ok(start > 0 && end > start);
const owningLoop = source.slice(start, end);
const STEP = 1 / 60;

function fixture() {
  const calls = [], frames = [], inputSamples = [];
  const vector = () => ({ x: 0, y: 0, z: 0,
    copy(value) { Object.assign(this, { x: value.x, y: value.y, z: value.z }); return this; },
    set(x, y, z) { Object.assign(this, { x, y, z }); return this; },
    applyQuaternion() { return this; }, addScaledVector() { return this; }, project() { return this; }, dot() { return 0; } });
  const c = { now: 0, calls, frames, inputSamples, online: false, failPreparation: null };
  const call = label => dt => { calls.push([label, dt]); };
  const l = { keys: new Set(), down: new Set(), up: new Set(), touchKeys: new Set(), touchDown: new Set(), touchUp: new Set(),
    mx: 0, my: 0, touchMx: 0, touchMy: 0, wheel: 0,
    endFrame() {
      calls.push(["endFrame"]);
      for (const key of ["down", "up", "touchDown", "touchUp"]) this[key].clear();
      this.mx = this.my = this.touchMx = this.touchMy = this.wheel = 0;
      c.afterEnd?.();
    } };
  const Je = { state: "playing", timeScale: 1, time: 0, fps: 0, freeCam: null };
  const S = { alive: true, health: 100, mode: "normal", shake: 0, adsK: 0, hit: [{ a: vector(), b: vector() }, { a: vector(), b: vector() }],
    update(dt) { calls.push(["player", dt]); inputSamples.push({ pressed: l.down.has("KeyR"), held: l.keys.has("Mouse0"), mx: l.mx, wheel: l.wheel }); c.beforePlayer?.(dt); },
    getHit() { calls.push(["hit"]); } };
  const a = { position: vector(), quaternion: {}, updateMatrixWorld() { calls.push(["camera-matrix"]); },
    getWorldDirection(out) { return out; } };
  const n = { preparation: { pending: false, error: null }, vmPass: {}, vmScene: {}, sunUv: { set() {} },
    uniforms: Object.fromEntries(["uExposure", "uDamage", "uLowHealth", "uFade", "uCA", "uAds"].map(key => [key, { value: 0 }])),
    render(dt) { frames.push({ t: c.now, dt, ticks: c.GH.loopStats.logicalTicks }); calls.push(["render", dt]); } };
  Object.assign(c, {
    window: null, document: { hidden: false, body: { classList: { contains: () => c.online } } }, Je,
    GH: { G: Je }, GHBoot: { stats: { preparation: {} } },
    performance: { now: () => c.now },
    Jf: class { last = null; getDelta() { const dt = this.last === null ? 0 : (c.now - this.last) / 1000; this.last = c.now; return dt; } },
    l, S, a, n, A: { update: call("arsenal") }, m: { frame: call("combat-budget") },
    b: { state: "live", bots: Array.from({ length: 9 }, (_, i) => ({ update: call("bot" + i), idle: call("idle" + i) })), update: call("match") },
    p: { update: call("physics") }, d: { update: call("glass") }, E: { update: call("VM") },
    g: { update: [call("world")], indoor() { return false; } }, u: { update: call("FX") }, r: { domElement: { height: 1080 } },
    C: { update: call("FPbody") }, f: { raycast() { return null; } }, Ii: vector(), i3: vector(), a3: vector(),
    x: { update: call("sun") }, fo: { setListener: call("listener"), setEnvironment() {}, setLowHealth() {}, update: call("audio") },
    t: { update: call("HUD") }, I: call("menu-camera"),
    Ee: (from, to) => to, ns: x => Math.max(0, Math.min(1, x)), Ht: (a, b, k) => a + (b - a) * k,
  });
  c.window = c;
  vm.createContext(c);
  vm.runInContext(owningLoop + "\nglobalThis.tick = M0;", c);
  c.run = now => { c.now = now; c.tick(now); };
  c.count = label => calls.filter(([key]) => key === label).length;
  return c;
}

test("owning loop keeps native logic at 60 Hz while 45 Hz rendering remains independently timed", () => {
  const c = fixture();
  for (let i = 0; i <= 450; i++) c.run(i * 1000 / 45);
  assert.equal(c.count("player"), 601);
  assert.equal(c.frames.length, 451);
  assert.ok(Math.abs(c.GH.loopStats.logicHz - 60) < 0.11);
  assert.ok(Math.abs(c.GH.loopStats.renderHz - 45) < 0.11);
  assert.ok(Math.abs(c.Je.fps - 45) < 0.01, "displayed FPS measures render submissions");
  assert.equal(c.GH.loopStats.dropped, 0);
  assert.equal(c.GH.loopStats.maxTicksPerCallback, 2);
  assert.equal(c.GH.loopStats.maxStepsPerRender, 2);
  assert.ok(c.calls.filter(([label]) => label === "player").every(([, dt]) => dt === STEP));
  assert.ok(c.frames.slice(1).every(frame => Math.abs(frame.dt - 1 / 45) < 1e-9), "render/shadow clock is wall time, not fixed simulation dt");
});

test("owning loop has no normal 60/120/144/240 Hz phase drift or extra simulation updates", () => {
  for (const hz of [60, 120, 144, 240]) {
    const c = fixture();
    for (let i = 0; i <= hz * 2; i++) c.run(i * 1000 / hz);
    assert.equal(c.count("player"), 121, `${hz} Hz`);
    assert.equal(c.frames.length, 121, `${hz} Hz`);
    assert.ok(Math.abs(c.Je.fps - 60) < 1, `${hz} Hz displayed FPS`);
  }
});

test("catch-up is bounded, consumes transients once, retains held input and resets combat budget each tick", () => {
  const c = fixture();
  c.run(0);
  c.calls.length = c.inputSamples.length = 0;
  c.l.down.add("KeyR"); c.l.keys.add("Mouse0"); c.l.mx = 9; c.l.wheel = 1;
  c.run(1000);
  assert.equal(c.count("player"), 3);
  assert.equal(c.count("combat-budget"), 3);
  assert.equal(c.count("endFrame"), 3);
  assert.deepEqual(c.inputSamples, [
    { pressed: true, held: true, mx: 9, wheel: 1 },
    { pressed: false, held: true, mx: 0, wheel: 0 },
    { pressed: false, held: true, mx: 0, wheel: 0 },
  ]);
  assert.ok(Math.abs(c.GH.loopStats.dropped - 0.95) < 1e-9);
  assert.equal(c.count("audio"), 1);
  assert.equal(c.count("HUD"), 1);
  assert.equal(c.count("camera-matrix"), 3);
  assert.equal(c.count("VM"), 3);
  assert.equal(c.count("FPbody"), 3);
  for (let i = 0; i < 9; i++) assert.equal(c.count("bot" + i), 3);
  assert.equal(c.frames.at(-1).dt, 1 / 18, "native render clamp is retained");
});

test("logic tick ordering retains hit/arsenal/combat/native AI/physics/VM/camera dependencies", () => {
  const c = fixture(); c.run(0);
  const labels = c.calls.map(([label]) => label);
  const order = ["player", "hit", "arsenal", "combat-budget", "bot0", "bot8", "match", "physics", "glass", "VM", "world", "FX", "camera-matrix", "FPbody", "listener", "endFrame", "audio", "HUD", "render"];
  for (let i = 1; i < order.length; i++) assert.ok(labels.indexOf(order[i - 1]) < labels.indexOf(order[i]), order[i - 1] + " → " + order[i]);
});

test("render suppression retains a new edge until a logical tick consumes it", () => {
  const c = fixture(); c.run(0);
  c.l.down.add("KeyR"); c.run(4);
  assert.equal(c.count("endFrame"), 1);
  assert.equal(c.l.down.has("KeyR"), true);
  c.run(17);
  assert.equal(c.inputSamples.at(-1).pressed, true);
  assert.equal(c.l.down.has("KeyR"), false);
});

test("pause/preparation/hidden transitions discard simulation debt and retain legacy idle cadences", () => {
  const c = fixture(); c.run(0);
  c.Je.state = "paused"; c.run(5000);
  assert.equal(c.count("player"), 1);
  const renders = c.frames.length;
  for (let i = 1; i <= 240; i++) c.run(5000 + i * 1000 / 240);
  assert.equal(c.frames.length - renders, 20);
  c.n.preparation.pending = true; c.run(10000);
  c.n.preparation.pending = false; c.GHBoot.stats.preparation = {}; c.Je.state = "playing"; c.run(10001);
  assert.equal(c.count("player"), 2, "no catch-up of time spent paused or preparing");
  c.document.hidden = true; c.Je.state = "paused"; c.run(11000);
  const hiddenRenders = c.frames.length;
  for (let i = 1; i <= 240; i++) c.run(11000 + i * 1000 / 240);
  assert.equal(c.frames.length - hiddenRenders, 5);
});

test("timeScale affects native logical work, while match wall delta and rendering retain wall time", () => {
  const c = fixture(); c.Je.timeScale = 0.5; c.run(0); c.run(50);
  assert.ok(c.calls.filter(([label]) => label === "player").every(([, dt]) => dt === STEP / 2));
  assert.ok(Math.abs(c.Je.time - 4 * STEP / 2) < 1e-10);
  assert.equal(c.frames.at(-1).dt, 0.05);
});

test("online ownership keeps one legacy variable frame instead of double catch-up prediction", () => {
  const c = fixture(); c.online = true; c.run(0); c.run(1000);
  assert.equal(c.count("player"), 2);
  assert.equal(c.count("arsenal"), 2);
  assert.equal(c.count("VM"), 2);
  assert.equal(c.inputSamples.length, 2);
  assert.equal(c.calls.filter(([label]) => label === "player").at(-1)[1], 1 / 18);
  assert.equal(c.GH.loopStats.maxTicksPerCallback, 0);
});

test("benchmark compatibility retains one full fixed tick per accepted frame and its wall render clock", () => {
  const c = fixture(); c.GH.benchmark = { fixedDelta: STEP, renderWallClock: true };
  c.run(0); c.run(4); c.run(1000 / 30);
  assert.equal(c.count("player"), 2);
  assert.equal(c.count("endFrame"), 2);
  assert.equal(c.frames.length, 2);
  assert.equal(c.calls.filter(([label]) => label === "player").at(-1)[1], STEP);
  assert.equal(c.frames.at(-1).dt, 1 / 30);
  const labels = c.calls.map(([label]) => label);
  assert.ok(labels.indexOf("render") < labels.indexOf("endFrame"), "v3 frameOpen closes after render as before");
});

test("native-follow benchmark stops catch-up immediately at logical tick 3600", () => {
  const c = fixture(); c.GH.benchmark = { fixedDelta: STEP, renderWallClock: true, followNativeLoop: true };
  let ticks = 0;
  c.afterEnd = () => { if (++ticks === 3600) c.Je.state = "paused"; };
  for (let i = 0; ticks < 3600; i++) c.run(i * 1000 / 45);
  assert.equal(ticks, 3600);
  assert.equal(c.count("player"), 3600);
  assert.equal(c.GH.loopStats.logicalTicks, 3600);
  assert.equal(c.GH.loopStats.dropped, 0, "pausing at the final tick is not performance backlog loss");
  for (let i = 0; i < 9; i++) assert.equal(c.count("bot" + i), 3600);
  assert.ok(c.frames.length < 3000);
  c.run(c.now + 1000);
  assert.equal(c.count("player"), 3600);
});

test("preparation requested during an online update does not count a skipped draw as FPS", () => {
  const c = fixture(); c.online = true;
  c.beforePlayer = () => { c.n.preparation.pending = true; };
  c.run(0);
  assert.equal(c.frames.length, 0);
  assert.equal(c.GH.loopStats.renderFrames, 0);
  assert.equal(c.count("endFrame"), 1);
});

test("deferred HUD preserves a streak peak followed by death in the same catch-up callback", () => {
  const c = fixture(); c.run(0);
  c.t.stat = { streak: 0 };
  let ticks = 0;
  c.beforePlayer = () => { c.S.streak = ++ticks === 1 ? 5 : 0; };
  const before = c.count("HUD");
  c.run(34);
  assert.equal(ticks, 2);
  assert.equal(c.S.streak, 0);
  assert.equal(c.t.stat.streak, 5, "best streak cannot depend on how many renders were submitted");
  assert.equal(c.count("HUD") - before, 1);
});

test("native-follow benchmark ownership drops setup debt even when no RAF observed its paused setup", () => {
  const c = fixture(); c.run(0); c.run(4);
  c.GH.benchmark = { fixedDelta: STEP, renderWallClock: true, followNativeLoop: true };
  c.run(1000);
  assert.equal(c.count("player"), 2, "installing a controller must not replay normal-play/setup elapsed time");
  assert.equal(c.GH.loopStats.dropped, 0);
});
