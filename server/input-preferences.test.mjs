import test from "node:test";
import assert from "node:assert/strict";
import { BoundInput, KeyBindings } from "../game/client/key-bindings.js";
import { GyroAim } from "../game/client/gyro-aim.js";

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
}

test("rebinding persists, handles conflicts and preserves hold semantics across aliases", () => {
  const saved = storage();
  const bindings = new KeyBindings(saved);
  assert.deepEqual(bindings.assign("reload", 0, "KeyW"), { conflict: "forward" });
  assert.ok(bindings.assign("reload", 0, "KeyW", true).saved);
  assert.ok(bindings.assign("reload", 1, "WheelUp", true).saved);
  assert.deepEqual(bindings.assign("forward", 0, "WheelDown"), { invalid: true });
  assert.deepEqual(bindings.assign("fire", 0, "Escape"), { invalid: true });
  const restored = new KeyBindings(saved);
  assert.deepEqual(restored.bindings.reload, ["KeyW", "WheelUp"]);
  assert.deepEqual(restored.bindings.forward, ["ArrowUp"]);
  assert.deepEqual(restored.bindings.swap, ["KeyE", "WheelDown"]);
  const input = Object.fromEntries(["keys", "down", "up", "touchKeys"].map(key => [key, new Set()]));
  const bound = new BoundInput(input, restored);
  bound.press("KeyW");
  assert.ok(input.keys.has("KeyR"));
  assert.ok(!input.keys.has("KeyW"));
  bound.release("KeyW");
  input.down.clear();
  bound.pulse("WheelUp");
  assert.ok(input.down.has("KeyR") && input.up.has("KeyR"));
  assert.ok(!input.keys.has("KeyR"));
  bound.press("ShiftLeft");
  bound.press("ShiftRight");
  bound.release("ShiftLeft");
  assert.ok(input.keys.has("ShiftLeft"));
  bound.release("ShiftRight");
  assert.ok(!input.keys.has("ShiftLeft"));
  input.touchKeys.add("KeyW");
  restored.reset();
  assert.ok(input.touchKeys.has("KeyW"));
  assert.deepEqual(new KeyBindings(saved).bindings.reload, ["KeyR"]);
});

function motionWindow(requestPermission) {
  const win = Object.assign(new EventTarget(), {
    document: { hidden: false }, isSecureContext: true, screen: { orientation: { angle: 0 } },
    DeviceMotionEvent: { requestPermission },
  });
  win.setTimeout = callback => { win.timeout = callback; return 1; };
  win.clearTimeout = () => { win.timeout = null; };
  return win;
}

test("gyro waits for permission and valid samples, respects ADS, rotation and inactivity", async () => {
  const win = motionWindow(async () => "granted");
  const saved = storage(), seen = [];
  const gyro = new GyroAim({ win, storage: saved, look: (...args) => seen.push(args) });
  const sample = (timeStamp, alpha = 0, beta = 31) => gyro.sample({ timeStamp, rotationRate: { alpha, beta } });
  gyro.update({ selected: true, active: false, ads: false });
  await gyro.enable();
  assert.equal(gyro.status, "checking");
  win.timeout();
  assert.equal(gyro.status, "noData");
  assert.equal(gyro.listening, false);
  gyro.update({ selected: true, active: true, ads: false });
  sample(100); sample(117);
  assert.equal(gyro.status, "ready");
  assert.deepEqual(seen, []);
  gyro.update({ selected: true, active: true, ads: true });
  sample(200); sample(220);
  assert.ok(Math.abs(seen[0][0] - Math.PI / 300) < 1e-7);
  assert.equal(seen[0][1], 0);
  sample(900);
  assert.equal(seen.length, 1);
  win.screen.orientation.angle = 90;
  sample(920); sample(940);
  assert.ok(Math.abs(seen[1][1] + Math.PI / 300) < 1e-7);
  win.document.hidden = true;
  gyro.update({ selected: true, active: false, ads: false });
  assert.equal(gyro.listening, false);
  assert.equal(new GyroAim({ win, storage: saved }).preferences.enabled, true);
  const denied = new GyroAim({ win: motionWindow(async () => "denied"), storage: storage() });
  await denied.enable();
  assert.equal(denied.status, "denied");
  assert.equal(denied.preferences.enabled, false);
});
