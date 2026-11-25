import { Room } from "./room.mjs";
import { roomContent } from "./room-content.mjs";
import { clearSegment } from "./ballistics.mjs";
import { motion } from "../game/client/simulation.js";

export const COOP_MODE = "zombie-coop";
const CAPACITY = 4;
const STEP_MS = 1000 / 60;
const sizes = [4, 6, 8];
const spawnPoints = [[-13.5, 0, 13.4], [13.5, 0, 13.4], [-18.5, 0, 19.6], [19.2, 0, 11.6],
  [-20, 0, 14.5], [20, 0, 14.5], [-9, 0, 13.6], [9, 0, 13.6]];
const staging = [[-3.5, 0, 13.5], [3.5, 0, 13.5], [0, 0, 12.4], [-7, 0, 11.6]];
const evac = [0, 0, 12.4], evacRadius = 3.1;
const pauseMs = 4000, holdTicks = 120;
const archetypes = [
  { hp: 85, pace: 0.44, damage: 14 },
  { hp: 60, pace: 0.73, damage: 12 },
  { hp: 180, pace: 0.36, damage: 24 },
];
const waypoints = [...staging, ...spawnPoints].map(([x, y, z]) => ({ x, y, z }));
const chooseDifficulty = { recruit: 0.80, regular: 1, hardened: 1.15, veteran: 1.3 };
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z, (a.y - b.y) * 2);
const chest = p => [p.x, p.y + 1.1, p.z];
const point = ([x, y, z]) => ({ x, y, z });
const evacPoint = point(evac);

export class CoopRoom extends Room {
  constructor(difficulty, duration, career) {
    super(difficulty, duration, career);
    this.players.length = CAPACITY;
    this.modeId = COOP_MODE;
    this.content = Object.freeze(roomContent(this.map, COOP_MODE));
    this.difficultyScale = chooseDifficulty[this.difficulty] || 1;
    this.phase = "lobby";
    this.round = 0;
    this.infected = [];
    this.stage = "waiting";
    this.wave = 0;
    this.stageUntil = 0;
    this.extracted = 0;
  }

  members() { return this.players.filter(player => !player.bot); }
  present() { return this.players.filter(player => player.peer); }
  summary() {
    const members = this.members();
    return { room: this.id, phase: this.phase, difficulty: this.difficulty, hostName: members[0]?.name,
      ...this.content, humans: members.length, bots: 0,
      capacity: CAPACITY, joinable: this.phase === "lobby" && members.length < CAPACITY };
  }

  state() {
    return { stage: this.stage, wave: this.wave, waves: sizes.length, infected: this.infected.length,
      target: evac, radius: evacRadius, hold: this.extracted / holdTicks,
      connected: this.present().length, capacity: CAPACITY, result: this.result ?? null };
  }

  roster() {
    // Room initializes its common combat state before this mode is constructed.
    if (!this.infected) return;
    this.broadcast({ type: "room", room: this.id, round: this.round,
      host: this.present()[0]?.id, phase: this.phase, scores: this.scores, winner: this.winner,
      difficulty: this.difficulty, ...this.content,
      modeState: this.state(), players: this.members().map(({ id, name, peer, kills, deaths, score, alive }) =>
        ({ id, team: 0, name, bot: false, connected: !!peer, kills, deaths, score, alive })),
    });
  }

  deployPlayer(p) {
    Object.assign(p, motion(point(staging[p.id - 1])), { team: 0, yaw: Math.PI, pitch: 0 });
  }

  join(peer, message, profile) {
    if (!message.resume && this.phase !== "lobby") throw Error("error.room_full");
    // The base room allocates the existing signed seat and rotates its token.
    if (!message.resume) {
      const seat = this.players.find(p => p.bot);
      if (seat) seat.team = 0;
    }
    const p = super.join(peer, message, profile);
    if (!message.resume) this.deployPlayer(p);
    return p;
  }

  command(player, event) {
    if (event.type === "ready") {
      if (event.ready === true && ["lobby", "over"].includes(this.phase) &&
          this.present().length === CAPACITY && player === this.present()[0]) this.begin();
      return;
    }
    if (event.type !== "team") super.command(player, event);
  }

  begin() {
    // Reuse spawn/loadout resets while keeping mode stage and match settlement
    // under CoopRoom. Every member enters on the same authoritative tick.
    this.infected.length = 0;
    this.wave = 0;
    this.result = null;
    this.extracted = 0;
    this.stage = "briefing";
    this.stageUntil = this.tick + 180;
    super.start("countdown");
    for (const player of this.members()) this.deployPlayer(player);
    this.remaining = 3000;
  }

  targets() { return this.infected; }
  simulationPlayers() { return this.members().filter(p => p.alive); }
  visiblePlayers() { return this.members(); }

  hit(player, target, weapon, amount) {
    target.hp = Math.max(0, target.hp - amount);
    const killed = target.hp === 0;
    if (killed) {
      this.infected.splice(this.infected.indexOf(target), 1);
      player.kills++;
      player.score += 100;
      this.scores[0]++;
    }
    player.peer?.send({ type: "zombie-hit", id: target.id, attacker: player.id, weapon, kill: killed });
  }

  end(result = "timeout") {
    this.result = result;
    this.stage = "ended";
    this.phase = "over";
    this.winner = result === "extracted" ? 0 : 1;
    this.infected.length = 0;
    this.broadcast({ type: "round-end", round: this.round, winner: this.winner, modeId: COOP_MODE });
    this.roster();
  }

  startWave() {
    const count = sizes[this.wave++];
    this.stage = "wave";
    this.infected = Array.from({ length: count }, (_, index) => {
      const kind = this.wave === sizes.length && index % 4 === 0 ? 2 : this.wave >= 2 && index % 3 === 0 ? 1 : 0;
      return { ...motion(point(spawnPoints[(index + this.wave - 1) % spawnPoints.length])), kind,
        id: (0x80000000 + this.round * 64 + this.wave * 16 + index) >>> 0,
        hp: Math.ceil(archetypes[kind].hp * this.difficultyScale), yaw: 0, attackAt: 0, attacking: false,
      };
    });
  }

  pursue(zombie, players) {
    let target, nearest = Infinity;
    for (const player of players) {
      if (!player.alive) continue;
      const distance = gap(zombie, player);
      if (distance < nearest) { nearest = distance; target = player; }
    }
    if (!target) { zombie.attacking = zombie.moving = false; return; }
    const cover = this.map.bulletCover;
    const open = clearSegment(chest(zombie), chest(target), cover);
    const attack = open && nearest < 1.35;
    const { pace, damage } = archetypes[zombie.kind];
    zombie.attacking = attack && this.tick < zombie.attackAt;
    if (attack && this.tick >= zombie.attackAt) {
      zombie.attackAt = this.tick + 52;
      zombie.attacking = true;
      target.hp = Math.max(0, target.hp - Math.ceil(damage * this.difficultyScale));
      target.peer?.send({ type: "damage", attacker: zombie.id, id: target.id, hp: target.hp, weapon: "melee" });
      if (!target.hp && target.alive) {
        target.alive = false;
        target.deaths++;
        this.roster();
      }
    }
    // The courtyard anchors form legal routes around the ground-floor dividers.
    // Each infected uses the shortest visible waypoint before resuming pursuit.
    let next = target;
    if (!open) {
      let best = Infinity;
      for (const candidate of [evacPoint, ...waypoints]) {
        const approach = gap(zombie, candidate), cost = approach + gap(candidate, target);
        if (approach > 0.5 && cost < best && clearSegment(chest(zombie), chest(candidate), cover)) {
          best = cost;
          next = candidate;
        }
      }
    }
    const beforeX = zombie.x, beforeZ = zombie.z;
    zombie.yaw = Math.atan2(zombie.x - next.x, zombie.z - next.z);
    this.world.move(zombie, { forward: attack ? 0 : pace, right: 0, yaw: zombie.yaw, buttons: 0 });
    zombie.moving = Math.hypot(zombie.x - beforeX, zombie.z - beforeZ) > 0.006;
  }

  step() {
    if (!this.infected) return;
    if (this.phase === "countdown") {
      this.tick++;
      this.remaining = Math.max(0, (this.stageUntil - this.tick) * STEP_MS);
      if (this.tick >= this.stageUntil) {
        this.phase = "live";
        this.remaining = this.duration;
        this.startWave();
        this.roster();
      }
      return;
    }
    super.step();
    if (this.phase !== "live") return;
    const survivors = this.members().filter(p => p.alive);
    if (!survivors.length) return this.end("overrun");
    const present = survivors.filter(p => p.peer);
    for (const zombie of this.infected) this.pursue(zombie, present);
    if (this.stage === "wave" && !this.infected.length) {
      this.stage = this.wave === sizes.length ? "extraction" : "regroup";
      this.stageUntil = this.tick + pauseMs / STEP_MS;
      this.roster();
    } else if (this.stage === "regroup" && this.tick >= this.stageUntil) {
      this.startWave();
      this.roster();
    } else if (this.stage === "extraction") {
      const allInside = survivors.every(p => p.peer && gap(p, evacPoint) <= evacRadius);
      this.extracted = allInside ? this.extracted + 1 : 0;
      if (this.extracted >= holdTicks) return this.end("extracted");
    }
    if (this.tick % 30 === 0) this.roster();
  }

  packet(viewer) {
    const players = super.packet(viewer);
    if (!this.infected.length || this.phase !== "live") return players;
    const offsetPlayersEnd = 24 + players[13] * 64;
    const infectedBytes = this.infected.length * 14;
    const bytes = Buffer.alloc(players.length + infectedBytes);
    players.copy(bytes, 0, 0, offsetPlayersEnd);
    players.copy(bytes, offsetPlayersEnd + infectedBytes, offsetPlayersEnd);
    bytes[23] = this.infected.length;
    this.infected.forEach((zombie, index) => {
      const offset = offsetPlayersEnd + index * 14;
      bytes.writeUInt32LE(zombie.id, offset);
      for (const [axis, name] of ["x", "y", "z"].entries())
        bytes.writeInt16LE(Math.round(Math.max(-327.67, Math.min(327.67, zombie[name])) * 100), offset + 4 + axis * 2);
      bytes.writeInt16LE(Math.round(zombie.yaw * 32767 / Math.PI), offset + 10);
      bytes[offset + 12] = zombie.kind;
      bytes[offset + 13] = Number(zombie.moving) | (Number(zombie.attacking) << 1);
    });
    return bytes;
  }
}
