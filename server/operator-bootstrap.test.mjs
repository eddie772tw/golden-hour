// Exercise the actual startup consumer and loader with a virtual clock. Network,
// module loading, GPU object construction and page lifecycle are test doubles.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../game/client/bootstrap.js", import.meta.url), "utf8");
function region(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, "missing bootstrap region " + from);
  return source.slice(start, end);
}
const consumer = region("  async prepareOperators()", "  swatches:");
const flags = region("const params =", "const policy =");
const loader = region("const cancelOperatorLoad =", "if (!baking) {").replace(
  'import("./operator-decoder.js")', 'importDecoder()');
const startLoader = new Function("env", `
  const { location, base, version, stats, fetch, addEventListener, removeEventListener,
    setTimeout, clearTimeout, decodeOperators, restoreOperator, importDecoder, globalThis } = env;
  ${flags}
  const boot = { operators: null, grips: null, actorMaterialPack: null, ${consumer} };
  ${loader}
  return { boot, done: operatorJob };
`);

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(search = "?operatorDecode=worker") {
  const network = Promise.withResolvers(), decode = Promise.withResolvers();
  const timers = new Map(), listeners = new Map();
  const stats = { operators: "fallback" };
  const request = { fetches: 0, imports: 0, decodes: 0 };
  const pack = { operators: [{team: 0}, {team: 1}], grips: ["grip"], materials: {textures: []} };
  const globals = { GH: { ready: false } };
  const env = {
    location: { search }, base: new URL("http://localhost/"), version: "test", stats, globalThis: globals,
    fetch(url, { signal }) {
      request.fetches++;
      assert.equal(url.pathname, "/assets/operators.bin");
      request.signal = signal;
      return network.promise;
    },
    decodeOperators() { return Object.assign(pack.operators, { grips: pack.grips, materials: pack.materials }); },
    restoreOperator: record => record,
    async importDecoder() {
      request.imports++;
      return { decodeOperatorPack(buffer, version, signal) {
        signal.throwIfAborted();
        request.decodes++;
        assert.equal(version, "test");
        return decode.promise;
      }};
    },
    setTimeout(callback, ms) { const id = Symbol(ms); timers.set(id, { ms, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { assert.equal(listeners.get(type), fn); listeners.delete(type); },
  };
  const { boot, done } = startLoader(env);
  return { boot, done, network, decode, pack, globals, stats, request, listeners, timers,
    fetchOK() { network.resolve({ ok: true, async arrayBuffer() { return new ArrayBuffer(8); } }); },
    deliver() { decode.resolve({ ...pack, decodeMs: 7, mode: "worker" }); },
    expire(ms) {
      const entry = [...timers].find(([, timer]) => timer.ms === ms);
      assert.ok(entry, "deadline registered");
      timers.delete(entry[0]); entry[1].callback();
    },
    clean() { assert.equal(timers.size, 0); assert.equal(listeners.size, 0); },
    fallback() {
      assert.equal(boot.restoreOperator(0), null);
      assert.equal(boot.grips, null); assert.equal(boot.actorMaterialPack, null);
      assert.equal(stats.operators, "fallback");
    },
  };
}

test("worker success publishes all pack fields and each team can be consumed once", async () => {
  const f = fixture(); const stage = f.boot.prepareOperators();
  f.fetchOK(); f.deliver(); await stage;
  assert.equal(f.request.decodes, 1);
  assert.equal(f.boot.grips, f.pack.grips); assert.equal(f.boot.actorMaterialPack, f.pack.materials);
  assert.equal(f.stats.operatorDecodeMode, "worker"); assert.equal(f.stats.operatorDecodeMs, 7);
  assert.deepEqual(f.boot.restoreOperator(0), {team: 0}); assert.equal(f.boot.restoreOperator(0), null);
  assert.deepEqual(f.boot.restoreOperator(1), {team: 1}); assert.equal(f.stats.operatorsRestored, 2);
  f.clean();
});

test("default inline path and opt-in with bake", async () => {
  const a = fixture("?solo"); a.fetchOK(); await a.boot.prepareOperators();
  assert.equal(a.request.fetches, 1); assert.equal(a.request.imports, 0);
  assert.equal(a.stats.operatorDecodeMode, "inline"); assert.deepEqual(a.boot.restoreOperator(1), {team: 1});
  a.clean();
  const b = fixture("?bake&operatorDecode=worker"); await b.boot.prepareOperators();
  assert.equal(b.request.fetches, 0); assert.equal(b.request.imports, 0); b.fallback(); b.clean();
});

for (const state of ["fetching", "decoding"]) {
  test("75 ms stage deadline prevents late publication while " + state, async () => {
    const f = fixture(); const stage = f.boot.prepareOperators();
    if (state === "decoding") { f.fetchOK(); await settle(); assert.equal(f.request.decodes, 1); }
    f.expire(75); await stage;
    assert.ok(f.request.signal.aborted);
    f.fetchOK(); f.deliver(); await f.done;
    f.fallback(); assert.match(f.stats.operatorDecodeError, /deadline/i);
    assert.equal(f.request.decodes, state === "decoding" ? 1 : 0); f.clean();
  });
}

for (const trigger of ["pagehide", "load deadline", "already ready"]) {
  test(trigger + " discards late decoded pack and cleans up", async () => {
    const f = fixture(); f.fetchOK(); await settle(); assert.equal(f.request.decodes, 1);
    if (trigger === "pagehide") f.listeners.get("pagehide")();
    if (trigger === "load deadline") f.expire(15000);
    if (trigger === "already ready") f.globals.GH.ready = true;
    f.deliver(); await f.done; await f.boot.prepareOperators(); f.fallback(); f.clean();
    assert.equal(f.request.signal.aborted, trigger !== "already ready");
  });
}

for (const failure of ["fetch", "worker"]) {
  test(failure + " failure permits procedural startup", async () => {
    const f = fixture();
    if (failure === "fetch") f.network.resolve({ ok: false, status: 404 });
    else { f.fetchOK(); await settle(); f.decode.reject(Error("worker unavailable")); }
    await f.boot.prepareOperators(); f.fallback(); f.clean();
    assert.match(f.stats.operatorDecodeError, failure === "fetch" ? /404/ : /worker unavailable/);
  });
}
