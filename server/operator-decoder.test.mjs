import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Worker as Thread } from 'node:worker_threads';
import { decodeOperators } from '../game/client/startup-geometry.js';
import { decodeOperatorPack } from '../game/client/operator-decoder.js';

const file = await readFile(new URL('../game/assets/operators.bin', import.meta.url));
const realBuffer = () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const header = JSON.parse(file.subarray(8, 8 + file.readUInt32LE(0)).toString('utf8'));
const original = decodeOperators(realBuffer(), header.source);

function checkPack(result, oraclePack = original) {
  assert.deepEqual(Array.from(result.operators), Array.from(oraclePack));
  assert.deepEqual(result.materials, oraclePack.materials);
  assert.deepEqual(result.grips, oraclePack.grips);
  assert.ok(Number.isFinite(result.decodeMs) && result.decodeMs >= 0);

  // Compare byte ranges, including float representation, and the complete
  // alias graph: two views share storage iff their oracle views share storage.
  const views = pack => [
    ...pack.operators.flatMap(op => [...Object.values(op.attributes).map(a => a.data), op.index, op.fp]),
    ...(pack.materials?.textures || []).map(t => t.data),
  ];
  const actual = views(result);
  const expected = views({ operators: oraclePack, materials: oraclePack.materials });
  const toBytes = view => Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  const backing = new Map();
  for (const [i, oracle] of expected.entries()) {
    const other = actual[i];
    assert.equal(other.constructor, oracle.constructor);
    assert.equal(other.byteOffset, oracle.byteOffset);
    assert.equal(other.byteLength, oracle.byteLength);
    assert.equal(other.buffer.byteLength, oracle.buffer.byteLength);
    assert.ok(toBytes(other).equals(toBytes(oracle)));
    if (backing.has(oracle.buffer)) assert.equal(other.buffer, backing.get(oracle.buffer));
    else backing.set(oracle.buffer, other.buffer);
  }
  assert.equal(new Set(backing.values()).size, backing.size);
  return [...backing.values()].map(buffer => buffer.byteLength).sort((a,b) => a-b);
}

class EventPort extends EventTarget {
  static last;
  terminated = 0;
  constructor() {
    super();
    EventPort.last = this;
  }
  emit(type, event) {
    this.dispatchEvent(event);
    this['on' + type]?.(event);
  }
  terminate() { this.terminated++; }
}

class BrowserWorker extends EventPort {
  constructor(url, options) {
    super();
    assert.equal(options.type, 'module');
    this.thread = new Thread(new URL('./fixtures/operator-worker-bridge.mjs', import.meta.url), { workerData: { moduleURL: String(url) } });
    this.thread.on('message', ({ data, transferBytes }) => {
      this.transferBytes = transferBytes;
      this.emit('message', new MessageEvent('message', { data }));
    });
    this.thread.on('error', error => this.emit('error', Object.assign(new Event('error'), { message: error.message })));
  }
  postMessage(data, transfers) {
    this.inputTransfers = transfers.map(buffer => buffer.byteLength);
    this.thread.postMessage(data, transfers);
  }
  terminate() {
    super.terminate();
    void this.thread.terminate();
  }
}

class SilentWorker extends EventPort {
  postMessage(data, transfers) {
    // Transfer the input like a real Worker but don't schedule a reply.
    structuredClone(data, { transfer: transfers });
  }
}

function host(t, Worker) {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: Worker });
  EventPort.last = undefined;
  t.after(() => {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete globalThis.Worker;
  });
}

test('real pack, module worker transport, full byte and backing-store oracle', {timeout:10000}, async t => {
  host(t, BrowserWorker);
  const input = realBuffer();
  const result = await decodeOperatorPack(input, header.source, new AbortController().signal);
  assert.equal(result.mode, 'worker');
  assert.equal(input.byteLength, 0);
  assert.deepEqual(EventPort.last.inputTransfers, [file.byteLength]);
  const outputBytes = checkPack(result);
  assert.deepEqual(EventPort.last.transferBytes.sort((a,b) => a-b), outputBytes);
  assert.equal(EventPort.last.terminated, 1);
  t.diagnostic(JSON.stringify({ fileSHA256: createHash('sha256').update(file).digest('hex'),
    teams: result.operators.length, textureBytes: result.materials.textures.map(t => t.data.byteLength),
    views: result.operators.reduce((n, op) => n + Object.keys(op.attributes).length + 2, result.materials.textures.length),
    transferInBytes: file.byteLength, transferOutStores: outputBytes }));
});

test('Worker unavailable: inline path preserves the same bytes and metadata', async t => {
  host(t, undefined);
  const result = await decodeOperatorPack(realBuffer(), header.source, new AbortController().signal);
  assert.equal(result.mode, 'inline');
  checkPack(result);
});

test('worker rejects malformed and stale inputs and terminates each job', {timeout:10000}, async t => {
  host(t, BrowserWorker);
  for (const [input, version] of [[new ArrayBuffer(4), header.source], [realBuffer(), header.source+'-stale']]) {
    await assert.rejects(async () => decodeOperatorPack(input, version, new AbortController().signal));
    assert.equal(input.byteLength, 0);
    assert.equal(EventPort.last.terminated, 1);
  }
});

test('abort before start does not create a worker or detach the input', async t => {
  host(t, SilentWorker);
  const ctrl = new AbortController();
  ctrl.abort();
  const input = realBuffer();
  await assert.rejects(async () => decodeOperatorPack(input, header.source, ctrl.signal));
  assert.equal(EventPort.last, undefined);
  assert.equal(input.byteLength, file.byteLength);
});

test('abort after transfer terminates once and a late reply has no effect', async t => {
  host(t, SilentWorker);
  const ctrl = new AbortController();
  const input = realBuffer();
  const pending = decodeOperatorPack(input, header.source, ctrl.signal);
  assert.equal(input.byteLength, 0);
  const worker = EventPort.last;
  ctrl.abort();
  await assert.rejects(pending);
  worker.emit('message', new MessageEvent('message', {data:{}}));
  assert.equal(worker.terminated, 1);
});

test('worker startup or decode event failure rejects the detached job', async t => {
  host(t, SilentWorker);
  for (const type of ['error', 'messageerror']) {
    const ctrl = new AbortController();
    const input = realBuffer();
    const pending = decodeOperatorPack(input, header.source, ctrl.signal);
    const worker = EventPort.last;
    assert.equal(input.byteLength, 0);
    worker.emit(type, Object.assign(new Event(type, {cancelable:true}), {message:'simulated worker failure'}));
    await assert.rejects(pending);
    ctrl.abort();
    assert.equal(worker.terminated, 1);
  }
});

test('synchronous postMessage failure terminates the new worker', async t => {
  host(t, class extends EventPort { postMessage() { throw new Error('simulated post failure'); } });
  await assert.rejects(async () => decodeOperatorPack(realBuffer(), header.source, new AbortController().signal));
  assert.equal(EventPort.last.terminated, 1);
});

test('older optional material layouts preserve transferred backing stores', {timeout:10000}, async t => {
  host(t, BrowserWorker);
  for (const layout of ['no-materials', 'mixed-encodings']) {
    const modified = structuredClone(header);
    if (layout === 'no-materials') {
      delete modified.materials;
      delete modified.grips;
    } else {
      // Unfiltered texture bytes and every geometry view can share the
      // original pack. The other two textures still decode to separate stores.
      delete modified.materials.textures[0].encoding;
    }
    const headerBytes = Buffer.from(JSON.stringify(modified));
    const start = 8 + Math.ceil(headerBytes.length/8)*8;
    const originalStart = 8 + Math.ceil(file.readUInt32LE(0)/8)*8;
    const pack = new ArrayBuffer(start + file.length - originalStart);
    new DataView(pack).setUint32(0, headerBytes.length, true);
    new Uint8Array(pack, 8, headerBytes.length).set(headerBytes);
    new Uint8Array(pack, start).set(file.subarray(originalStart));
    const oracle = decodeOperators(pack.slice(0), header.source);
    const result = await decodeOperatorPack(pack, header.source, new AbortController().signal);
    assert.equal(result.mode, 'worker');
    assert.equal(pack.byteLength, 0);
    const expected = checkPack(result, oracle);
    assert.deepEqual(EventPort.last.transferBytes.sort((a,b) => a-b), expected);
    assert.equal(expected.length, layout === 'no-materials' ? 1 : 3);
    assert.equal(EventPort.last.terminated, 1);
  }
});

test('worker constructor rejection preserves input for caller fallback', async t => {
  host(t, class { constructor() { throw new Error('Policy refused module worker'); } });
  const input = realBuffer();
  await assert.rejects(decodeOperatorPack(input, header.source, new AbortController().signal), /Policy refused/);
  assert.equal(input.byteLength, file.length);
});
