import { protocolError } from "../i18n/errors.js";
import { RTCTransport } from "./webrtc.js";

const PHASES = ["lobby", "countdown", "live", "over"];
import { models, familyOf } from "./weapon-models.js";
import { serverTarget } from "./server-target.js";
export const WEAPONS = ["ar", "smg", "shotgun", "pistol", ...Object.keys(models)];
const INPUT_BYTES = 25;
const INPUT_MAGIC = 0x4748;
const MAX_RELIABLE_COMMANDS = 128;
const MAX_RELIABLE_BYTES = 65536;
const MOTION_FIELDS = ["x", "y", "z", "vx", "vy", "vz", "yaw", "pitch"];
const COUNTER_FIELDS = [
  "hp",
  "ammo",
  "reserve",
  "kills",
  "deaths",
  "score",
  "respawn",
  "reload",
];

async function deadline(operation, timeout, message, signal) {
  if (signal?.aborted) throw Error("连接已取消。");
  let timer, abort;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(message)), timeout);
        if (signal) {
          abort = () => reject(Error("连接已取消。"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}

// Movement datagrams are fixed-size binary packets. This removes JSON parsing
// and UTF-8 allocation from the 30 Hz input path while the server still accepts
// JSON for older clients during rolling upgrades.
export function encodeInput(input, bytes = new Uint8Array(INPUT_BYTES)) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(0, INPUT_MAGIC, true);
  view.setUint8(2, 1);
  view.setUint8(3, 1);
  view.setUint32(4, input.seq >>> 0, true);
  view.setFloat32(8, input.forward ?? 0, true);
  view.setFloat32(12, input.right ?? 0, true);
  view.setFloat32(16, input.yaw ?? 0, true);
  view.setFloat32(20, input.pitch ?? 0, true);
  view.setUint8(24, input.buttons || 0);
  return bytes;
}
export function decodeSnapshot(bytes, original = false) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (bytes.byteLength < 24) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    v.getUint16(0, true) !== 0x4748 ||
    v.getUint8(2) !== 1 ||
    v.getUint8(3) !== 2
  )
    return null;
  const count = v.getUint8(13);
  if (count > 10 || bytes.byteLength !== 24 + 64 * count || v.getUint8(12) > 3)
    return null;
  const out = {
    tick: v.getUint32(4, true),
    time: v.getUint32(8, true),
    phase: PHASES[v.getUint8(12)],
    scores: [v.getUint16(14, true), v.getUint16(16, true)],
    remaining: v.getUint32(18, true),
    winner: v.getInt8(22),
    players: [],
  };
  for (let i = 0; i < count; i++) {
    const o = 24 + i * 64,
      flags = v.getUint8(o + 57);
    const p = { id: v.getUint32(o, true), ack: v.getUint32(o + 4, true) };
    for (let j = 0; j < MOTION_FIELDS.length; j++) {
      const key = MOTION_FIELDS[j];
      p[key] = v.getFloat32(o + 8 + j * 4, true);
      if (!Number.isFinite(p[key])) return null;
    }
    for (let j = 0; j < COUNTER_FIELDS.length; j++)
      p[COUNTER_FIELDS[j]] = v.getUint16(o + 40 + j * 2, true);
    p.team = v.getUint8(o + 56);
    p.alive = !!(flags & 1);
    p.crouch = !!(flags & 2);
    p.ground = !!(flags & 4);
    p.connected = !!(flags & 8);
    p.protected = !!(flags & 16);
    p.jumpHeld = !!(flags & 32);
    p.bot = !!(flags & 64);
    p.sliding = !!(flags & 128);
    p.weapon = WEAPONS[v.getUint8(o + 58)];
    p.slideCooldown = v.getUint8(o + 59) / 100;
    p.cooldown = v.getUint16(o + 60, true);
    p.slideTime = v.getUint16(o + 62, true) / 1000;
    if (p.team > 1 || !p.weapon || (original && v.getUint8(o + 58) >= 4)) return null;
    out.players.push(p);
  }
  return out;
}

export class Connection extends EventTarget {
  constructor({ original = serverTarget.original, connectTimeoutMs = 12000, leaveTimeoutMs = 500, writeTimeoutMs = 5000, snapshotTimeoutMs = 5000 } = {}) {
    super();
    this.original = original;
    this.connectTimeoutMs = connectTimeoutMs;
    this.leaveTimeoutMs = leaveTimeoutMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.snapshotTimeoutMs = snapshotTimeoutMs;
    this.generation = 0;
    this.intentional = true;
    this.stale = false;
    this.staleAt = null;
    this.healthySince = null;
    this.sendChain = Promise.resolve();
    this.sendQueue = { count: 0, bytes: 0, abort: new AbortController() };
    this.inputFlight = null;
    this.retry = 0;
    this.latestTick = 0;
    this.inputBytes = new Uint8Array(INPUT_BYTES);
    this.metrics = {
      inputPackets: 0,
      inputBytes: 0,
      inputDropped: 0,
      snapshots: 0,
      snapshotBytes: 0,
      ack: 0,
      rttMs: 0,
      queuedCommands: 0,
      queuedBytes: 0,
      snapshotAgeMs: 0,
      snapshotGaps: 0,
      connections: 0,
      disconnects: 0,
      lastDisconnectReason: null,
      snapshotStalls: 0,
      snapshotRecoveries: 0,
      maxSnapshotAgeMs: 0,
    };
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  checkSupport() {
    if (typeof globalThis.WebTransport !== "function" && typeof globalThis.RTCPeerConnection !== "function")
      throw Error(
        "当前浏览器不支持 WebTransport 或 WebRTC，请更新浏览器后重试。",
      );
    if (!globalThis.isSecureContext)
      throw Error("联机需要 HTTPS。开发时请使用本机 localhost 地址。");
  }
  async connect(hello, config) {
    if (this.intentional) this.retry = 0;
    this.checkSupport();
    const rtc = config.rtc && typeof globalThis.RTCPeerConnection === "function";
    const kind = config.preferredTransport === "webrtc" || typeof globalThis.WebTransport !== "function" ? "webrtc" : "webtransport";
    if (kind === "webrtc" && !rtc) throw Error("服务器或浏览器未提供 WebRTC 连接支持。");
    const attempt = this.generation + 1;
    try {
      await this.connectAttempt(hello, config, kind);
    } catch (error) {
      if (this.generation !== attempt + 1 || kind !== "webtransport" || !rtc || error.application || this.intentional) throw error;
      this.emit("status", "正在切换备用连接…");
      // A late welcome may already have assigned a room. Resume it so a
      // transport change cannot create a second player or an abandoned room.
      await this.connectAttempt(this.hello?.resume ? this.hello : hello, config, "webrtc");
    }
  }
  async connectAttempt(hello, config, kind) {
    clearInterval(this.watchdog);
    this.sendQueue.abort.abort();
    this.intentional = false;
    this.stale = false;
    this.staleAt = null;
    this.lastSnapshotAt = performance.now();
    this.healthySince = null;
    this.hello = { ...hello };
    this.config = config;
    const generation = ++this.generation;
    this.emit("status", "正在连接服务器…");
    const options = {};
    if (config.certificateHash) {
      options.serverCertificateHashes = [
        {
          algorithm: "sha-256",
          value: Uint8Array.from(atob(config.certificateHash), (c) =>
            c.charCodeAt(0),
          ),
        },
      ];
    }
    let wt;
    const current = () => {
      if (generation !== this.generation) throw Error("连接已取消。");
    };
    try {
      const ticket=this.original ? undefined : this.issueTicket ? await this.issueTicket() : hello.ticket;
      current();
      wt = kind === "webrtc" ? new RTCTransport(config.rtc,ticket) : new WebTransport(config.url, options);
      this.transport = wt;
      wt.closed.catch(() => {});
      // One deadline covers TLS, stream creation, the hello write and welcome.
      // Some browsers can leave stream creation or a write pending indefinitely.
      await deadline(async () => {
        await wt.ready;
        current();
        this.emit("status", "正在建立对战连接…");
        const stream = await wt.createBidirectionalStream();
        current();
        this.writer = stream.writable.getWriter();
        // Safari implements the newer createWritable() API; Chromium also
        // exposes the original writable stream. Both carry QUIC datagrams.
        const outgoing = wt.datagrams.writable ?? wt.datagrams.createWritable?.();
        if (!outgoing?.getWriter)
          throw Error("当前浏览器缺少 WebTransport 数据报支持，请更新浏览器后重试。");
        this.datagrams = outgoing.getWriter();
        // A pending write belongs to its old transport. Reconnection must not
        // share its input buffer or let that write block the new input lane.
        this.inputBytes = new Uint8Array(INPUT_BYTES);
        this.inputFlight = null;
        this.sendChain = Promise.resolve();
        this.sendQueue = { count: 0, bytes: 0, abort: new AbortController() };
        const accepted = new Promise((resolve, reject) => {
          this.handshake = { generation, resolve, reject };
        });
        accepted.catch(() => {});
        this.readEvents(stream.readable, generation);
        this.readSnapshots(wt.datagrams.readable, generation);
        this.emit("status", "正在加入房间…");
        await this.send({ ...hello, ticket, type: "hello" });
        await accepted;
        current();
      }, this.connectTimeoutMs, "连接超时：请重试，并检查服务器 UDP 端口与证书配置。");
      this.handshake = null;
      this.metrics.transport = kind;
      this.metrics.connections++;
      this.lastSnapshotAt = performance.now();
      this.watchdog = setInterval(() => {
        if (generation !== this.generation || this.intentional) return;
        this.checkHealth();
      }, Math.min(1000, this.snapshotTimeoutMs));
      this.watchdog.unref?.();
      this.emit("status", "已连接");
      wt.closed.then(
        () => this.closed(generation, wt.closeReason || "transport-closed"),
        () => this.closed(generation, wt.closeReason || "transport-error"),
      );
    } catch (error) {
      if (generation === this.generation) {
        this.generation++;
        clearInterval(this.watchdog);
        this.sendQueue.abort.abort();
        this.handshake?.reject(error);
        this.handshake = null;
        this.writer = null;
        this.datagrams = null;
        this.transport = null;
        this.sendChain = Promise.resolve();
      }
      try { wt?.close(); } catch {}
      throw error;
    }
  }
  checkHealth(now = performance.now()) {
    if (this.intentional || this.failedGeneration === this.generation) return;
    this.metrics.snapshotAgeMs = Math.round(now - this.lastSnapshotAt);
    this.metrics.maxSnapshotAgeMs = Math.max(this.metrics.maxSnapshotAgeMs, this.metrics.snapshotAgeMs);
    if (this.metrics.snapshotAgeMs <= this.snapshotTimeoutMs) return;
    // ICE can stay connected while SCTP recovers a burst of lost/delayed data.
    // Give that association one bounded probe window instead of immediately
    // destroying it (and paying for another SDP/DTLS handshake). The same
    // window lets queued message tasks run after a stalled browser resumes.
    if (this.transport?.pc?.connectionState === "connected") {
      if (this.staleAt === null) {
        this.staleAt = now;
        this.stale = true;
        this.metrics.snapshotStalls++;
        this.emit("stale", true);
        this.send({ type: "ping", nonce: performance.now() }).catch(() => {});
        return;
      }
      if (now - this.staleAt < this.writeTimeoutMs) return;
    }
    this.fail(this.generation, "snapshot-timeout");
  }
  send(message) {
    if (!this.writer) return Promise.reject(Error("尚未连接服务器"));
    if (this.original) {
      if (message.type === "equip") message = { ...message, weapon: familyOf(message.weapon) };
      // Original servers have no local admission/account protocol. Never send
      // a local ticket, profile secret or save even when a caller supplies one.
      if (message.type === "hello") message = Object.fromEntries(
        ["type", "name", "quick", "create", "public", "difficulty", "room", "resume"]
          .filter(key => Object.hasOwn(message, key)).map(key => [key, message[key]]));
    }
    const writer = this.writer,
      generation = this.generation,
      queue = this.sendQueue;
    // Check command count before serializing: a stalled reliable stream must
    // not retain an unbounded promise chain and command payloads while firing.
    if (queue.count >= MAX_RELIABLE_COMMANDS) {
      this.fail(generation, "command-overflow");
      return Promise.reject(Error("发送队列已满，正在恢复连接。"));
    }
    const data = new TextEncoder().encode(JSON.stringify(message) + "\n");
    if (data.byteLength > 16384 || queue.bytes + data.byteLength > MAX_RELIABLE_BYTES) {
      this.fail(generation, "command-overflow");
      return Promise.reject(Error("发送队列已满，正在恢复连接。"));
    }
    queue.count++;
    queue.bytes += data.byteLength;
    this.metrics.queuedCommands = queue.count;
    this.metrics.queuedBytes = queue.bytes;
    const next = this.sendChain.then(() => {
      if (generation !== this.generation || writer !== this.writer)
        throw Error("连接已取消。");
      return deadline(() => writer.write(data), this.writeTimeoutMs, "发送超时，正在恢复连接。", queue.abort.signal);
    });
    const release = () => {
      queue.count--; queue.bytes -= data.byteLength;
      if (queue === this.sendQueue) {
        this.metrics.queuedCommands = queue.count;
        this.metrics.queuedBytes = queue.bytes;
      }
    };
    next.then(release, () => {
      release();
      if (generation === this.generation && writer === this.writer)
        this.fail(generation, "command-write-failed");
    });
    this.sendChain = next.catch(() => {});
    return next;
  }
  async input(input) {
    if (!this.datagrams) return;
    if (this.inputFlight) {
      this.metrics.inputDropped++;
      return;
    }
    const flight = { writer: this.datagrams, generation: this.generation };
    this.inputFlight = flight;
    try {
      // One write in flight: reuse storage only after the stream consumes it.
      const bytes = encodeInput(input, this.inputBytes);
      const sent = await deadline(() => flight.writer.write(bytes), this.writeTimeoutMs,
        "输入发送超时。", this.sendQueue.abort.signal);
      if (flight.generation === this.generation) {
        if (sent === false) this.metrics.inputDropped++;
        else {
          this.metrics.inputPackets++;
          this.metrics.inputBytes += INPUT_BYTES;
        }
      }
    } catch {
      if (flight.generation === this.generation && flight.writer === this.datagrams)
        this.fail(flight.generation, "input-write-failed");
    } finally {
      if (this.inputFlight === flight) this.inputFlight = null;
    }
  }
  async readEvents(readable, generation) {
    const reader = readable.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    try {
      while (generation === this.generation) {
        const { value, done } = await reader.read();
        if (done || generation !== this.generation || this.failedGeneration === generation) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 65536) throw Error("可靠流消息过大");
        let n;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, n);
          buffer = buffer.slice(n + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "pong" && Number.isFinite(e.nonce))
            this.metrics.rttMs = Math.round(performance.now() - e.nonce);
          if (e.type === "welcome") {
            this.hello = {
              ...this.hello,
              create: false,
              quick: false,
              room: e.room,
              resume: e.resume,
            };
            this.id = e.id;
            this.latestTick = 0;
            this.handshake?.resolve();
          }
          if (e.type === "error" && e.code) e.message = protocolError(e);
          if (e.type === "error" && this.handshake?.generation === generation) {
            const error = Error(e.message);
            error.application = true;
            this.handshake.reject(error);
          }
          if (e.type === "left") this.leftResolve?.();
          this.emit("event", e);
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.handshake?.reject(error);
        this.emit("error", error.message);
      }
    } finally {
      if (this.handshake?.generation === generation)
        this.handshake.reject(Error("服务器在加入房间前关闭了连接。"));
      reader.releaseLock();
      if (generation === this.generation && !this.intentional)
        this.fail(generation, "event-stream-closed");
    }
  }
  async readSnapshots(readable, generation) {
    const reader = readable.getReader();
    try {
      while (generation === this.generation) {
        const { value, done } = await reader.read();
        if (done || generation !== this.generation || this.failedGeneration === generation) break;
        const snapshot = decodeSnapshot(value, this.original);
        if (snapshot && snapshot.tick > this.latestTick) {
          if (this.latestTick) this.metrics.snapshotGaps += Math.max(0, Math.floor((snapshot.tick - this.latestTick) / 2) - 1);
          const now = performance.now();
          const gap = now - (this.lastSnapshotAt ?? now);
          // A welcome followed by another stalled lane is not a recovery.
          // Reset backoff only after a full timeout window of healthy state.
          if (this.healthySince === null || gap > this.snapshotTimeoutMs) this.healthySince = now;
          else if (now - this.healthySince >= this.snapshotTimeoutMs) this.retry = 0;
          this.metrics.maxSnapshotAgeMs = Math.max(this.metrics.maxSnapshotAgeMs, Math.round(gap));
          this.lastSnapshotAt = now;
          this.metrics.snapshotAgeMs = 0;
          if (this.stale) {
            this.stale = false;
            this.staleAt = null;
            this.metrics.snapshotRecoveries++;
            this.emit("stale", false);
          }
          this.metrics.snapshots++;
          this.metrics.snapshotBytes += value.byteLength;
          this.metrics.ack =
            snapshot.players.find((p) => p.id === this.id)?.ack || 0;
          this.latestTick = snapshot.tick;
          this.emit("snapshot", snapshot);
        }
      }
    } catch {
    } finally {
      reader.releaseLock();
      if (generation === this.generation && !this.intentional)
        this.fail(generation, "snapshot-stream-closed");
    }
  }
  fail(generation, reason = "channel-interrupted") {
    if (generation !== this.generation || this.intentional || this.failedGeneration === generation) return;
    const transport = this.transport;
    if (this.handshake?.generation === generation)
      this.handshake.reject(Error("连接通道已中断。"));
    else this.closed(generation, this.transport?.closeReason || reason);
    try { transport?.close(); } catch {}
  }
  closed(generation, reason = "transport-closed") {
    if (generation !== this.generation || this.intentional || this.failedGeneration === generation) return;
    this.failedGeneration = generation;
    this.metrics.disconnects++;
    this.metrics.lastDisconnectReason = reason;
    clearInterval(this.watchdog);
    this.sendQueue.abort.abort();
    this.writer = null;
    this.datagrams = null;
    this.inputFlight = null;
    this.emit("status", "连接中断，正在恢复");
    if (!this.hello?.resume) {
      this.emit("error", "连接已关闭，请重新加入。");
      return;
    }
    this.reconnect(generation);
  }
  async reconnect(generation) {
    if (this.retry >= 4) {
      this.emit("error", "恢复连接失败，请重新加入房间。");
      return;
    }
    const delay = Math.min(4000, 500 * 2 ** this.retry++);
    await new Promise((r) => setTimeout(r, delay));
    if (this.intentional || generation !== this.generation) return;
    try {
      await this.connect(this.hello, this.config);
    } catch (error) {
      this.emit("status", error.message);
      this.reconnect(this.generation);
    }
  }
  async leave() {
    this.intentional = true;
    this.stale = false;
    this.staleAt = null;
    clearInterval(this.watchdog);
    if (this.writer) {
      const accepted = new Promise((resolve) => {
        this.leftResolve = resolve;
      });
      try {
        await deadline(async () => {
          await this.send({ type: "leave" });
          await accepted;
        }, this.leaveTimeoutMs, "退出房间超时。");
      } catch {}
    }
    this.leftResolve = null;
    this.generation++;
    this.sendQueue.abort.abort();
    try { this.transport?.close(); } catch {}
    this.transport = null;
    this.writer = null;
    this.datagrams = null;
    this.id = null;
    this.hello = null;
    this.sendChain = Promise.resolve();
    this.sendQueue = { count: 0, bytes: 0, abort: new AbortController() };
    this.inputFlight = null;
    this.metrics.queuedCommands = this.metrics.queuedBytes = 0;
    this.metrics.transport = null;
  }
}
