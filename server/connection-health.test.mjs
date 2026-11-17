import test from "node:test";
import assert from "node:assert/strict";
import { Connection } from "../game/client/net.js";
import { RTCTransport } from "../game/client/webrtc.js";
import { Engine } from "../game/client/engine.js";
import { Room } from "./room.mjs";

function connected(rtc = true) {
  const net = new Connection({ original: true });
  const sent = [], retries = [], stale = [];
  net.intentional = false;
  net.generation = 1;
  net.lastSnapshotAt = 1000;
  net.healthySince = null;
  net.hello = { resume: "test-seat" };
  net.writer = { write: async bytes => sent.push(JSON.parse(new TextDecoder().decode(bytes))) };
  net.transport = { ...(rtc && { pc: { connectionState: "connected" } }), close() {} };
  net.reconnect = generation => retries.push(generation);
  net.addEventListener("stale", ({ detail }) => stale.push(detail));
  return { net, sent, retries, stale };
}

test("a connected RTC survives delayed snapshots, probes once and recovers without another handshake", async () => {
  const { net, sent, retries, stale } = connected();
  net.checkHealth(6001);
  net.checkHealth(7000);
  await net.sendChain;
  assert.deepEqual(sent.map(e => e.type), ["ping"]);
  assert.deepEqual(retries, []);
  assert.equal(net.metrics.snapshotStalls, 1);
  assert.equal(net.stale, true);

  // Only a valid newer authoritative snapshot can clear the stall, not a pong.
  const room = new Room();
  room.step(); room.step();
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; } });
  const received = new Promise(resolve => net.addEventListener("snapshot", resolve, { once: true }));
  const reading = net.readSnapshots(stream, 1);
  controller.enqueue(room.packet(room.players[0]));
  await received;
  assert.deepEqual(stale, [true, false]);
  assert.equal(net.stale, false);
  assert.equal(net.metrics.snapshotRecoveries, 1);
  assert.equal(net.metrics.disconnects, 0);
  assert.ok(Number.isFinite(net.metrics.maxSnapshotAgeMs));
  net.intentional = true;
  controller.close();
  await reading;
});

test("the probe deadline cannot be extended by a live reliable lane; dead snapshots resume once", async () => {
  const { net, retries } = connected();
  net.checkHealth(6001);
  let controller;
  const events = new ReadableStream({ start(c) { controller = c; } });
  const reading = net.readEvents(events, 1);
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "pong", nonce: performance.now() }) + "\n"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(net.stale, true, "a live pong is not a fresh game state");
  net.checkHealth(11000);
  assert.deepEqual(retries, []);
  net.checkHealth(11001);
  net.checkHealth(12000);
  assert.deepEqual(retries, [1]);
  assert.equal(net.writer, null);
  assert.equal(net.metrics.disconnects, 1);
  assert.equal(net.metrics.lastDisconnectReason, "snapshot-timeout");
  controller.close();
  await reading;
});

test("unconnected transports and WebTransport retain the existing bounded failure path", () => {
  for (const state of [null, "disconnected", "failed"]) {
    const { net, retries } = connected(state !== null);
    if (state) net.transport.pc.connectionState = state;
    net.checkHealth(6001);
    assert.deepEqual(retries, [1]);
    assert.equal(net.metrics.snapshotStalls, 0);
  }
});

test("brief welcome/snapshot bursts keep backoff; sustained healthy snapshots reset it", async () => {
  for (const [age, gap, expected] of [[1000, 100, 3], [6000, 100, 0], [6000, 6000, 3]]) {
    const { net } = connected();
    net.retry = 3;
    net.healthySince = performance.now() - age;
    net.lastSnapshotAt = performance.now() - gap;
    const room = new Room(); room.step(); room.step();
    let controller;
    const stream = new ReadableStream({ start(c) { controller = c; } });
    const received = new Promise(resolve => net.addEventListener("snapshot", resolve, { once: true }));
    const reading = net.readSnapshots(stream, 1);
    controller.enqueue(room.packet(room.players[0]));
    await received;
    assert.equal(net.retry, expected);
    net.intentional = true; controller.close(); await reading;
  }
});

test("stale state sends neutral input and no melee until fresh state returns", () => {
  const net = { writer: {}, stale: true, send() { throw Error("stale combat command"); } };
  const engine = new Engine(net);
  engine.input = { keys: new Set(["KeyW", "Space", "Mouse1"]), touchKeys: new Set(), touchForward: 0, touchRight: 0, locked: true };
  engine.player = { alive: true, yaw: 0, pitch: 0 };
  engine.active = true;
  engine.phase = "live";
  engine.gh = { G: { state: "playing" } };
  const input = engine.readInput();
  assert.equal(input.forward, 0);
  assert.equal(input.buttons, 0);
  assert.equal(engine.melee(engine.player, {}), null);
  net.stale = false;
  assert.equal(engine.readInput().forward, 1);
});

test("RTC close records the first lane failure while preserving original channel negotiation", () => {
  const saved = globalThis.RTCPeerConnection;
  class Channel extends EventTarget {
    constructor(label) { super(); this.label = label; }
  }
  globalThis.RTCPeerConnection = class extends EventTarget {
    channels = [];
    createDataChannel(label, options) { this.channels.push({ label, options }); return new Channel(label); }
    createOffer() { return new Promise(() => {}); }
    close() {}
  };
  try {
    const transport = new RTCTransport({});
    assert.deepEqual(transport.pc.channels[1], { label: "state", options: { ordered: false, maxRetransmits: 0, protocol: "gh-pvp-v1" } });
    transport.state.dispatchEvent(new Event("error"));
    transport.close("local-close");
    assert.equal(transport.closeReason, "state-error");
  } finally {
    globalThis.RTCPeerConnection = saved;
  }
});
