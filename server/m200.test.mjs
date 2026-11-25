import test from "node:test";
import assert from "node:assert/strict";
import { Room } from "./room.mjs";
import { Career } from "./career.mjs";
import { ADS } from "../game/client/simulation.js";
import { decodeSnapshot } from "../game/client/net.js";
import { WEAPON_WIRE_IDS, encodeWeaponIndex, decodeWeaponIndex } from "../game/client/weapon-wire.js";
import { emptyProfile, profile, loadout } from "../game/client/progress-ledger.js";

test("M200 and G-Bull snapshot indices remain disjoint by wire format", () => {
  const expected = ["ar", "smg", "shotgun", "pistol", "gbull", "chingi", "linbei", "m200"];
  assert.deepEqual(WEAPON_WIRE_IDS.community, expected);
  for (const [format, ids] of Object.entries(WEAPON_WIRE_IDS)) for (const [index, id] of ids.entries()) {
    assert.equal(encodeWeaponIndex(id, format), index);
    assert.equal(decodeWeaponIndex(index, format), id);
  }
  const frame = Buffer.alloc(88);
  frame.writeUInt32LE(0x02014748);
  frame[13] = 1;
  frame[82] = 4;
  assert.equal(decodeSnapshot(frame).players[0].weapon, "gbull");
  assert.equal(decodeSnapshot(frame, "v60115").players[0].weapon, "m200");
  assert.equal(decodeSnapshot(frame, "v49221"), null);
  assert.equal(decodeSnapshot(frame, true), null);
  frame[82] = 7;
  assert.equal(decodeSnapshot(frame, false).players[0].weapon, "m200");
  assert.equal(decodeSnapshot(frame, "v60115"), null);
  assert.equal(decodeSnapshot(frame, "__proto__"), null);
});

test("M200 is server-authoritative and survives switching and reconnecting", () => {
  const career = new Career();
  try {
    const room = new Room("regular", 480000, career);
    const modernEvents = [], oldEvents = [];
    const peer = { send: event => modernEvents.push(event) };
    const user = room.join(peer, { communityWeaponVersion: 2 }, "modern");
    const target = room.join({ send: event => oldEvents.push(event) }, {}, "old");
    const weaponSeen = viewer => decodeSnapshot(room.packet(viewer)).players.find(p => p.id === user.id)?.weapon;
    Object.assign(user, { x: 0, y: 0, z: 7.6 });
    Object.assign(target, { x: 0, y: 0, z: 6.3, hp: 250 });
    room.command(target, { type: "equip", weapon: "m200" });
    assert.equal(target.weapon, "ar");
    assert.ok(oldEvents.some(event => event.code === "error.weapon_locked"));
    assert.ok(!oldEvents[0].weapons.some(w => w.id === "m200"));
    room.command(user, { type: "equip", weapon: "m200" });
    assert.equal(weaponSeen(user), "m200");
    assert.equal(weaponSeen(target), "ar");
    user.input.buttons = ADS;
    const shot = { type: "shot", yaw: 0, pitch: 0, damage: 999, pellets: 9 };
    room.command(user, shot);
    room.command(user, shot);
    assert.equal(target.hp, 140);
    assert.equal(user.ammo, 4);
    assert.ok(modernEvents.some(event => event.type === "damage" && event.weapon === "m200"));
    assert.ok(oldEvents.some(event => event.type === "damage" && event.weapon === "ar"));
    room.command(user, { type: "reload" });
    assert.equal(user.reload, 0);
    room.command(user, { type: "equip", weapon: "pistol" });
    assert.equal(user.weapon, "pistol");
    room.command(user, { type: "equip", weapon: "m200" });
    assert.equal(user.ammo, 4);
    user.peer = null;
    assert.equal(room.join(peer, { resume: user.token, communityWeaponVersion: 2 }, "modern"), user);
    assert.equal(user.weapon, "m200");
    assert.equal(user.ammo, 4);
    for (let i = 0; i < 76; i++) room.step();
    room.command(user, { type: "reload" });
    assert.equal(user.reload, 2800);
    for (let i = 0; i < 169; i++) room.step();
    assert.equal(user.ammo, 5);
    assert.equal(user.reserve, 24);
    assert.ok(career.progress("modern").unlocked.includes("m200"));
  } finally { career.db.close(); }
});

test("legacy progress supplies a zero M200 record, while loadout saves retain it", () => {
  const old = emptyProfile();
  delete old.weapons.m200;
  assert.deepEqual(profile(old).weapons.m200, { kills: 0, headshots: 0 });
  const saved = { primary: "m200", builds: { m200: { optic: "m200long" } } };
  assert.equal(loadout(saved).primary, "m200");
  assert.deepEqual(loadout(saved).builds.m200, saved.builds.m200);
});
