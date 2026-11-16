import { parentPort, workerData } from 'node:worker_threads';

// Node owns only this transport adapter. The handler and decoder are the
// candidate browser modules. Both directions use actual transferable buffers.
globalThis.self = globalThis;
self.postMessage = (data, transfers = []) => {
  const transferBytes = transfers.map(buffer => buffer.byteLength);
  parentPort.postMessage({ data, transferBytes }, transfers);
};
await import(workerData.moduleURL);
parentPort.on('message', data => self.onmessage({ data }));
