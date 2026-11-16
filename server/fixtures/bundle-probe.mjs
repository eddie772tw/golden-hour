import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

// Evaluate actual bundled Three definitions without starting the game or WebGL.
// Keep the boundary explicit: an engine rebundle must update this fixture.
export function loadBundle(sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  const cutoff = source.lastIndexOf("\n  As0().catch(");
  assert.ok(cutoff > 0, "recognized bundle boot boundary");
  const context = {
    console, performance, URLSearchParams, AbortController, DOMException, URL, TextEncoder, TextDecoder,
    location: { search: "" }, navigator: { userAgent: "offline-test" }, addEventListener() {},
    localStorage: { getItem() { return null; }, setItem() {} },
    document: { addEventListener() {}, createElement() { throw Error("Unexpected DOM allocation in bundle test"); } },
    setTimeout() {}, clearTimeout() {},
  };
  context.window = context; context.self = context;
  vm.runInNewContext(source.slice(0, cutoff) + "\n globalThis.__probe = { THREE: Ct };\n})();", context, { timeout: 10000 });
  return context.__probe;
}
