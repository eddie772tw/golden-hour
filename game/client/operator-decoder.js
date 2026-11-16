import { decodeOperators } from "./startup-geometry.js";

export async function decodeOperatorPack(buffer, version, signal) {
  signal.throwIfAborted();
  if (typeof Worker !== "function") {
    const start = performance.now();
    const decoded = decodeOperators(buffer, version);
    return { operators: decoded.slice(), grips: decoded.grips, materials: decoded.materials,
      decodeMs: performance.now() - start, mode: "inline" };
  }
  const worker = new Worker(new URL("./operator-decode-worker.js", import.meta.url), { type: "module" });
  let abort;
  try {
    const result = await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = event => {
        event.preventDefault();
        reject(new Error(event.message || "Operator worker failed"));
      };
      worker.onmessageerror = () => reject(new Error("Unable to receive operator pack"));
      worker.postMessage({ buffer, version }, [buffer]);
    });
    return { ...result, mode: "worker" };
  } finally {
    signal.removeEventListener("abort", abort);
    worker.terminate();
  }
}
