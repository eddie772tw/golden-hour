import { CONTROL_DEFS, defaultLayout, normalizeLayout, controlRect, overlappingControls } from "./touch-layout.js";

// Reuse the native settings panel and page controller, including Back/Escape.
export function installTouchSettings({ menus, controls }) {
  if (!controls) return;
  const settings = document.createElement("section");
  settings.className = "touch-settings";
  settings.innerHTML = `<h4>移动端触屏操作</h4>
    <p>左侧摇杆移动，右半屏空白处滑动转向。可按自己的握持方式安排按键。</p>
    <label class="touch-setting">转向灵敏度 <input aria-label="触屏转向灵敏度" type="range" min="0.25" max="3" step="0.05" data-touch-sensitivity><output></output></label>
    <label class="touch-setting"><input type="checkbox" data-touch-fire-look> 开火键支持拖动瞄准</label>
    <button class="btn" data-nav data-touch-edit>自定义摇杆与按键布局 ›</button>
    <p class="touch-settings-status" role="status">布局保存在当前浏览器，单人与联机共用。</p>`;
  menus.pages.settings.querySelector('.st-panel[data-tab="controls"]').append(settings);
  const page = menus._page("touch-layout", `
    <header class="topbar"><button class="backb" data-nav data-touch-cancel>‹ 返回设置</button><h2>触屏布局</h2></header>
    <div class="touch-layout-content">
      <div class="touch-layout-preview">
        <p>拖动摇杆或按键调整位置；选中后可调整大小与透明度。右半屏为转向区域。</p>
        <div class="touch-layout-screen" aria-label="触屏布局预览">
          <span class="touch-layout-zone">右半屏 · 滑动转向</span><span class="touch-layout-cross" aria-hidden="true">＋</span>
        </div>
      </div>
      <section class="touch-layout-options">
        <label class="touch-setting">选中控件<select aria-label="选中控件" data-touch-select>${CONTROL_DEFS.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select></label>
        <label class="touch-setting">大小<input aria-label="控件大小" type="range" min="44" max="120" step="2" data-touch-prop="size"><output></output></label>
        <label class="touch-setting">透明度<input aria-label="控件透明度" type="range" min="0.25" max="1" step="0.05" data-touch-prop="opacity"><output></output></label>
        <label class="touch-setting">水平位置<input aria-label="控件水平位置" type="range" min="0" max="1" step="0.01" data-touch-prop="x"><output></output></label>
        <label class="touch-setting">垂直位置<input aria-label="控件垂直位置" type="range" min="0" max="1" step="0.01" data-touch-prop="y"><output></output></label>
        <p class="touch-layout-status" role="status">预览包含全部按键，联机中仅显示已支持的动作。</p>
        <div class="touch-layout-actions"><button class="btn" data-nav data-touch-reset>恢复默认</button><button class="btn" data-nav data-touch-cancel>取消</button><button class="btn primary" data-nav data-touch-save>保存布局</button></div>
      </section>
    </div>`);
  const screen = page.querySelector(".touch-layout-screen");
  const select = page.querySelector("[data-touch-select]");
  const keys = new Map();
  let draft, selected = "stick", drag;
  const previewViewport = () => {
    const { width, height } = controls.viewport();
    return { width: Math.max(width, height), height: Math.min(width, height) };
  };
  for (const [id, label] of CONTROL_DEFS) {
    const key = document.createElement("button");
    key.className = "touch-layout-key";
    key.dataset.control = id;
    key.textContent = label;
    key.setAttribute("aria-label", `调整${label}位置`);
    key.setAttribute("aria-pressed", "false");
    screen.append(key);
    keys.set(id, key);
  }
  function syncSettings() {
    const layout = controls.layout;
    settings.querySelector("[data-touch-sensitivity]").value = layout.sensitivity;
    settings.querySelector("output").value = layout.sensitivity.toFixed(2) + "×";
    settings.querySelector("[data-touch-fire-look]").checked = layout.fireLook;
  }
  function render() {
    if (!draft) return;
    const viewport = previewViewport();
    screen.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    const scale = screen.getBoundingClientRect().width / viewport.width;
    for (const [id, key] of keys) {
      const item = draft.controls[id], rect = controlRect(item, viewport.width, viewport.height);
      key.style.left = `${rect.left * scale}px`;
      key.style.top = `${rect.top * scale}px`;
      key.style.width = key.style.height = `${rect.size * scale}px`;
      key.style.setProperty("--control-opacity", item.opacity);
      key.setAttribute("aria-pressed", String(id === selected));
    }
    select.value = selected;
    const overlaps = overlappingControls(draft, selected, viewport.width, viewport.height);
    page.querySelector(".touch-layout-status").textContent = overlaps.length
      ? `当前控件与${overlaps.join("、")}重叠，可能误触；可继续拖动调整。`
      : "预览包含全部按键，联机中仅显示已支持的动作。";
    for (const input of page.querySelectorAll("[data-touch-prop]")) {
      const prop = input.dataset.touchProp, value = draft.controls[selected][prop];
      if (prop === "size") { input.min = selected === "stick" ? 80 : 44; input.max = selected === "stick" ? 180 : 120; }
      input.value = value;
      input.nextElementSibling.value = prop === "size" ? `${Math.round(value)}px` : `${Math.round(value * 100)}%`;
    }
  }
  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const previous = drag;
    drag = null;
    if (previous.element.hasPointerCapture(previous.id)) previous.element.releasePointerCapture(previous.id);
  }
  function open() {
    controls.suspend();
    draft = normalizeLayout(controls.layout, previewViewport().width, previewViewport().height);
    menus.go("touch-layout");
    render();
    select.focus({ preventScroll: true });
  }
  settings.querySelector("[data-touch-edit]").addEventListener("click", open);
  settings.addEventListener("input", event => {
    const layout = normalizeLayout(controls.layout);
    if (event.target.hasAttribute("data-touch-sensitivity")) layout.sensitivity = Number(event.target.value);
    else if (event.target.hasAttribute("data-touch-fire-look")) layout.fireLook = event.target.checked;
    else return;
    const saved = controls.setLayout(layout);
    settings.querySelector(".touch-settings-status").textContent = saved ? "触屏设置已保存。" : "设置已生效；浏览器存储不可用，下次打开需重新设置。";
    syncSettings();
  });
  select.addEventListener("change", () => { selected = select.value; render(); });
  page.addEventListener("keydown", event => {
    if (event.code !== "Escape" || event.isComposing) return;
    // Native settings skip keyboard navigation inside inputs. The editor still
    // needs a reliable way to cancel while its select or a slider has focus.
    event.preventDefault();
    event.stopPropagation();
    menus.back();
  });
  page.addEventListener("input", event => {
    const prop = event.target.dataset.touchProp;
    if (!prop || !draft) return;
    draft.controls[selected][prop] = Number(event.target.value);
    render();
  });
  screen.addEventListener("pointerdown", event => {
    const element = event.target.closest("[data-control]");
    if (!element || drag || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    selected = element.dataset.control;
    const bounds = screen.getBoundingClientRect();
    // Start from the displayed center, including safe-edge clamping.
    const rect = element.getBoundingClientRect();
    drag = { id: event.pointerId, element, bounds, x: event.clientX, y: event.clientY,
      cx: (rect.left + rect.width / 2 - bounds.left) / bounds.width,
      cy: (rect.top + rect.height / 2 - bounds.top) / bounds.height };
    element.setPointerCapture(event.pointerId);
    render();
  });
  screen.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    const item = draft.controls[selected];
    item.x = Math.max(0, Math.min(1, drag.cx + (event.clientX - drag.x) / drag.bounds.width));
    item.y = Math.max(0, Math.min(1, drag.cy + (event.clientY - drag.y) / drag.bounds.height));
    render();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) screen.addEventListener(type, endDrag);
  page.addEventListener("click", event => {
    if (event.target.closest("[data-touch-cancel]")) return menus.back();
    if (event.target.closest("[data-touch-reset]")) {
      endDrag();
      const { sensitivity, fireLook } = draft;
      draft = { ...defaultLayout(previewViewport().width, previewViewport().height), sensitivity, fireLook };
      render();
    }
    if (event.target.closest("[data-touch-save]")) {
      const saved = controls.setLayout(draft);
      settings.querySelector(".touch-settings-status").textContent = saved ? "布局已保存，单人与联机共用。" : "布局已生效；浏览器存储不可用，下次打开需重新设置。";
      menus.back();
    }
    const control = event.target.closest("[data-control]");
    if (control) { selected = control.dataset.control; render(); }
  });
  const back = menus.back;
  menus.back = function (...args) {
    if (this.page === "touch-layout") {
      endDrag(); draft = null;
      this.go("settings"); this._tab("controls"); syncSettings();
      return;
    }
    return back.apply(this, args);
  };
  const go = menus.go;
  menus.go = function (name, ...args) {
    if (this.page === "touch-layout" && name !== "touch-layout") { endDrag(); draft = null; }
    document.body.classList.toggle("touch-editing", name === "touch-layout");
    return go.call(this, name, ...args);
  };
  addEventListener("blur", () => endDrag());
  addEventListener("resize", () => { endDrag(); render(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) endDrag(); });
  new ResizeObserver(() => { endDrag(); render(); }).observe(screen);
  syncSettings();
}
