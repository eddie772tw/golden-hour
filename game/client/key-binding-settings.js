import { bind } from "../i18n/dom.js";
import { message } from "../i18n/index.js";
import { KEY_ACTIONS, MAX_BINDINGS, validBinding } from "./key-bindings.js";

const commonKeys = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Minus: "−", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "\u0060",
};

export function installKeyBindingSettings({ devices, menus, section }) {
  const bindings = devices.keyBindings;
  if (!bindings) return;
  const panel = section.closest(".st-panel");
  const editor = document.createElement("details");
  editor.dataset.keyBindings = "";
  editor.innerHTML = `<summary data-nav></summary><p data-key-help></p>
    <p data-key-status role="status" aria-live="polite"></p>
    <button type="button" data-nav data-key-replace hidden></button>
    <button type="button" data-nav data-key-cancel hidden></button>
    <button type="button" data-nav data-key-reset></button>
    <div data-key-groups></div>`;
  section.append(editor);
  const query = selector => editor.querySelector(selector);
  const groups = query("[data-key-groups]");
  const status = query("[data-key-status]");
  const replace = query("[data-key-replace]");
  const cancel = query("[data-key-cancel]");
  const reset = query("[data-key-reset]");
  const translate = (key, ...args) => message(document.documentElement.lang, "bindings." + key, args);
  const actionName = id => translate("action." + id);
  const keyName = code => {
    if (!code) return translate("empty");
    if (/^(Mouse[0-4]|WheelUp|WheelDown|Space)$/.test(code)) return translate("key." + code);
    if (code.startsWith("Numpad")) return translate("numpad", code.slice(6));
    return commonKeys[code] ?? code.replace(/^(Key|Digit)/, "").replace(/(Left|Right)$/, " $1");
  };
  bind(query("summary"), "bindings.title");
  bind(query("[data-key-help]"), "bindings.help");
  bind(replace, "bindings.replace");
  bind(cancel, "bindings.cancel");
  bind(reset, "bindings.reset");

  for (const group of new Set(KEY_ACTIONS.map(action => action.group))) {
    const field = document.createElement("fieldset");
    const title = document.createElement("legend");
    bind(title, "bindings.group." + group);
    field.append(title);
    for (const action of KEY_ACTIONS.filter(action => action.group === group)) {
      const row = document.createElement("div");
      row.dataset.actionId = action.id;
      const label = document.createElement("span"), keys = document.createElement("div");
      bind(label, "bindings.action." + action.id);
      if (action.training) {
        const note = document.createElement("small");
        bind(note, "bindings.training");
        row.append(label, note, keys);
      } else row.append(label, keys);
      field.append(row);
    }
    groups.append(field);
  }

  let capture = null, conflict = null, swallowClick = false, confirmingReset = false;
  const available = () => editor.open && devices.effective === "keyboard" &&
    menus.pages.settings.classList.contains("on") && panel.classList.contains("on");
  const buttonFor = ({ id, slot }) => query(`[data-action-id="${id}"] [data-slot="${slot}"]`);
  function render() {
    editor.hidden = devices.effective !== "keyboard";
    replace.hidden = cancel.hidden = !conflict;
    for (const { id } of KEY_ACTIONS) {
      const keys = query(`[data-action-id="${id}"] > div`);
      keys.replaceChildren();
      const list = bindings.bindings[id];
      for (let slot = 0; slot < Math.min(MAX_BINDINGS, Math.max(2, list.length + 1)); slot++) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.slot = slot;
        button.dataset.nav = "";
        const recording = capture?.id === id && capture.slot === slot;
        button.textContent = recording ? translate("listening") : list[slot] ? keyName(list[slot]) :
          slot ? translate("add") : translate("empty");
        button.setAttribute("aria-label", translate("slot", actionName(id), slot + 1, button.textContent));
        button.setAttribute("aria-pressed", String(recording));
        keys.append(button);
      }
    }
  }
  function stop(focus = false) {
    const previous = capture ?? conflict;
    capture = conflict = null;
    render();
    if (focus && previous && available())
      (buttonFor(previous) ?? buttonFor({ id: previous.id, slot: 0 }))?.focus();
  }
  function info(key, ...args) {
    bind(status, "bindings." + key, ...args);
  }
  function record(code) {
    if (code && !validBinding(capture.id, code)) {
      info(code.startsWith("Wheel") ? "wheelUnavailable" : "reserved");
      return;
    }
    const { id, slot } = capture;
    const result = bindings.assign(id, slot, code);
    if (result.conflict) {
      conflict = { id, slot, code };
      capture = null;
      render();
      info("conflict", () => keyName(code), () => actionName(result.conflict));
      replace.focus();
    } else {
      stop(true);
      info(result.saved ? "saved" : "session");
    }
  }
  function cancelCapture(focus) {
    stop(focus);
    info("canceled");
  }
  editor.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || !available()) return;
    if (button !== reset && confirmingReset) {
      confirmingReset = false;
      bind(reset, "bindings.reset");
    }
    if (button.hasAttribute("data-slot")) {
      const id = button.closest("[data-action-id]").dataset.actionId, slot = Number(button.dataset.slot);
      capture = { id, slot };
      conflict = null;
      render();
      info("capturing", () => actionName(id));
      buttonFor(capture)?.focus({ preventScroll: true });
    } else if (button === replace && conflict) {
      const { id, slot, code } = conflict;
      const result = bindings.assign(id, slot, code, true);
      stop(true);
      info(result.saved ? "saved" : "session");
    } else if (button === cancel) cancelCapture(true);
    else if (button === reset && confirmingReset) {
      confirmingReset = false;
      bind(reset, "bindings.reset");
      const result = bindings.reset();
      info(result.saved ? "saved" : "session");
    } else if (button === reset) {
      stop();
      confirmingReset = true;
      bind(reset, "bindings.confirmReset");
      info("confirmReset");
    }
  });
  window.addEventListener("keydown", event => {
    if ((!capture && !conflict) || !available() || (!capture && event.code !== "Escape")) return;
    if (event.metaKey || event.altKey || (event.ctrlKey && /^Key[WTNLR]$/.test(event.code))) {
      cancelCapture(true);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === "Escape") cancelCapture(true);
    else if (capture && !event.repeat)
      record(["Backspace", "Delete"].includes(event.code) ? null : event.code);
  }, true);
  for (const type of ["mousedown", "mouseup"]) window.addEventListener(type, event => {
    if (!capture || !available()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (type === "mouseup") {
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
      record("Mouse" + event.button);
    }
  }, true);
  for (const type of ["click", "contextmenu", "auxclick"]) window.addEventListener(type, event => {
    if (!swallowClick && !(capture && available())) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener("wheel", event => {
    if (!capture || !available() || !event.deltaY) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    record(event.deltaY < 0 ? "WheelUp" : "WheelDown");
  }, { capture: true, passive: false });
  function checkAvailability() {
    if (available()) return;
    confirmingReset = false;
    bind(reset, "bindings.reset");
    if (capture || conflict) cancelCapture(false);
  }
  const observer = new MutationObserver(checkAvailability);
  for (const element of [menus.pages.settings, panel]) observer.observe(element, { attributes: true, attributeFilter: ["class"] });
  editor.addEventListener("toggle", checkAvailability);
  window.addEventListener("blur", () => { if (capture || conflict) cancelCapture(false); });
  devices.addEventListener("change", () => { checkAvailability(); render(); });
  bindings.addEventListener("change", render);
  document.addEventListener("languagechange", render);
  render();
}
