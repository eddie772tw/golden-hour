// Explicitly imported by the isolated solo runner; never imported by normal play.
const STEP = 1 / 60;
const BOT_STARTS = [[5, 0, 8.7], [4.6, 0, 1.4], [6.2, 0, 4.6], [-6.2, 0, 4.6],
  [-10.6, 0, 4], [10.6, 0, 4], [-10.6, 0, -6.3], [10.6, 0, -6.3], [0, 3.8, -6.5]];
export const manifest = Object.freeze({
  version: "solo-scripted-v4", seed: 0x47484d31, fixedDelta: STEP, totalTicks: 1800,
  player: { weapon: "ar", spawn: [-5, 0, 8.7], route: [[-5, 6.8], [-4.6, 1.4], [4.6, 1.4], [5, 6.8]] },
  botStarts: BOT_STARTS, botWeapons: ["ar", "smg", "ar", "shotgun", "ar", "smg", "ar", "shotgun", "ar"],
  timing: { routeLegTicks: 240, fireStart: 120, cycleTicks: 600, fireEnd: 360, reloadTick: 420 },
  simplifications: [
    "Scripted bot steering replaces native perception, navigation and tactical decisions.",
    "Native collision, rigs, weapons, combat, props, glass and particle updates remain active.",
    "Damage is zero: no deaths, kill progression, respawns, ragdolls, grenades or K9 deployment.",
    "One fixed logic tick per accepted game frame; equal tick counts, not equal wall time.",
    "Per-tick/per-subsystem RNG streams isolate prior wall-clock cosmetic RNG consumption.",
    "Audio calls use isolated RNG streams so lazy sound baking cannot change native casing probability or motion.",
    "Native bot, viewmodel and first-person-body procedural phases are reset explicitly before scripted work.",
    "Public FX events use isolated RNG streams; native effects and the existing FX update stream remain active.",
    "Shader/audio wall clocks and cosmetic pixels are not guaranteed identical; validate exported state.",
    "Fresh isolated page per comparison; reset is not a complete renderer/audio/rig cache rewind.",
  ],
});

// Call before loading the game, then install() reseeds before scripted work.
export function seedBenchmarkRandom(seed = manifest.seed, { math = Math } = {}) {
  const previous = math.random;
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  math.random = random;
  return {
    reset(value = seed) { state = value >>> 0; },
    restore() { if (math.random === random) math.random = previous; },
  };
}

export function commandAt(tick, actor = -1) {
  const phase = tick % manifest.timing.cycleTicks;
  const leg = Math.floor(tick / manifest.timing.routeLegTicks) % 4;
  const start = BOT_STARTS[actor];
  const target = actor < 0 ? manifest.player.route[leg] :
    [start[0] + [0, .9, 0, -.9][leg], start[2] + [.9, 0, -.9, 0][leg]];
  return {
    target,
    look: actor < 0 ? [[4.6, 1.45, 1.4], [-4.6, 1.45, 1.4], [-8.1, 4.9, -5], [6.2, 1.45, 4.6]][leg] : [0, 1.4, 4],
    fire: tick >= manifest.timing.fireStart && phase >= 120 && phase < manifest.timing.fireEnd,
    reload: phase === manifest.timing.reloadTick + Math.max(0, actor) * 3,
    fireEvery: actor === 3 || actor === 7 ? 120 : 12,
  };
}

const rounded = value => Math.round(value * 1e6) / 1e6;
const position = actor => [actor.e.x, actor.e.y, actor.e.z].map(rounded);
const approach = (current, target, amount) => current + Math.max(-amount, Math.min(amount, target - current));
const occupied = pool => pool.st.reduce((count, state) => count + Number(state !== 0), 0);

export async function installBenchmarkScenario(gh, { seed = manifest.seed } = {}) {
  const document = gh?.debug?.input?.el?.ownerDocument;
  function assertSolo() {
    if (!document || !new URL(document.defaultView.location.href).searchParams.has("solo") ||
        document.body.classList.contains("online-session")) throw Error("Scripted benchmark requires an isolated solo page");
  }
  assertSolo();
  if (!gh.ready || gh.G.state !== "playing") throw Error("Deploy normally before installing the scripted benchmark");
  if (gh.benchmark) throw Error("A benchmark is already installed");
  const { ctx, player, input, match, physics, glass, fx, gfx, fpbody } = gh.debug;
  if (match.bots.length !== BOT_STARTS.length || match.bots.some((bot, j) => bot.def.id !== manifest.botWeapons[j]))
    throw Error("Native bot roster differs from the versioned scenario");
  const bots = match.bots.slice(), actors = [player, ...bots], ids = new Map(actors.map((actor, j) => [actor, j]));
  const restore = [], rng = seedBenchmarkRandom(seed);
  let tick = 0, stopped = false, resetting = false, events = [], checkpoints = [], shots = actors.map(() => 0);
  let frameOpen = false, audioEvent = 0, fxEvent = 0, casingActor = 0;
  const moveOptions = bots.map(bot => ({ step: .42, snap: true,
    onPane: pane => ctx.glass.bodyHit(pane, bot.e.x, bot.e.y + 1, bot.e.z, bot.vel.x, bot.vel.y, bot.vel.z, false) }));
  const skill = { aim: .6, burst: 1, dmg: 1 };
  const badge = document.createElement("div");
  badge.dataset.benchmarkScenario = manifest.version;
  badge.style.cssText = "position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#18202de8;color:#ffdd77;padding:6px 12px;font:12px monospace;pointer-events:none";
  document.body.appendChild(badge);
  function label() { badge.textContent = `DIAGNOSTIC · ${manifest.version} · ${tick}/${manifest.totalTicks} · scripted bots / no full AI`; }
  function stream(channel) { rng.reset((seed ^ Math.imul(tick, 0x9e3779b9) ^ Math.imul(channel, 0x85ebca6b)) >>> 0); }
  function patch(object, key, replacement) {
    const original = object[key];
    object[key] = replacement(original);
    const installed = object[key];
    restore.push(() => { if (object[key] === installed) object[key] = original; });
  }
  function clearInput() {
    for (const field of ["keys", "down", "up", "touchKeys", "touchDown", "touchUp"]) input[field]?.clear();
    for (const field of ["mx", "my", "wheel", "touchForward", "touchRight", "touchMx", "touchMy"]) input[field] = 0;
  }
  // A lazy sound bake may consume thousands of random values before casing spawn.
  // Swap only for the synchronous audio call, restoring the SAME world RNG closure
  // and its untouched state. Never leave a temporary global RNG across an await.
  const audioObjects = new Set();
  function isolateAudio(object) {
    if (!object || audioObjects.has(object)) return;
    audioObjects.add(object);
    for (const [key, value] of Object.entries(object)) {
      if (typeof value === "function") patch(object, key, original => function (...args) {
        if (!frameOpen) return original.apply(this, args);
        const isolated = seedBenchmarkRandom((seed ^ Math.imul(tick, 0x9e3779b9) ^ Math.imul(++audioEvent, 0xc2b2ae35)) >>> 0);
        try { return original.apply(this, args); }
        finally { isolated.restore(); }
      });
      else if (value && typeof value === "object" && (!key.startsWith("_") || key === "_debug")) isolateAudio(value);
    }
  }
  isolateAudio(ctx.audio);
  // FX LOD branches may consume a different number of random values between
  // native combat.fire and casing's probability check. Preserve that work while
  // keeping its random consumption out of the caller's simulation stream.
  const fxPrototype = Object.getPrototypeOf(fx);
  const fxMethods = new Set([...Object.keys(fx), ...(fxPrototype === Object.prototype ? [] : Object.getOwnPropertyNames(fxPrototype))]);
  for (const key of fxMethods) if (key !== "constructor" && key !== "update" && !key.startsWith("_") && typeof fx[key] === "function")
    patch(fx, key, original => function (...args) {
      if (!frameOpen) return original.apply(this, args);
      const isolated = seedBenchmarkRandom((seed ^ Math.imul(tick, 0x9e3779b9) ^ Math.imul(++fxEvent, 0x27d4eb2d)) >>> 0);
      try { return original.apply(this, args); }
      finally { isolated.restore(); }
    });
  patch(physics, "casing", original => function (origin, velocity, kind) {
    if (frameOpen) events.push({ type: "casing", tick, actor: casingActor, slot: this.cases.i, kind,
      origin: [origin.x, origin.y, origin.z], velocity: [velocity.x, velocity.y, velocity.z] });
    return original.call(this, origin, velocity, kind);
  });
  function summary() {
    return {
      tick, actors: actors.map((actor, j) => ({ id: j, position: position(actor), yaw: rounded(actor.yaw),
        ammo: j ? actor.ammo : ctx.arsenal.slot.ammo, shots: shots[j], alive: actor.alive })),
      props: physics.props.filter(prop => !prop.dead).length,
      awakeBodies: physics.bodies.filter(body => !body.dead && !body.sleeping).length,
      glassActive: glass.active, chunks: occupied(physics.chunks), cases: occupied(physics.cases),
    };
  }
  patch(ctx.combat, "fire", original => function (actor, ...args) {
    const id = ids.get(actor);
    if (id !== undefined && frameOpen) {
      stream(100 + id);
      shots[id]++;
      events.push({ type: "shot", tick, actor: id, weapon: args[2].id,
        direction: [args[1].x, args[1].y, args[1].z].map(rounded) });
    }
    return original.call(this, actor, ...args);
  });
  // Preserve native hit feedback and collision/effect work without kills/progression.
  patch(match, "damage", original => function (actor, amount, ...args) {
    return original.call(this, actor, 0, ...args);
  });
  patch(player, "update", original => function (dt, ...args) {
    if (resetting || stopped) return;
    assertSolo();
    if (Math.abs(dt - STEP) > 1e-10) throw Error("Runner must apply GH.benchmark.fixedDelta to the whole accepted game frame");
    if (tick >= manifest.totalTicks) return;
    tick++;
    frameOpen = true;
    audioEvent = fxEvent = 0;
    casingActor = 0;
    stream(0);
    const command = commandAt(tick);
    clearInput();
    input.enabled = true;
    const dx = command.look[0] - this.e.x, dz = command.look[2] - this.e.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(command.look[1] - this.e.y - 1.62, Math.hypot(dx, dz));
    const mx = command.target[0] - this.e.x, mz = command.target[1] - this.e.z;
    if (Math.hypot(mx, mz) > .2) {
      const forward = -Math.sin(this.yaw) * mx - Math.cos(this.yaw) * mz;
      const right = Math.cos(this.yaw) * mx - Math.sin(this.yaw) * mz;
      if (Math.abs(forward) > .1) input.keys.add(forward > 0 ? "KeyW" : "KeyS");
      if (Math.abs(right) > .1) input.keys.add(right > 0 ? "KeyD" : "KeyA");
    }
    if (command.fire && tick % 24 < 12) input.keys.add("Mouse0");
    if (command.reload) { input.down.add("KeyR"); events.push({ type: "reload-input", actor: 0, tick }); }
    return original.call(this, dt, ...args);
  });
  for (const [j, bot] of bots.entries()) patch(bot, "update", () => function (dt) {
    if (!frameOpen || resetting || stopped) return;
    casingActor = j + 1;
    stream(j + 1);
    const command = commandAt(tick, j), e = this.e;
    let dx = command.target[0] - e.x, dz = command.target[1] - e.z, distance = Math.hypot(dx, dz);
    const speed = distance > .15 ? 2.4 : 0;
    this.vel.x = approach(this.vel.x, dx / (distance || 1) * speed, 28 * dt);
    this.vel.z = approach(this.vel.z, dz / (distance || 1) * speed, 28 * dt);
    this.vel.y -= 22 * dt;
    const options = moveOptions[j]; options.snap = this.vel.y <= 0;
    ctx.world.move(e, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt, options);
    if (e.onGround) this.vel.y = 0;
    this.pos.set(e.x, e.y, e.z);
    this.eye.set(e.x, e.y + 1.5, e.z);
    dx = command.look[0] - e.x; dz = command.look[2] - e.z;
    this.yaw = this.aimYaw = Math.atan2(-dx, -dz);
    this.aimPitch = Math.atan2(command.look[1] - this.eye.y, Math.hypot(dx, dz));
    this.reload = Math.max(0, this.reload - dt);
    if (command.reload) { this._reload(); events.push({ type: "reload", actor: j + 1, tick }); }
    if (command.fire && !this.reload && this.ammo > 0 && (tick + j * 3) % command.fireEvery === 0) {
      this.settle = 1; this.burst = 1;
      this._shoot(skill, Math.hypot(dx, dz));
    }
    physics.pushFrom(e.x, e.y, e.y + e.h, e.z, e.r + .1, this.vel.x, this.vel.z);
    const state = this.state, actualSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (e.onGround && actualSpeed > 1.5) {
      this.stride += actualSpeed * dt;
      if (this.stride > .85) {
        this.stride = 0;
        if (Math.hypot(e.x - player.e.x, e.z - player.e.z) < 24)
          ctx.audio.footstep(e.groundCol?.surf || "marble", this.pos, { run: false });
      }
    }
    Object.assign(state, { yaw: this.yaw, aimYaw: this.aimYaw, pitch: this.aimPitch, speed: actualSpeed,
      moveX: (this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)) / (actualSpeed || 1),
      moveZ: (this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw)) / (actualSpeed || 1),
      stance: "stand", sprint: false, airborne: !e.onGround, reloading: this.reload > 0,
      reloadDur: this.def.pump ? 2.6 : 2.2, engage: 1, look: null });
    this.char.update(dt, state);
  });
  // These run inside the original M0, in its original order, without extra steps.
  for (const [object, channel] of [[physics, 20], [glass, 21], [fx, 22]]) patch(object, "update", original => function (...args) {
    if (frameOpen) stream(channel);
    return original.apply(this, args);
  });
  patch(input, "endFrame", original => function (...args) {
    const result = original.apply(this, args);
    if (frameOpen) {
      frameOpen = false;
      if (tick % 60 === 0 || tick === manifest.totalTicks) { checkpoints.push(summary()); label(); }
      if (tick === manifest.totalTicks) { gh.G.state = "paused"; clearInput(); }
    }
    return result;
  });
  const controller = {
    manifest, fixedDelta: STEP,
    get tick() { return tick; }, get done() { return tick >= manifest.totalTicks; },
    async reset() {
      if (stopped) throw Error("Cannot reset a stopped benchmark");
      assertSolo(); resetting = true; gh.G.state = "paused"; frameOpen = false;
      try {
        tick = 0; events = []; checkpoints = []; shots.fill(0); rng.reset(seed); clearInput();
        gh.G.time = 0; gh.G.timeScale = 1; gh.G.freeCam = null;
        match.k9.reset(); physics.reset(); glass.reset(); ctx.resetWorld(); fx.reset?.();
        physics.chunks.i = physics.cases.i = 0;
        const phaseRig = (rig, index) => {
          rig.time = 0;
          rig._br = ((seed >>> 0) % 6000 + index * 977) % 6000 / 1000;
          rig.phase = 0; rig.stepCool = 0; rig._peak = 0; rig.vy = 0; rig._warp = -1;
        };
        // Native reset() deliberately retains these cosmetic phases in normal
        // play; the isolated fixture must not inherit pre-Deploy elapsed time.
        for (const [j, bot] of bots.entries()) for (const rig of bot.rigs || [bot.char]) phaseRig(rig, j + 1);
        if (fpbody) { phaseRig(fpbody.op, 100); fpbody.reset(); }
        if (ctx.vm) {
          ctx.vm.t = 0;
          for (const spring of [...Object.values(ctx.vm.sp), ...Object.values(ctx.vm.mv)]) spring.reset();
        }
        ctx.settings.primary = manifest.player.weapon;
        ctx.arsenal.reset(manifest.player.weapon);
        // Native recoil.reset() XORs its previous private RNG state with Math.random.
        // Seed that existing stream explicitly; retain the native recoil simulation.
        ctx.arsenal.recoil.seed(seed);
        player.spawn(...manifest.player.spawn, 0);
        player.stats.shots = player.stats.hits = player.stats.head = 0;
        for (const [j, bot] of bots.entries()) bot.spawn(...BOT_STARTS[j], 0);
        match.state = "live"; match.live = true; match.time = 3600; match.scores = [0, 0];
        await gfx.whenReady?.();
        checkpoints.push(summary()); label();
        gh.G.state = "playing";
      } finally { resetting = false; }
      return controller;
    },
    export() {
      return JSON.parse(JSON.stringify({ manifest, seed: seed >>> 0, tick, done: controller.done,
        stopped, state: summary(), checkpoints, events,
        legacyPoolCounts: { chunks: physics.chunks.live, cases: physics.cases.live },
        equipment: { player: ctx.arsenal.slots.map(slot => ({ id: slot.def.id, profileId: slot.def.profileId, build: slot.def.build })),
          bots: bots.map(bot => ({ id: bot.def.id, build: bot.build })) } }));
    },
    stop() {
      if (stopped) return;
      stopped = true; gh.G.state = "paused"; frameOpen = false; clearInput();
      for (const undo of restore.reverse()) undo();
      rng.restore(); badge.remove();
      if (gh.benchmark === controller) delete gh.benchmark;
    },
  };
  gh.benchmark = controller;
  try { await controller.reset(); } catch (error) { controller.stop(); throw error; }
  return controller;
}
