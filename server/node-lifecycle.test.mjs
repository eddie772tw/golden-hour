import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractAudioOwner } from "../scripts/performance/audio_latency_probe.js";

const source = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");

test("audio allocator preserves node types, unique ownership and neutral filter gain after release", () => {
  const param = () => ({ value: 0, cancelScheduledValues() {} });
  const owner = extractAudioOwner(source).replace("    return zt;", "    zt.nodes = { gain: i, filter: a, release: n }; return zt;");
  const api = new Function(owner + "\nreturn eZ();")();
  api._engine.ctx = {
    createGain: () => ({ kind: "gain", gain: param(), disconnect() {} }),
    createBiquadFilter: () => ({ kind: "biquad", gain: param(), frequency: param(), Q: param(), disconnect() {} }),
  };
  const { gain, filter, release } = api.nodes;
  const eq = filter("peaking", 1000, .7, 12);
  release(eq);
  assert.equal(gain().kind, "gain", "BiquadFilterNode also exposes .gain; it cannot be recycled as a GainNode");
  const g = gain(); release(g); release(g);
  assert.notEqual(gain(), gain(), "two live voices must never acquire the same released node");
  const boosted = filter("peaking", 800, 1, 9); release(boosted);
  assert.equal(filter("peaking", 800, 1, 0).gain.value, 0);
});

test("GTAO visibility override discovers newly added lines and preserves pre-hidden objects", () => {
  const start = source.indexOf("    _overrideVisibility() {");
  const end = source.indexOf("    _generateNoise(", start);
  assert.ok(start > 0 && end > start);
  // Exercise the actual methods without constructing GPU resources.
  const Pass = new Function("return class {" + source.slice(start, end) + "}")();
  const points = { isPoints: true, visible: true }, hidden = { isLine: true, visible: false };
  const children = [points, hidden];
  const pass = new Pass();
  pass.scene = { traverse(fn) { for (const child of children) fn(child); } };
  pass._visibilityCache = [];
  pass._overrideVisibility(); pass._restoreVisibility();
  const lateLine = { isLine2: true, visible: true }; children.push(lateLine);
  pass._overrideVisibility();
  assert.equal(lateLine.visible, false, "scene mutation must be reflected in the next normal-buffer pass");
  pass._restoreVisibility();
  assert.equal(points.visible, true); assert.equal(lateLine.visible, true); assert.equal(hidden.visible, false);
});
