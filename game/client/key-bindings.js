export const KEY_BINDINGS_KEY = "gh-key-bindings-v1";
export const MAX_BINDINGS = 4;
const groups = {
  movement: [
    ["forward", "KeyW", "ArrowUp"], ["back", "KeyS", "ArrowDown"],
    ["left", "KeyA", "ArrowLeft"], ["right", "KeyD", "ArrowRight"],
    ["sprint", "ShiftLeft", "ShiftRight"], ["jump", "Space"],
    ["crouch", "KeyC", "ControlLeft", "ControlRight"], ["dive", "KeyX", "KeyZ"],
  ],
  combat: [
    ["fire", "Mouse0"], ["ads", "Mouse1", "Mouse2"], ["reload", "KeyR"],
    ["melee", "KeyV", "KeyF", "Mouse3", "Mouse4"], ["grenade", "KeyG", "KeyQ"],
  ],
  weapons: [
    ["primary", "Digit1"], ["secondary", "Digit2"], ["swap", "KeyE", "WheelUp", "WheelDown"],
    ["inspect", "KeyT"], ["score", "Tab"], ["k9", "KeyB", "Digit3"],
  ],
};

const training = new Set(["dive", "grenade", "k9"]);
const wheel = new Set(["jump", "crouch", "dive", "reload", "melee", "grenade", "primary", "secondary", "swap", "inspect", "k9"]);
export const KEY_ACTIONS = Object.entries(groups).flatMap(([group, entries]) =>
  entries.map(([id, code, ...other]) => ({ id, group, code, defaults: [code, ...other], training: training.has(id) })));
const byID = new Map(KEY_ACTIONS.map(action => [action.id, action]));
const keyPattern = /^(Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal)|Arrow(?:Up|Down|Left|Right)|(?:Shift|Control)(?:Left|Right)|Space|Tab|Enter|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Insert|Home|End|PageUp|PageDown|F[1-479]|Mouse[0-4])$/;
export function validBinding(id, code) {
  return typeof code === "string" &&
    (keyPattern.test(code) || (code === "WheelUp" || code === "WheelDown") && wheel.has(id));
}

export function normalizeBindings(value) {
  const result = {}, used = new Set();
  // Saved entries (including an empty row) precede defaults from newer versions.
  const explicit = KEY_ACTIONS.filter(({ id }) => Array.isArray(value?.[id]));
  for (const { id, defaults } of [...explicit, ...KEY_ACTIONS.filter(action => !explicit.includes(action))]) {
    const codes = result[id] = [];
    for (const code of Array.isArray(value?.[id]) ? value[id] : defaults) {
      if (codes.length >= MAX_BINDINGS) break;
      if (!validBinding(id, code) || used.has(code)) continue;
      used.add(code);
      codes.push(code);
    }
  }
  return result;
}

export class KeyBindings extends EventTarget {
  constructor(storage) {
    super();
    this.storage = storage;
    let saved;
    try { saved = JSON.parse(storage?.getItem(KEY_BINDINGS_KEY)); } catch {}
    this.bindings = normalizeBindings(saved?.version === 1 ? saved.bindings : null);
    this.index();
  }
  index() {
    this.byCode = new Map();
    for (const action of KEY_ACTIONS)
      for (const code of this.bindings[action.id]) this.byCode.set(code, action);
  }
  assign(id, slot, code, replace = false) {
    if (!byID.has(id) || !Number.isInteger(slot) || slot < 0 || slot >= MAX_BINDINGS ||
        code !== null && !validBinding(id, code)) return { invalid: true };
    const owner = this.byCode.get(code);
    if (owner && owner.id !== id) {
      if (!replace) return { conflict: owner.id };
      this.bindings[owner.id] = this.bindings[owner.id].filter(key => key !== code);
    }
    const list = this.bindings[id].slice();
    if (code !== null) {
      const duplicate = list.indexOf(code);
      if (duplicate !== -1 && duplicate !== slot) list[duplicate] = list[slot];
    }
    list[slot] = code;
    this.bindings[id] = list.filter(Boolean);
    return this.save();
  }
  reset() {
    this.bindings = normalizeBindings(null);
    return this.save();
  }
  save() {
    this.index();
    let saved = false;
    try {
      if (this.storage) {
        this.storage.setItem(KEY_BINDINGS_KEY, JSON.stringify({ version: 1, bindings: this.bindings }));
        saved = true;
      }
    } catch {}
    this.dispatchEvent(new Event("change"));
    return { saved };
  }
}

export class BoundInput {
  constructor(input, bindings) {
    this.input = input;
    this.bindings = bindings;
    this.held = new Map();
  }
  press(physical) {
    const code = this.bindings.byCode.get(physical)?.code;
    if (!code || this.held.has(physical)) return;
    this.held.set(physical, code);
    if (!this.input.keys.has(code)) {
      this.input.keys.add(code);
      this.input.down.add(code);
    }
  }
  release(physical) {
    const code = this.held.get(physical);
    if (!code) return;
    this.held.delete(physical);
    if (![...this.held.values()].includes(code) && this.input.keys.delete(code)) this.input.up.add(code);
  }
  releaseMouse() {
    for (let button = 0; button <= 4; button++) this.release("Mouse" + button);
  }
  pulse(physical) {
    const code = this.bindings.byCode.get(physical)?.code;
    if (!code) return;
    this.input.down.add(code);
    this.input.up.add(code);
  }
  reset() {
    this.held.clear();
  }
}
