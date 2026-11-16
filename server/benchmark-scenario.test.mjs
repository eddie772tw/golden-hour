import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { commandAt, installBenchmarkScenario, manifest, seedBenchmarkRandom } from "../game/client/benchmark-scenario.js";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
// The real native private recoil RNG/reset, without constructing WebGL resources.
const NativeRecoil = vm.runInNewContext(`(${source.match(/\bGb = (class \{[\s\S]*?\n  \});/)[1]})`, { hR: {}, dZ: 11, mZ: 28, Math });
const vector = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); return this; } });
function nativeFixture({ online = false, solo = true, priorRecoilSeed = 1, audioRandomCalls = 0, fxRandomCalls = 0, priorRigPhase = 0 } = {}) {
  const elements = [], body = { classList: { contains: name => online && name === "online-session" },
    appendChild(element) { elements.push(element); } };
  const document = { body, defaultView: { location: { href: `http://localhost/${solo ? "?solo&nolock" : ""}` } },
    createElement() { return { dataset: {}, style: {}, remove() { elements.splice(elements.indexOf(this), 1); } }; } };
  const input = { el: { ownerDocument: document }, enabled: true, endFrame() { this.down.clear(); } };
  for (const key of ["keys", "down", "up", "touchKeys", "touchDown", "touchUp"]) input[key] = new Set();
  let moves = 0, rigUpdates = 0, damage = 0, fxUpdates = 0, fpbodyResets = 0;
  const casingWork = [];
  const world = { move(e, x, y, z) { moves++; e.x += x; e.z += z; e.y = Math.max(0, e.y + y); e.onGround = e.y === 0; } };
  const physics = { props: [], bodies: [], chunks: { live: 320, st: new Uint8Array([0, 1, 2, 0]) },
    cases: { live: 223, i: 47, st: Object.assign(new Uint8Array(90), { 0: 1, 2: 2 }) }, reset() {}, pushFrom() {}, update() {},
    casing(origin, velocity, kind) {
      const slot = this.cases.i;
      this.cases.i = (slot + 1) % this.cases.st.length;
      this.cases.st[slot] = 1; this.cases.live++;
      casingWork.push({ slot, kind, origin: [origin.x, origin.y, origin.z], velocity: [velocity.x, velocity.y, velocity.z], spin: Math.random() });
    } };
  const glass = { active: 0, reset() {}, update() {}, bodyHit() {} };
  const fx = { reset() {}, update() { fxUpdates++; }, muzzle() { for (let j = 0; j < fxRandomCalls; j++) Math.random(); } };
  const combat = { fire() { return {}; } };
  const audio = { gunshot() { for (let j = 0; j < audioRandomCalls; j++) Math.random(); },
    footstep() { for (let j = 0; j < audioRandomCalls; j++) Math.random(); },
    reload() { for (let j = 0; j < audioRandomCalls; j++) Math.random(); },
    music: { menu() { for (let j = 0; j < audioRandomCalls; j++) Math.random(); } },
    _debug: { lifeEvent() { for (let j = 0; j < audioRandomCalls; j++) Math.random(); } } };
  const rig = () => ({ time: priorRigPhase, _br: priorRigPhase * .7,
    reset() {}, update(dt) { rigUpdates++; this.time += dt; this._br += 1.9 * dt; } });
  const actor = id => ({ e: { x: 0, y: 0, z: 0, r: .3, h: 1.8 }, pos: vector(), vel: vector(), eye: vector(),
    state: {}, yaw: 0, alive: true, ammo: 30, reload: 0, stride: 0,
    def: { id, mag: 30 }, build: {},
    char: rig(),
    spawn(x, y, z, yaw) { this.char.reset(); Object.assign(this.e, { x, y: y + .01, z }); this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.ammo = 30; this.reload = 0; this.stride = 0; },
    _reload() { this.ammo = 30; this.reload = 2.2; audio.reload(); },
    _shoot() {
      this.ammo--; combat.fire(this, this.eye, { x: Math.random(), y: 0, z: -1 }, this.def);
      audio.gunshot();
      fx.muzzle();
      // Native order: fire -> sound -> FX/LOD -> random casing gate.
      if (Math.random() < .6) {
        const origin = { x: this.e.x + Math.sin(this.char.time) * .02,
          y: this.e.y + 1.5 + Math.sin(this.char._br) * .003, z: this.e.z };
        physics.casing(origin, { x: Math.random(), y: Math.random(), z: this.ammo / 30 }, 0);
      }
    },
    update() { throw Error("native tactical AI must not run in scripted mode"); },
  });
  const player = actor("ar");
  player.stats = { shots: 0, hits: 0, head: 0 };
  player.update = function (dt) {
    const forward = Number(input.keys.has("KeyW")) - Number(input.keys.has("KeyS"));
    const right = Number(input.keys.has("KeyD")) - Number(input.keys.has("KeyA"));
    world.move(this.e, (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * right) * dt * 3, 0,
      (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * right) * dt * 3);
    this.pos.set(this.e.x, this.e.y, this.e.z);
    this.yaw += arsenal.recoil._rnd() * .001;
  };
  const arsenal = { recoil: new NativeRecoil(), slot: { ammo: 30 }, slots: [{ def: { id: "ar" } }],
    reset() { this.slot.ammo = 30; this.recoil.reset(); }, update(tick) {
    if (input.down.has("KeyR")) this.slot.ammo = 30;
    if (input.keys.has("Mouse0") && tick % 6 === 0 && this.slot.ammo > 0) {
      this.slot.ammo--; player.stats.shots++;
      combat.fire(player, player.eye, { x: Math.random(), y: 0, z: -1 }, { id: "ar" });
      audio.gunshot(); fx.muzzle();
      physics.casing({ x: player.e.x + Math.sin(ctx.vm.t) * .01, y: player.e.y + 1.4, z: player.e.z },
        { x: Math.random(), y: Math.random(), z: -1 }, 0);
    }
  } };
  arsenal.recoil.seed(priorRecoilSeed);
  const match = { bots: manifest.botWeapons.map(actor), k9: { reset() {} }, damage(_actor, amount) { damage += amount; } };
  const spring = () => ({ reset() {} });
  const ctx = { world, physics, glass, fx, combat, arsenal, match, player, audio, settings: {}, resetWorld() {},
    vm: { t: priorRigPhase, sp: { px: spring() }, mv: { r: spring(), f: spring() } } };
  const fpbody = { op: rig(), reset() { fpbodyResets++; this.op.reset(); } };
  const gh = { ready: true, G: { state: "playing", time: 0 },
    debug: { ctx, input, player, match, physics, glass, fx, fpbody, gfx: { async whenReady() {} } } };
  return { gh, elements, casingWork, get moves() { return moves; }, get rigUpdates() { return rigUpdates; },
    get damage() { return damage; }, get fxUpdates() { return fxUpdates; }, get fpbodyResets() { return fpbodyResets; } };
}

test("preload seeding can be reset and safely restored", () => {
  const original = () => .9, math = { random: original };
  const seed = seedBenchmarkRandom(123, { math });
  const values = [math.random(), math.random()];
  seed.reset(); assert.deepEqual([math.random(), math.random()], values);
  seed.restore(); assert.equal(math.random, original);
});

test("native recoil reset retains old private history; explicit seed removes it", () => {
  const seeded = seedBenchmarkRandom(123);
  try {
    const a = new NativeRecoil(), b = new NativeRecoil();
    a.seed(1); b.seed(999);
    seeded.reset(); a.reset(); seeded.reset(); b.reset();
    assert.notEqual(a._rnd(), b._rnd(), "global RNG reset alone does not reset native recoil history");
    a.seed(manifest.seed); b.seed(manifest.seed);
    assert.deepEqual(Array.from({ length: 20 }, () => a._rnd()), Array.from({ length: 20 }, () => b._rnd()));
  } finally { seeded.restore(); }
});

test("versioned actions do not depend on wall time", () => {
  assert.deepEqual(commandAt(120), commandAt(120));
  assert.notDeepEqual(commandAt(120).target, commandAt(240).target);
  assert.equal(commandAt(420).reload, true);
  assert.equal(commandAt(120, 3).fireEvery, 120);
  assert.equal(manifest.fixedDelta, 1 / 60);
});

test("scripted work replays positions and shots despite ambient RNG and wall-time differences", async () => {
  async function replay(extraAmbientCalls) {
    const fixture = nativeFixture({ priorRecoilSeed: extraAmbientCalls ? 0xdeadbeef : 1,
      audioRandomCalls: extraAmbientCalls, fxRandomCalls: extraAmbientCalls, priorRigPhase: extraAmbientCalls ? 1234 : .17 }), { gh } = fixture;
    const playerUpdate = gh.debug.player.update, botUpdates = gh.debug.match.bots.map(bot => bot.update), random = Math.random;
    const scenario = await installBenchmarkScenario(gh);
    assert.equal(gh.benchmark, scenario);
    assert.equal(gh.debug.ctx.vm.t, 0);
    assert.ok(gh.debug.match.bots.every(bot => bot.char.time === 0 && bot.char._br < 6));
    assert.equal(gh.debug.fpbody.op.time, 0);
    assert.equal(fixture.fpbodyResets, 1);
    assert.match(fixture.elements[0].textContent, /DIAGNOSTIC.*no full AI/);
    for (let tick = 1; tick <= manifest.totalTicks; tick++) {
      for (let j = 0; j < extraAmbientCalls; j++) Math.random();
      gh.G.time += gh.benchmark.fixedDelta;
      gh.debug.player.update(gh.benchmark.fixedDelta);
      // Cover nested/public debug audio paths as well as bot gunshot/footstep.
      gh.debug.ctx.audio.music.menu(); gh.debug.ctx.audio._debug.lifeEvent();
      gh.debug.ctx.arsenal.update(tick);
      for (const bot of gh.debug.match.bots) bot.update(gh.benchmark.fixedDelta);
      gh.debug.match.damage(gh.debug.player, 50);
      gh.debug.physics.update(gh.benchmark.fixedDelta);
      gh.debug.glass.update(gh.benchmark.fixedDelta);
      gh.debug.fx.update(gh.benchmark.fixedDelta);
      gh.debug.ctx.vm.t += gh.benchmark.fixedDelta;
      gh.debug.input.endFrame();
    }
    const report = scenario.export();
    assert.ok(scenario.done);
    assert.equal(gh.G.state, "paused");
    assert.ok(report.events.some(event => event.actor === 0 && event.type === "shot"));
    assert.ok(report.events.some(event => event.actor > 0 && event.type === "shot"));
    assert.ok(report.state.actors.every(actor => actor.shots > 0));
    const casings = report.events.filter(event => event.type === "casing");
    assert.equal(casings.length, fixture.casingWork.length);
    for (const [j, event] of casings.entries()) {
      assert.ok(event.slot >= 0 && event.slot < 90);
      assert.deepEqual(event.origin, fixture.casingWork[j].origin);
      assert.deepEqual(event.velocity, fixture.casingWork[j].velocity);
      assert.equal(event.slot, fixture.casingWork[j].slot);
    }
    assert.equal(report.state.chunks, 2);
    assert.equal(report.state.cases, 90);
    assert.ok(report.legacyPoolCounts.cases > 223);
    assert.equal(report.legacyPoolCounts.chunks, 320);
    assert.equal(report.checkpoints[0].cases, 2);
    assert.ok(report.checkpoints.every(checkpoint => checkpoint.cases <= 90 && checkpoint.chunks === 2));
    assert.ok(fixture.casingWork.length > 90);
    assert.ok(fixture.moves >= manifest.totalTicks * 10);
    assert.equal(fixture.rigUpdates, manifest.totalTicks * 9);
    assert.equal(fixture.fxUpdates, manifest.totalTicks);
    assert.equal(fixture.damage, 0);
    assert.notDeepEqual(report.checkpoints[0].actors[0].position, report.state.actors[0].position);
    assert.notDeepEqual(report.checkpoints[0].actors[1].position, report.state.actors[1].position);
    scenario.stop(); scenario.stop();
    assert.equal(gh.benchmark, undefined);
    assert.equal(gh.debug.player.update, playerUpdate);
    assert.deepEqual(gh.debug.match.bots.map(bot => bot.update), botUpdates);
    assert.equal(Math.random, random);
    assert.equal(fixture.elements.length, 0);
    return { report, casingWork: fixture.casingWork };
  }
  assert.deepEqual(await replay(0), await replay(17));
});

test("online and unmarked pages are rejected, and variable game dt is rejected", async () => {
  await assert.rejects(installBenchmarkScenario(nativeFixture({ online: true }).gh), /isolated solo/);
  await assert.rejects(installBenchmarkScenario(nativeFixture({ solo: false }).gh), /isolated solo/);
  const { gh } = nativeFixture();
  const scenario = await installBenchmarkScenario(gh);
  try { assert.throws(() => gh.debug.player.update(.04), /fixedDelta/); }
  finally { scenario.stop(); }
});
