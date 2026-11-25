import test from "node:test";
import assert from "node:assert/strict";
import { loadApiConfig, originalSocketURL } from "../game/client/api-config.js";
import { connectionTarget } from "../game/client/server-target.js";
import { Connection, decodeSnapshot } from "../game/client/net.js";
import { decodeOriginalCosmetic, matchOriginalV60115Room, originalV60115Catalog,
  originalV60115Hello, ORIGINAL_V60115_ORIGIN } from "../game/client/original-v60115.js";

const page = "http://localhost:47119/";
const remote = "http://localhost:47120/";
const hello = { name: "Fixture", quick: true, mapId: "hotel", modeId: "tdm", difficulty: "regular" };
const identity = "fixture-uid";
const headers = { headers: { "content-type": "application/json" } };
const room = { type: "room", room: "FEEDFACE", mapId: "hotel", mapVersion: "2", modeId: "tdm",
  clientScene: "hotel", modeAdapter: "teams", phase: "live", players: [] };

test("v60115 uses its published map/mode versions and isolates both identity and legacy selection", () => {
  const official = connectionTarget(page + "?server=" + encodeURIComponent(ORIGINAL_V60115_ORIGIN));
  assert.equal(official.weaponFormat, "v60115");
  assert.equal(connectionTarget(page + "?server=https://example.org").version, undefined);
  assert.throws(() => originalV60115Hello({ ...hello, uid: identity, ticket: "ticket" }), /Toy/);
  assert.deepEqual(originalV60115Hello({ ...hello, ticket: "ticket", profile: "profile", uid: "input" }, identity),
    { type: "hello", uid: identity, name: "Fixture", weaponProtocol: 2,
      cosmeticDatagrams: true, shotAcks: true, quick: true, mapId: "hotel", modeId: "tdm", difficulty: "regular" });
  assert.deepEqual(originalV60115Hello({ ...hello, room: room.room, resume: "resume" }, identity),
    { type: "hello", uid: identity, name: "Fixture", weaponProtocol: 2, cosmeticDatagrams: true,
      shotAcks: true, room: room.room, resume: "resume" });
  const catalog = originalV60115Catalog({ defaultMap: "hotel", defaultMode: "tdm",
    maps: [{ id: "hotel", name: "Hotel", version: "2", clientScene: "hotel", modes: ["tdm"] }],
    modes: [{ id: "tdm", name: "TDM", clientAdapter: "teams" }] });
  assert.equal(matchOriginalV60115Room(room, catalog).map.version, "2");
  assert.throws(() => matchOriginalV60115Room({ ...room, mapVersion: "1" }, catalog), /目录/);
  assert.throws(() => matchOriginalV60115Room({ ...room, modeAdapter: "zombies" }, catalog), /目录/);
  assert.throws(() => originalV60115Catalog({ ...catalog, maps: [{ ...catalog.maps[0], version: "../2" }] }), /无效/);
});

function snapshotPacket() {
  const bytes = Buffer.alloc(24 + 64 + 14 + 4);
  bytes.writeUInt32LE(0x04014748);
  bytes.writeUInt32LE(6, 4);
  bytes[12] = 2;
  bytes[13] = 1;
  bytes[23] = 1;
  bytes.writeUInt32LE(1, 24);
  bytes[24 + 58] = 4;
  bytes.writeUInt32LE(0x80000001, 88);
  bytes.writeInt16LE(-155, 92);
  bytes[100] = 1;
  bytes[101] = 3;
  bytes.writeUInt32LE(10, 102);
  return bytes;
}
function cosmeticPacket() {
  const bytes = Buffer.alloc(36);
  bytes.writeUInt32LE(0x03014748);
  bytes.writeUInt32LE(1, 4);
  bytes[8] = 4;
  bytes.writeFloatLE(-1, 12);
  bytes.writeFloatLE(1, 32);
  return bytes;
}

test("v60115 extended packet boundaries isolate v49221 and decode M200, zombie state, shot ACK and cosmetics", () => {
  const bytes = snapshotPacket(), s = decodeSnapshot(bytes, "v60115");
  assert.equal(s.players[0].weapon, "m200");
  assert.equal(s.players[0].shotAck, 10);
  assert.deepEqual(s.zombies, [{ id: 0x80000001, kind: 1, x: -1.55, y: 0, z: 0, yaw: 0,
    moving: true, attacking: true }]);
  assert.equal(decodeSnapshot(bytes, true), null);
  assert.equal(decodeSnapshot(bytes, "v49221"), null);
  assert.equal(decodeSnapshot(bytes.subarray(0, -1), "v60115"), null);
  bytes[100] = 3;
  assert.equal(decodeSnapshot(bytes, "v60115"), null);
  const cosmetic = cosmeticPacket();
  assert.deepEqual(decodeOriginalCosmetic(cosmetic),
    { type: "shot", id: 1, weapon: "m200", x: -1, y: 0, z: 0, dx: 0, dy: 0, dz: 1 });
  cosmetic.writeFloatLE(Infinity, 12);
  assert.equal(decodeOriginalCosmetic(cosmetic), null);
});

test("modern socket only uses the approved origin; RTC failure falls back and reconnect resumes the same seat", async t => {
  const frames = [], sockets = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    static CLOSING = 2;
    constructor(url, protocol) {
      super();
      assert.equal(url.href, "ws://localhost:47120/api/socket");
      this.protocol = protocol;
      this.readyState = Socket.OPEN;
      this.bufferedAmount = 0;
      sockets.push(this);
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(value) {
      if (typeof value !== "string") return;
      const sent = JSON.parse(value);
      frames.push(sent);
      if (sent.type === "hello") {
        this.reliable({ type: "welcome", id: 1, room: room.room, resume: "seat-token" });
        this.reliable(room);
      } else if (sent.type === "leave") this.reliable({ type: "left" });
    }
    reliable(value) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) + "\n" })); }
    packet(bytes) { this.dispatchEvent(new MessageEvent("message", {
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })); }
    close() { this.readyState = Socket.CLOSING; }
  }
  const restore = new Map();
  for (const [name, value] of Object.entries({
    isSecureContext: true, WebSocket: Socket,
    RTCPeerConnection: class { constructor() { throw Error("fixture signaling failure"); } },
  })) {
    restore.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  t.after(() => {
    for (const [name, previous] of restore) {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    }
  });
  const cfg = { protocol: 1, rtc: { url: "/api/rtc/offer" }, websocket: true, socketURL: "wss://malicious.invalid/" };
  const config = await loadApiConfig(remote, page, () => new Response(JSON.stringify(cfg), headers), { originalVersion: "v60115" });
  assert.equal(originalSocketURL(cfg), null);
  assert.equal(originalSocketURL(config).origin, "ws://localhost:47120");
  await assert.rejects(loadApiConfig(remote, page, () => new Response(JSON.stringify({
    ...cfg, rtc: { url: "https://malicious.invalid/" },
  }), headers), { originalVersion: "v60115" }), /信令/);
  const noIdentity = new Connection({ original: true, originalVersion: "v60115" });
  await assert.rejects(noIdentity.connect({ ...hello, uid: identity }, config), /Toy/);
  assert.equal(sockets.length, 0);

  const net = new Connection({ original: true, originalVersion: "v60115", toyIdentity: async () => identity });
  t.after(() => net.leave());
  const statuses = [], events = [];
  net.addEventListener("status", event => statuses.push(event.detail));
  net.addEventListener("event", event => events.push(event.detail));
  await net.connect({ ...hello, ticket: "local-ticket" }, config);
  assert(statuses.some(status => status.includes("备用")));
  assert.equal(net.metrics.transport, "websocket");
  assert.equal(frames[0].ticket, undefined);
  assert.equal(frames[0].uid, identity);
  assert.equal(net.hello.uid, undefined);
  assert.equal(events.find(event => event.type === "room").mapVersion, "2");
  const received = new Promise(resolve => net.addEventListener("snapshot", e => resolve(e.detail), { once: true }));
  sockets[0].packet(cosmeticPacket());
  await new Promise(resolve => setImmediate(resolve));
  assert(events.some(e => e.type === "shot" && e.weapon === "m200"));
  sockets[0].packet(snapshotPacket());
  assert.equal((await received).players[0].shotAck, 10);
  const resumed = new Promise(resolve => net.addEventListener("event", e => {
    if (e.detail.type === "welcome") resolve(e.detail);
  }));
  sockets[0].dispatchEvent(new Event("close"));
  assert.equal((await resumed).id, 1);
  assert.equal(sockets.length, 2);
  assert.equal(frames[1].resume, "seat-token");
  assert.equal(frames[1].quick, undefined);
  assert.equal(frames[1].room, room.room);
  await net.leave();
});
