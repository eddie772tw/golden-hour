import {
  World,
  motion,
  STEP,
  clamp,
  JUMP,
  SPRINT,
  CROUCH,
  ADS,
  SLIDE,
} from "./simulation.js";
import { familyOf } from "./weapon-models.js";
import { clearInputState } from "./desktop-input.js";
import { requestPointerLock } from "./pointer-lock.js";
import { updateLocomotion } from "./locomotion.js";

const INITIAL_EVENT_TYPES = new Set(["shot", "damage", "kill"]);
const INITIAL_EVENT_LIMIT = 64;
const INITIAL_EVENT_MAX_AGE = 1500;

// The bundle is used only for rendering, models, audio and weapon animation.
// PvP simulation and authority live in the new client modules and Go server.
export class Engine extends EventTarget {
  constructor(connection, { now = () => performance.now() } = {}) {
    super();
    this.net = connection;
    this.now = now;
    this.lastUpdateAt = null;
    this.remoteRenderTime = null;
    this.jumpRequestUntil = 0;
    this.jumpInputHeld = false;
    this.remotes = new Map();
    this.pending = [];
    this.seq = 0;
    this.accumulator = 0;
    this.snapshots = [];
    this.active = false;
    this.shotSeq = 0;
    this.pendingShots = [];
    this.error = { x: 0, y: 0, z: 0 };
    this.hasInitialSnapshot = false;
    this.initialEvents = [];
    this.crouchInputHeld = false;
    this.slideRequestPending = false;
    this.slideRequestUntil = 0;
  }
  async ready() {
    if (this.gh) return;
    let last = performance.now(),
      stage = "",
      wasVisible = !document.hidden,
      idleVisibleMs = 0;
    while (!window.GH?.ready) {
      const now = performance.now();
      const loading = document.querySelector("#ltxt")?.textContent || "";
      const failure = document.querySelector("#err");
      if (failure)
        throw Error(failure.textContent || "3D 场景初始化失败。");
      if (loading !== stage) {
        stage = loading;
        idleVisibleMs = 0;
      } else if (!document.hidden && wasVisible) {
        idleVisibleMs += Math.min(now - last, 1000);
      }
      last = now;
      wasVisible = !document.hidden;
      if (idleVisibleMs > 120000)
        throw Error(`3D 场景在“${stage || "初始化"}”阶段长时间未完成，请检查浏览器的 WebGL 与显卡驱动支持。`);
      await new Promise((r) => setTimeout(r, 50));
    }
    this.gh = window.GH;
    this.debug = this.gh.debug;
    this.ctx = this.debug.ctx;
    this.player = this.debug.player;
    this.input = this.debug.input;
    if (!this.ctx?.botCtx?.createCharacter || !this.player?._camera)
      throw Error("当前游戏构建与联机适配器不兼容。");
    this.world = new World(
      this.debug.world.cols
        .filter((c) => !c.off && !c.pane)
        .map((c) => ({
          min: [c.x0, c.y0, c.z0],
          max: [c.x1, c.y1, c.z1],
          noMove: !!c.noMove,
          noRay: !!c.noRay,
        })),
    );
  }
  useWorld(colliders, bounds) {
    const previous = this.world;
    this.world = new World(colliders, bounds);
    return () => { this.world = previous; };
  }
  async enter(primary = "ar") {
    this.shotSeq = 0;
    this.pendingShots.length = 0;
    this.usesShotAcks = false;
    await this.ready();
    await globalThis.GHBoot?.runtimeReady;
    await this.debug.gfx?.whenReady?.();
    if (this.active) return;
    this.active = true;
    this.lastUpdateAt = null;
    this.remoteRenderTime = null;
    this.jumpRequestUntil = 0;
    this.jumpInputHeld = false;
    document.body.classList.add("online-session");
    this.primary = primary;
    this.phase = "lobby";
    this.pending = [];
    this.seq = 0;
    this.snapshots = [];
    this.hasInitialSnapshot = false;
    this.initialEvents = [];
    this.crouchInputHeld = false;
    this.slideRequestPending = false;
    this.slideRequestUntil = 0;
    this.lastSpawn = null;
    this.roundStarted = false;
    this.lastSnapshot = null;
    const { ctx, debug: d, player: p, input } = this;
    this.original = {
      playerUpdate: p.update,
      damage: p.damage,
      matchUpdate: ctx.match.update,
      matchDamage: ctx.match.damage,
      actors: ctx.match.actors,
      bots: ctx.match.bots,
      hudUpdate: ctx.hud.update,
      fire: ctx.combat.fire,
      melee: ctx.combat.melee,
      reload: ctx.arsenal.startReload,
      swap: ctx.arsenal.swap,
      lockChange: input.onLockChange,
      lock: input.lock,
      primary: ctx.settings.primary,
      playerTeam: p.team,
      scores: ctx.match.scores,
      time: ctx.match.time,
    };
    input.unlock();
    ctx.match.k9.clear();
    for (const bot of ctx.match.bots)
      for (const rig of bot.rigs) rig.root.visible = false;
    ctx.match.bots = [];
    ctx.match.actors = [p];
    ctx.match.update = () => {};
    ctx.match.damage = () => {};
    ctx.hud.update = (dt, state) => {
      if (!this.lastSnapshot || !this.roundStarted) return;
      if (this.gh.G.state !== "playing") this.renderRemotes(dt);
      this.original.hudUpdate.call(ctx.hud, dt, state);
    };
    p.damage = () => {};
    ctx.settings.primary = primary;
    ctx.arsenal.reset(primary);
    ctx.audio.init();
    await ctx.audio.prepareCurrent?.([primary, "pistol"]);
    await d.gfx?.whenReady?.();
    ctx.arsenal.grenades = 0;
    p.update = (dt, ars) => this.update(dt, ars);
    ctx.combat.fire = (actor, eye, dir) => {
      if (this.phase === "live" && p.alive && !this.net.stale) this.sendShot(dir);
      return {
        point: eye.clone().addScaledVector(dir, 140),
        actor: null,
        head: false,
        any: false,
        dist: 140,
      };
    };
    ctx.combat.melee = (actor, _eye, dir) => this.melee(actor, dir);
    ctx.arsenal.startReload = () => {
      const before = ctx.arsenal.state;
      this.original.reload.call(ctx.arsenal);
      if (before !== "reload" && ctx.arsenal.state === "reload")
        this.net.send({ type: "reload" }).catch(() => {});
    };
    ctx.arsenal.swap = (slot) => {
      const w = ctx.arsenal.slots[slot];
      if (w && slot !== ctx.arsenal.cur)
        this.net.send({ type: "equip", weapon: w.def.profileId }).catch(() => {});
      this.original.swap.call(ctx.arsenal, slot);
    };
    input.onLockChange = (locked) => {
      if (!locked) {
        this.releaseDrag();
        clearInputState(input);
        if (this.gh.G.state === "playing") this.pause();
      }
      this.dispatchEvent(new CustomEvent("lock", { detail: locked }));
    };
    input.lock = () => this.lock();
    this.lockAttempt = 0;
    this.dragMode = false;
    this.dragActive = false;
    this.dragPointer = null;
    this.controls = new AbortController();
    const opts = { signal: this.controls.signal };
    const canvas = input.el;
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.dragActive || e.pointerType === "touch") return;
        this.dragging = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.dragPointer = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
      },
      opts,
    );
    canvas.addEventListener(
      "mousedown",
      (e) => {
        if (!this.dragActive) return;
        e.preventDefault();
        input.handleMouse(e, true);
      },
      opts,
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (this.dragActive && this.dragging && e.pointerId === this.dragPointer) {
          input.mx += e.clientX - this.lastPointer.x;
          input.my += e.clientY - this.lastPointer.y;
          this.lastPointer = { x: e.clientX, y: e.clientY };
        }
      },
      opts,
    );
    canvas.addEventListener("wheel", e => { if (this.dragActive) input.handleWheel(e); }, opts);
    canvas.addEventListener("pointerup", (e) => {
      if (e.pointerId === this.dragPointer) this.releaseDrag();
    }, opts);
    canvas.addEventListener("mouseup", (e) => {
      if (!this.dragActive) return;
      input.handleMouse(e, false);
    }, opts);
    for (const type of ["pointercancel", "lostpointercapture"])
      canvas.addEventListener(type, (e) => {
        if (e.pointerId === this.dragPointer) input.onLockChange(false);
      }, opts);
    ctx.hud.show("menu");
    ctx.hud.menus.go("online");
    this.gh.G.state = "menu";
    this.gh.G.timeScale = 1;
    ctx.match.state = "idle";
    ctx.match.live = false;
  }
  setRoom(room) {
    this.room = room;
    this.phase = room.phase;
    if (room.phase === "lobby") this.roundStarted = false;
    if (!this.active) return;
    for (const [id, r] of this.remotes) {
      const member = room.players.find((p) => p.id === id);
      if (!member || member.team !== r.team) {
        this.removeRemote(id);
      }
    }
  }
  deploy() {
    if (!this.active) return;
    const gfx = this.debug.gfx;
    if (gfx?.preparation?.pending || gfx?.preparation?.error) {
      this.pause();
      this.ctx.hud.hint("正在准备画面，完成后请点击继续", 6);
      return;
    }
    this.lastUpdateAt = null;
    this.ctx.audio.init();
    this.ctx.audio.music.menu(false);
    this.ctx.hud.show(null);
    this.gh.G.state = "playing";
    this.ctx.match.state = "live";
    this.ctx.match.live = false;
    this.input.lock();
  }
  async lock() {
    if (!this.active || this.gh.G.state !== "playing") return;
    if (this.debug.gfx?.preparation?.pending || this.debug.gfx?.preparation?.error) {
      this.ctx.hud.hint("正在准备画面，完成后请再次点击继续", 5);
      return;
    }
    this.ctx.audio.init();
    if (globalThis.GHInput?.effective === "gamepad") {
      this.releaseDrag();
      this.dragActive = false;
      globalThis.GHInput.activate();
      return;
    }
    if (globalThis.GHTouch?.enabled) {
      this.releaseDrag();
      this.dragActive = false;
      globalThis.GHTouch.activate();
      return;
    }
    if (this.input.locked) return;
    if (this.dragMode) {
      this.enableDrag();
      return;
    }
    if (this.lockRequest) return;
    const attempt = ++this.lockAttempt;
    const controller = new AbortController();
    const doc = this.input.el.ownerDocument;
    this.input.allowLock = true;
    this.input.lockAttempt = (this.input.lockAttempt || 0) + 1;
    const promise = requestPointerLock(this.input.el, { signal: controller.signal });
    this.lockRequest = { controller, promise };
    try {
      await promise;
      if (attempt !== this.lockAttempt && this.gh.G.state !== "playing") this.input.unlock();
    } catch {
      if (attempt === this.lockAttempt && this.active && this.gh.G.state === "playing") {
        const focused = !doc.hidden && doc.hasFocus();
        this.pause();
        if (focused) this.dispatchEvent(new Event("lockerror"));
      }
    } finally {
      if (this.lockRequest?.controller === controller) this.lockRequest = null;
    }
  }
  enableDrag() {
    this.dragMode = true;
    this.dragActive = true;
    this.input.el.tabIndex = 0;
    this.input.el.focus({ preventScroll: true });
    this.dispatchEvent(new CustomEvent("lock", { detail: true }));
  }
  releaseDrag() {
    this.dragging = false;
    this.lastPointer = null;
    const pointer = this.dragPointer;
    this.dragPointer = null;
    if (pointer !== null && pointer !== undefined &&
        this.input.el.hasPointerCapture(pointer))
      this.input.el.releasePointerCapture(pointer);
    this.input.boundInput?.releaseMouse();
  }
  applySpecs() {
    for (const slot of this.ctx.arsenal.slots) {
      const spec = this.specs?.find((w) => w.id === slot.def.profileId);
      if (spec)
        slot.def = {
          ...slot.def,
          rpm: 60 / spec.interval,
          mag: spec.mag,
          reserve: spec.reserve,
          pellets: spec.pellets,
        };
    }
  }
  readInput() {
    const k = this.input.keys,
      has = (...codes) => codes.some((c) => k.has(c) || this.input.touchKeys.has(c));
    const enabled =
      !!this.net.writer &&
      !this.net.stale &&
      (this.input.locked || this.input.touchActive || this.dragActive) &&
      this.phase === "live" &&
      this.player.alive;
    const seq = ++this.seq,
      crouchHeld = enabled && has("KeyC", "ControlLeft", "ControlRight");
    let crouchPressed = crouchHeld && !this.crouchInputHeld;
    for (const code of ["KeyC", "ControlLeft", "ControlRight"]) {
      if (this.input.down?.delete(code)) crouchPressed = true;
      if (this.input.touchDown?.delete(code)) crouchPressed = true;
    }
    this.crouchInputHeld = crouchHeld;
    const moveIntent = has("KeyW", "ArrowUp", "KeyS", "ArrowDown", "KeyA", "ArrowLeft", "KeyD", "ArrowRight") ||
      Math.hypot(this.input.touchForward || 0, this.input.touchRight || 0) > 0.01;
    const canRequestSlide = crouchPressed && enabled && has("ShiftLeft", "ShiftRight") &&
      moveIntent && !has("Mouse1", "Mouse2") && this.predicted?.ground && !this.predicted?.crouch &&
      !this.predicted?.sliding && (this.predicted?.slideCooldown || 0) <= 0;
    const now = this.now();
    const jumpHeld = enabled && has("Space");
    let jumpPressed = jumpHeld && !this.jumpInputHeld;
    if (this.input.down?.delete("Space")) jumpPressed = true;
    if (this.input.touchDown?.delete("Space")) jumpPressed = true;
    this.jumpInputHeld = jumpHeld;
    if (jumpPressed && enabled && this.predicted?.ground) this.jumpRequestUntil = now + 600;
    if (canRequestSlide) {
      this.slideRequestPending = true;
      this.slideRequestUntil = now + 600;
    } else if (this.slideRequestPending && now >= this.slideRequestUntil) {
      this.slideRequestPending = false;
      this.slideRequestUntil = 0;
    }
    if (!enabled || !this.player?.alive) {
      this.slideRequestPending = false;
      this.slideRequestUntil = 0;
      this.jumpRequestUntil = 0;
    }
    let buttons = enabled
      ? Number(jumpHeld || now < this.jumpRequestUntil) * JUMP +
        Number(has("ShiftLeft", "ShiftRight")) * SPRINT +
        Number(crouchHeld || crouchPressed) * CROUCH +
        Number(has("Mouse1", "Mouse2")) * ADS
      : 0;
    if (enabled && this.slideRequestPending) {
      buttons |= SLIDE;
    }
    return {
      seq,
      forward: enabled
        ? clamp(Number(has("KeyW", "ArrowUp")) - Number(has("KeyS", "ArrowDown")) + this.input.touchForward, -1, 1)
        : 0,
      right: enabled
        ? clamp(Number(has("KeyD", "ArrowRight")) - Number(has("KeyA", "ArrowLeft")) + this.input.touchRight, -1, 1)
        : 0,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      buttons,
    };
  }
  update(dt, ars) {
    const p = this.player;
    if (!this.predicted) return;
    // Native animation dt is capped at 1/18s. Use elapsed wall time for online
    // prediction, with at most six catch-up steps after a long frame.
    const now = this.now();
    const elapsed = this.lastUpdateAt === null ? dt : Math.max(0, (now - this.lastUpdateAt) / 1000);
    this.lastUpdateAt = now;
    if (!p.alive) {
      this.input.enabled = false;
      p._deadCam(dt);
      this.renderRemotes(dt);
      return;
    }
    if (this.input.locked || this.input.touchActive || this.dragActive) {
      const sens =
        0.0022 *
        this.ctx.settings.sens *
        (1 + (this.ctx.settings.adsSens - 1) * p.adsK);
      p.yaw -= (this.input.mx + this.input.touchMx) * sens + this.input.gyroYaw;
      p.pitch = clamp(
        p.pitch - ((this.input.my + this.input.touchMy) * sens + this.input.gyroPitch) * (this.ctx.settings.invertY ? -1 : 1),
        -1.5,
        1.5,
      );
    }
    this.accumulator = Math.min(this.accumulator + elapsed, 0.1);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      const input = this.readInput();
      const m = this.predicted;
      const wasSliding = m.sliding;
      Object.assign(this.previousPosition, { x: m.x, y: m.y, z: m.z });
      if (this.phase === "live" && p.alive)
        this.world.move(m, input);
      if (m.sliding !== wasSliding) {
        if (m.sliding) {
          p.ev.slide++;
          this.ctx.audio.slideStart?.(p.e.groundCol?.surf || "marble");
        } else {
          p.ev.slideEnd++;
          this.ctx.audio.slideStop?.();
        }
      }
      // Use actual displacement: the simulation retains desired velocity at
      // walls, which must not keep the native running animation at full speed.
      this.visualVelocity.x = (m.x - this.previousPosition.x) / STEP;
      this.visualVelocity.z = (m.z - this.previousPosition.z) / STEP;
      this.pending.push(input);
      if (this.pending.length > 120) this.pending.shift();
      if (input.seq % 2 === 0) this.net.input(input);
    }
    const m = this.predicted,
      decay = Math.exp(-15 * dt);
    for (const key of ["x", "y", "z"]) this.error[key] *= decay;
    const alpha = this.accumulator / STEP;
    for (const key of ["x", "y", "z"])
      p.e[key] = this.previousPosition[key] + (m[key] - this.previousPosition[key]) * alpha + this.error[key];
    const wasGrounded = p.e.onGround, previousVY = p.vel.y;
    p.e.h = m.sliding ? 0.95 : m.crouch ? 1.2 : 1.8;
    p.e.onGround = m.ground;
    p.pos.set(p.e.x, p.e.y, p.e.z);
    p.vel.set(this.visualVelocity.x, m.vy, this.visualVelocity.z);
    const stance = m.crouch ? "crouch" : "stand";
    if (p.stance !== stance) p.ev.stance++;
    p.stance = stance;
    p.mode = m.sliding ? "slide" : "normal";
    updateLocomotion(p, dt, ars, {
      sprint: !m.sliding && (this.input.held("ShiftLeft") || this.input.held("ShiftRight")),
      wasGrounded, previousVY,
    });
    p._camera(dt, ars);
    this.input.enabled =
      !!this.net.writer &&
      !this.net.stale &&
      this.phase === "live" &&
      p.alive &&
      (this.input.locked || this.input.touchActive || this.dragActive);
    this.renderRemotes(dt);
  }
  sendShot(dir) {
    const command = {
      type: "shot", tick: this.net.latestTick,
      yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(clamp(dir.y, -1, 1)),
    };
    let pending;
    if (this.net.originalVersion === "v60115") {
      command.weapon = this.ctx.arsenal.slot.def.profileId || this.ctx.arsenal.slot.def.id;
      if (this.usesShotAcks) {
        command.shotSeq = ++this.shotSeq;
        pending = { seq: command.shotSeq, weapon: command.weapon };
        this.pendingShots.push(pending);
        if (this.pendingShots.length > 64) this.pendingShots.shift();
      }
    }
    this.net.send(command).catch(() => {
      if (pending) this.pendingShots = this.pendingShots.filter(shot => shot !== pending);
    });
  }
  snapshot(s) {
    if (!this.active) return;
    const me = s.players.find((p) => p.id === this.net.id);
    if (!me) return;
    this.phase = s.phase;
    this.usesShotAcks = me.shotAck !== undefined;
    if (this.usesShotAcks) this.shotSeq = Math.max(this.shotSeq, me.shotAck);
    if (!me.alive || s.phase !== "live" || !this.usesShotAcks) this.pendingShots.length = 0;
    else this.pendingShots = this.pendingShots.filter(shot => shot.seq > me.shotAck);
    this.lastSnapshot = s;
    this.receivedAt = performance.now();
    const match = this.ctx.match;
    match.state = s.phase === "over" ? "ending" : s.phase;
    match.scores = s.scores;
    match.time = s.remaining / 1000;
    match.scoreLimit = this.room?.scoreLimit || 40;
    if ((s.phase === "countdown" || s.phase === "live") && !this.roundStarted) {
      this.roundStarted = true;
      this.count = -1;
      this.ctx.hud.matchStart();
      // PvP only exposes actions implemented by the authoritative server.
      this.ctx.hud.hint(
        "<span><kbd>WASD</kbd> 移动</span><span><kbd>R</kbd> 换弹</span><span><kbd>TAB</kbd> 战绩</span>",
        6,
      );
      this.ctx.audio.music.menu(false);
      this.deploy();
    }
    const count = s.phase === "countdown" ? Math.ceil(s.remaining / 1000) : 0;
    if (this.roundStarted && count !== this.count && s.phase !== "over") {
      this.count = count;
      this.ctx.hud.count(count);
    }
    const wasAlive = this.player.alive,
      first = !this.predicted,
      respawn = me.alive && (!wasAlive || first);
    if (respawn) {
      this.primary = this.ctx.settings.primary;
      if (this.roundStarted) this.ctx.hud.respawned();
      this.player.reset();
      this.player.yaw = me.yaw;
      this.player.pitch = me.pitch;
      this.pending = [];
      this.error = { x: 0, y: 0, z: 0 };
      this.ctx.arsenal.reset(this.primary);
      this.applySpecs();
      this.ctx.arsenal.grenades = 0;
      this.net.send({ type: "equip", weapon: this.ctx.arsenal.slots[0].def.profileId }).catch(() => {});
    }
    const before = this.predicted ? { ...this.predicted } : motion(me);
    if (me.sliding || !me.alive || s.phase !== "live") {
      this.slideRequestPending = false;
      this.slideRequestUntil = 0;
    }
    if (me.jumpHeld || !me.alive || s.phase !== "live") this.jumpRequestUntil = 0;
    this.pending = this.pending.filter((i) => i.seq > me.ack);
    this.predicted = motion(me);
    if (s.phase === "live" && me.alive)
      for (const input of this.pending) this.world.move(this.predicted, input);
    const continuous =
      !first &&
      !respawn &&
      Math.hypot(
        before.x - this.predicted.x,
        before.y - this.predicted.y,
        before.z - this.predicted.z,
      ) < 2;
    if (continuous) {
      this.error.x += before.x - this.predicted.x;
      this.error.y += before.y - this.predicted.y;
      this.error.z += before.z - this.predicted.z;
      // Move both interpolation endpoints with reconciliation; the decaying
      // error then preserves the displayed position instead of adding a hitch.
      for (const key of ["x", "y", "z"])
        this.previousPosition[key] += this.predicted[key] - before[key];
    } else {
      this.error = { x: 0, y: 0, z: 0 };
      this.previousPosition = { x: this.predicted.x, y: this.predicted.y, z: this.predicted.z };
      this.visualVelocity = { x: this.predicted.vx, z: this.predicted.vz };
      this.accumulator = 0;
      this.player.e.onGround = this.predicted.ground;
    }
    this.player.health = me.hp;
    this.player.alive = me.alive;
    this.player.team = me.team;
    this.ctx.hud.e.hpname.textContent = me.team ? "余烬" : "先锋";
    this.player.kills = me.kills;
    this.player.deaths = me.deaths;
    this.player.score = me.score;
    this.player.name =
      this.room?.players.find((p) => p.id === me.id)?.name || "干员";
    this.player.def = this.ctx.arsenal.slots.find(
      (w) => w.def.profileId === me.weapon,
    )?.def;
    if (!me.alive) this.ctx.hud.respawnIn(me.respawn / 1000);
    const slot = this.ctx.arsenal.slots.find((w) => w.def.profileId === me.weapon);
    if (slot) {
      const pending = this.pendingShots.filter(shot => shot.weapon === me.weapon).length;
      slot.ammo = pending ? Math.max(0, me.ammo - pending) : me.ammo;
      slot.reserve = me.reserve;
    }
    if (
      this.reloading &&
      me.reload === 0 &&
      this.ctx.arsenal.state === "reload"
    ) {
      this.ctx.arsenal.state = "ready";
      this.ctx.arsenal.clip = null;
      this.ctx.vm.release();
    }
    this.reloading = me.reload > 0;
    this.snapshots.push({ ...s, received: performance.now() });
    if (this.snapshots.length > 12) this.snapshots.shift();
    // Datagram snapshots can arrive after the reliable roster update. Reconcile
    // the complete roster here too, so a late packet cannot keep an old rig alive.
    for (const [id, remote] of this.remotes) {
      const other = s.players.find((player) => player.id === id);
      if (!other || other.team !== remote.team ||
          (remote.visualTeam !== undefined && remote.visualTeam !== (other.team === me.team ? 0 : 1)))
        this.removeRemote(id);
    }
    for (const other of s.players)
      if (other.id !== this.net.id && !this.remotes.has(other.id))
        this.createRemote(other);
    this.syncActors(s);
    this.flushInitialEvents();
  }
  pause() {
    if (!this.active) return;
    this.stopInput();
    this.gh.G.state = "paused";
    this.gh.G.timeScale = 1;
    this.lockAttempt++;
    this.lockRequest?.controller.abort();
    this.lockRequest = null;
    this.input.allowLock = false;
    this.input.lockAttempt = (this.input.lockAttempt || 0) + 1;
    this.dragActive = false;
    this.releaseDrag();
    globalThis.GHTouch?.deactivate();
    this.input.enabled = false;
    clearInputState(this.input);
    this.input.unlock();
    this.ctx.hud.show("pause");
  }
  stopInput() {
    this.lastUpdateAt = null;
    this.jumpRequestUntil = 0;
    this.jumpInputHeld = false;
    this.crouchInputHeld = false;
    this.slideRequestPending = false;
    this.slideRequestUntil = 0;
    if (this.net?.writer && this.phase === "live") {
      const input = { seq: ++this.seq, forward: 0, right: 0, buttons: 0,
        yaw: this.player.yaw, pitch: this.player.pitch };
      this.pending.push(input);
      if (this.pending.length > 120) this.pending.shift();
      void this.net.input(input);
    }
  }
  melee(actor, dir) {
    if (actor !== this.player || !this.active || !this.net.writer || this.net.stale ||
        this.phase !== "live" || !actor.alive || this.gh.G.state !== "playing")
      return null;
    // Called at the native swing's contact frame. Only aim/tick go over the
    // reliable lane; the server chooses the victim and awards damage/score.
    this.net.send({ type: "melee", tick: this.net.latestTick,
      yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(clamp(dir.y, -1, 1)),
    }).catch(() => {});
    return null;
  }
  syncActors(s) {
    const actors = this.ctx.match.actors;
    actors.length = 1;
    actors[0] = this.player;
    for (const p of s.players) {
      if (p.id === this.net.id) continue;
      const r = this.remotes.get(p.id);
      if (!r) continue;
      const actor = r.actor;
      Object.assign(actor, {
        id: p.id,
        name: this.room?.players.find((q) => q.id === p.id)?.name || "干员",
        team: p.team,
        yaw: p.yaw,
        health: p.hp,
        alive: p.alive,
        kills: p.kills,
        deaths: p.deaths,
        score: p.score,
      });
      actor.def.id = familyOf(p.weapon);
      actor.def.profileId = p.weapon;
      actor.e.h = p.sliding ? 0.95 : p.crouch ? 1.2 : 1.8;
      actor.pos.set(p.x, p.y, p.z);
      actors.push(actor);
    }
    this.ctx.match.actors = actors;
  }
  actor(id) {
    return id === this.net.id ? this.player : this.remotes.get(id)?.actor;
  }
  removeRemote(id) {
    const remote = this.remotes.get(id);
    if (!remote) return;
    // Native disposal releases the per-rig skeleton / bone texture and fade
    // materials. Body and weapon geometry/materials belong to shared caches.
    remote.rig.dispose?.();
    remote.rig.root.removeFromParent();
    this.remotes.delete(id);
  }
  flushInitialEvents() {
    if (this.hasInitialSnapshot) return;
    this.hasInitialSnapshot = true;
    const now = performance.now(),
      queued = this.initialEvents;
    this.initialEvents = [];
    for (const item of queued)
      if (now - item.received <= INITIAL_EVENT_MAX_AGE)
        this.applyEvent(item.event);
  }
  warmEquipment(root) {
    const gfx = this.debug.gfx;
    if (!gfx?.prepare) return;
    (gfx.warmRoots ||= new Set()).add(root);
    gfx.prepare("remote-equipment");
  }
  createRemote(p) {
    // Native palette 0 is blue and palette 1 is red. Keep the authoritative
    // team on actors; choose model colours relative to the local player.
    const visualTeam = p.team === this.player.team ? 0 : 1;
    const ctx = this.ctx.botCtx,
      rig = ctx.createCharacter({
        team: visualTeam,
        gunFactory: (family, modelId) => ctx.worldGun(family, null, modelId),
        ground: (x, z, y) => ctx.world.groundAt(x, z, y),
      });
    rig.setWeapon(familyOf(p.weapon), p.weapon);
    rig.root.visible = p.alive;
    ctx.scene.add(rig.root);
    this.warmEquipment(rig.root);
    rig.root.traverse((n) => {
      if (n.isMesh) {
        // Remote rigs are cosmetic. Let Three.js cull off-screen meshes and
        // keep them out of the expensive shadow-map pass on low-end GPUs.
        n.castShadow = false;
        n.receiveShadow = false;
        // Skinned bounds change with the pose; retain their native behavior.
        n.frustumCulled = !n.isSkinnedMesh;
      }
    });
    this.remotes.set(p.id, {
      rig,
      team: p.team,
      visualTeam,
      weapon: p.weapon,
      actor: {
        id: p.id,
        isPlayer: false,
        lastShot: -100,
        pos: this.player.pos.clone(),
        e: { h: 1.8 },
        def: { id: familyOf(p.weapon), profileId: p.weapon },
      },
      pos: this.player.pos.clone(),
      state: {
        pos: this.player.pos.clone(),
        yaw: p.yaw,
        pitch: p.pitch,
        speed: 0,
        moveX: 0,
        moveZ: 0,
        stance: "stand",
        sprint: false,
        airborne: false,
        reloading: false,
        dead: false,
      },
    });
  }
  renderRemotes(dt) {
    if (!this.snapshots.length) return;
    const latest = this.snapshots.at(-1);
    const desired = latest.time + (performance.now() - latest.received) - 100;
    // A delayed newer packet must not rewind a remote actor already rendered.
    const target = this.remoteRenderTime = Math.max(this.remoteRenderTime ?? desired,
      Math.min(latest.time, desired));
    let a = this.snapshots[0],
      b = latest;
    for (let i = 1; i < this.snapshots.length; i++)
      if (this.snapshots[i].time >= target) {
        a = this.snapshots[i - 1];
        b = this.snapshots[i];
        break;
      }
    const t = clamp((target - a.time) / (b.time - a.time || 1), 0, 1);
    for (const p of b.players) {
      const r = this.remotes.get(p.id);
      if (!r) continue;
      const previous = a.players.find((q) => q.id === p.id) || p;
      const prev = previous.alive === p.alive ? previous : p;
      r.rig.root.visible = p.alive && p.connected;
      if (!r.rig.root.visible) continue;
      if (r.weapon !== p.weapon) {
        r.rig.setWeapon(familyOf(p.weapon), p.weapon);
        r.weapon = p.weapon;
        this.warmEquipment(r.rig.root);
      }
      const state = r.state;
      state.pos.set(
        prev.x + (p.x - prev.x) * t,
        prev.y + (p.y - prev.y) * t,
        prev.z + (p.z - prev.z) * t,
      );
      let delta = (p.yaw - prev.yaw) % (2 * Math.PI);
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      state.yaw = prev.yaw + delta * t;
      state.pitch = prev.pitch + (p.pitch - prev.pitch) * t;
      const vx = prev.vx + (p.vx - prev.vx) * t;
      const vz = prev.vz + (p.vz - prev.vz) * t;
      state.speed = Math.hypot(vx, vz);
      // Character rigs use the native bot convention (positive Z is back),
      // unlike the first-person player's forward-positive viewmodel contract.
      state.moveX =
        (vx * Math.cos(state.yaw) - vz * Math.sin(state.yaw)) / (state.speed || 1);
      state.moveZ =
        (vx * Math.sin(state.yaw) + vz * Math.cos(state.yaw)) / (state.speed || 1);
      state.stance = p.sliding ? "slide" : p.crouch ? "crouch" : "stand";
      state.sprint = !p.sliding && state.speed > 5;
      state.airborne = !p.ground;
      state.reloading = p.reload > 0;
      state.dead = false;
      r.actor.pos.copy(state.pos);
      r.actor.yaw = state.yaw;
      r.rig.update(dt, state);
    }
  }
  event(e) {
    if (!this.active) return;
    if (!this.hasInitialSnapshot && INITIAL_EVENT_TYPES.has(e.type)) {
      if (this.initialEvents.length >= INITIAL_EVENT_LIMIT)
        this.initialEvents.shift();
      this.initialEvents.push({ event: e, received: performance.now() });
      return;
    }
    // The initial snapshot contains the current spawn state. Applying an
    // earlier reliable spawn after it would briefly mark the local player dead.
    if (!this.hasInitialSnapshot && e.type === "spawn") return;
    this.applyEvent(e);
  }
  applyEvent(e) {
    const p = this.player;
    if (e.type === "shot" && e.id !== this.net.id) {
      const r = this.remotes.get(e.id);
      r?.rig.kick();
      if (r) r.actor.lastShot = this.ctx.time();
      const pos = p.pos.clone().set(e.x, e.y, e.z),
        dir = p.pos.clone().set(e.dx, e.dy, e.dz);
      this.ctx.audio.gunshot(e.weapon === "m200" ? "ar" : familyOf(e.weapon), pos);
      this.ctx.fx.muzzle?.(pos, dir, 1, true);
    }
    if (e.type === "damage" && e.id === this.net.id) {
      p.health = e.hp;
      p.addShake(0.25);
      this.debug.gfx.uniforms.uDamage.value = 0.6;
      this.ctx.audio.hurt(0.4);
    }
    if (e.type === "damage" && e.attacker === this.net.id) {
      this.ctx.hud.hit(e.head, false, false);
      if (e.weapon === "melee") {
        this.ctx.audio.foley("melee_hit");
        p.addShake(0.2);
      }
    }
    if (e.type === "kill") {
      const killer = this.actor(e.killer),
        victim = this.actor(e.victim);
      if (victim) {
        victim.alive = false;
        this.ctx.hud.killfeed(killer, victim, e.weapon, e.head);
        if (e.killer === this.net.id) {
          this.ctx.hud.hit(e.head, true, false);
          this.ctx.hud.kill(victim, []);
        }
        if (e.victim === this.net.id) this.ctx.hud.died(killer, familyOf(e.weapon));
      }
    }
    if (e.type === "welcome") {
      this.seq = Math.max(this.seq, e.inputSeq || 0);
      this.specs = e.weapons;
      this.applySpecs();
    }
    if (e.type === "round-start") {
      this.roundStarted = false;
      this.predicted = null;
    }
    if (e.type === "round-end") {
      this.gh.G.state = "over";
      this.dragActive = false;
      this.input.unlock();
      clearInputState(this.input);
      this.ctx?.audio?.slideStop?.();
    }
    if (e.type === "spawn" && e.id === this.net.id) {
      this.player.alive = false;
      this.pending = [];
    }
  }
  exit() {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove("online-session");
    this.lockAttempt++;
    this.lockRequest?.controller.abort();
    this.lockRequest = null;
    this.input.allowLock = false;
    this.input.lockAttempt = (this.input.lockAttempt || 0) + 1;
    this.dragActive = false;
    this.releaseDrag();
    clearInputState(this.input);
    this.controls.abort();
    this.input.unlock();
    for (const id of this.remotes.keys()) this.removeRemote(id);
    this.snapshots = [];
    this.pending = [];
    this.initialEvents = [];
    this.lastSnapshot = null;
    this.room = null;
    this.hasInitialSnapshot = false;
    this.lastUpdateAt = null;
    this.remoteRenderTime = null;
    this.jumpRequestUntil = 0;
    this.jumpInputHeld = false;
    this.crouchInputHeld = false;
    this.slideRequestPending = false;
    this.slideRequestUntil = 0;
    const o = this.original,
      c = this.ctx,
      p = this.player;
    p.update = o.playerUpdate;
    p.damage = o.damage;
    p.team = o.playerTeam;
    c.match.update = o.matchUpdate;
    c.match.damage = o.matchDamage;
    c.match.actors = o.actors;
    c.match.bots = o.bots;
    c.match.scores = o.scores;
    c.match.time = o.time;
    c.hud.update = o.hudUpdate;
    c.combat.fire = o.fire;
    c.combat.melee = o.melee;
    c.arsenal.startReload = o.reload;
    c.arsenal.swap = o.swap;
    this.input.onLockChange = o.lockChange;
    this.input.lock = o.lock;

    this.predicted = null;
    this.gh.G.state = "menu";
    c.match.state = "idle";
    document.querySelector("#hud").style.display = "";
    c.hud.show("menu");
    c.audio.slideStop?.();
    c.audio.music.menu(true);
    p.reset();
    c.arsenal.reset(c.settings.primary);
  }
}
