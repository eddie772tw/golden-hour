import test from "node:test";
import assert from "node:assert/strict";
import { CoopRoom } from "./coop-room.mjs";
import { decodeSnapshot } from "../game/client/net.js";

function participant(room, name) {
  const events = [];
  const peer = { send: e => events.push(e) };
  const player = room.join(peer, { name }, name);
  return { events, peer, player };
}
const ready = { type: "ready", ready: true };

function squad(duration = 480000) {
  const room = new CoopRoom("regular", duration, {
    progress: () => ({ unlocked: ["ar", "pistol"] }),
    record: () => assert.fail("coop cannot credit elimination in PVP"),
    finishRound: () => assert.fail("coop cannot settle a PVP match"),
  });
  const players = ["Host", "One", "Two", "Three"].map(name => participant(room, name));
  return { room, players };
}

function advance(room, ticks) {
  for (let i = 0; i < ticks; i++) room.step();
}

test("cooperative room has exactly four signed human seats, host start and token-bound resume", () => {
  const room = new CoopRoom();
  const { player: host } = participant(room, "Host");
  for (const name of ["One", "Two"]) participant(room, name);
  room.command(host, ready);
  assert.equal(room.phase, "lobby");
  const { player: member } = participant(room, "Three");
  assert.equal(room.summary().capacity, 4);
  assert.equal(room.summary().humans, 4);
  assert.equal(room.summary().bots, 0);
  assert.throws(() => participant(room, "Fifth"), /room_full/);
  room.command(member, ready);
  assert.equal(room.phase, "lobby");
  room.command(host, ready);
  assert.equal(room.phase, "countdown");
  assert(room.players.every(p => !p.bot && p.team === 0));
  const token = member.token;
  member.peer = null;
  assert.throws(() => room.join({}, { resume: token }, "Fifth"), /resume/);
  const events = [];
  assert.equal(room.join({ send: e => events.push(e) }, { resume: token }, "Three"), member);
  assert.notEqual(member.token, token);
  assert.equal(events.find(e => e.type === "welcome").id, member.id);
  assert.equal(events.find(e => e.type === "room").modeState.connected, 4);
});

test("server simulates three waves, combat and a continuous extraction for all surviving humans", () => {
  const { room, players } = squad();
  room.command(players[0].player, ready);
  advance(room, 180);
  assert.equal(room.stage, "wave");
  assert.equal(room.phase, "live");
  const host = players[0].player;
  const serialized = room.packet(host);
  assert.equal(decodeSnapshot(serialized), null);
  const snapshot = decodeSnapshot(serialized, "community-coop");
  assert.equal(snapshot.players.length, 4);
  assert.equal(snapshot.zombies.length, 4);

  const zombie = room.infected[0];
  Object.assign(host, { x: 0, y: 0, z: 14 });
  Object.assign(zombie, { x: 0, y: 0, z: 15.6, hp: 90 });
  const friendly = players[1].player;
  Object.assign(friendly, { x: 0, y: 0, z: 14.6 });
  room.command(host, { type: "melee", yaw: Math.PI, pitch: 0 });
  assert(!room.infected.includes(zombie));
  assert.equal(host.kills, 1);
  assert.equal(friendly.hp, 100);
  assert(players[0].events.some(e => e.type === "zombie-hit" && e.kill));
  room.command(host, { type: "coop-extract" });
  assert.equal(room.stage, "wave");
  const attacker = room.infected[0];
  Object.assign(attacker, { x: 0, y: 0, z: 15.1 });
  room.step();
  assert(friendly.hp < 100);
  assert(players[1].events.some(e => e.type === "damage" && e.attacker === attacker.id));

  for (let wave = 1; wave <= 3; wave++) {
    assert.equal(room.wave, wave);
    for (const enemy of [...room.infected]) room.hit(host, enemy, "ar", 500);
    room.step();
    if (wave < 3) {
      assert.equal(room.stage, "regroup");
      advance(room, 240);
      assert.equal(room.infected.length, wave === 1 ? 6 : 8);
    }
  }
  assert.equal(room.stage, "extraction");
  const target = room.state().target;
  const move = p => Object.assign(p, { x: target[0], y: target[1], z: target[2], vx: 0, vz: 0 });
  for (const { player } of players.slice(0, 3)) move(player);
  advance(room, 150);
  assert.equal(room.state().hold, 0);
  const outside = players[3].player;
  move(outside);
  advance(room, 85);
  assert(room.state().hold > 0);
  outside.x += 4;
  room.step();
  assert.equal(room.state().hold, 0);
  move(outside);
  advance(room, 120);
  assert.equal(room.result, "extracted");
  assert.equal(room.winner, 0);
  assert(players.every(({ events }) => events.some(e => e.type === "round-end" && e.modeId === "zombie-coop")));
});

test("cooperative wipes and timeouts produce different authoritative failures", () => {
  const wiped = squad();
  wiped.room.command(wiped.players[0].player, ready);
  advance(wiped.room, 180);
  for (const { player } of wiped.players) player.alive = false;
  wiped.room.step();
  assert.equal(wiped.room.result, "overrun");
  const timed = squad(1000);
  timed.room.command(timed.players[0].player, ready);
  advance(timed.room, 180 + 61);
  assert.equal(timed.room.result, "timeout");
});
