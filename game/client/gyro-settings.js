import { bind } from "../i18n/dom.js";

export function installGyroSettings({ devices, controls, section }) {
  const gyro = controls?.gyro;
  if (!gyro) return;
  const row = document.createElement("section");
  row.dataset.gyroSettings = "";
  row.innerHTML = `<h4 data-gyro-title></h4>
    <label class="touch-setting"><input type="checkbox" data-gyro-enabled><span data-gyro-enable-label></span></label>
    <label class="touch-setting"><span data-gyro-mode-label></span><select data-gyro-mode>
      <option value="ads"></option><option value="always"></option>
    </select></label>
    <label class="touch-setting"><span data-gyro-sensitivity-label></span>
      <input type="range" min="0.25" max="3" step="0.05" data-gyro-sensitivity><output></output>
    </label>
    <p data-gyro-status role="status"></p>`;
  section.append(row);
  const get = selector => row.querySelector(selector);
  const checkbox = get("[data-gyro-enabled]");
  const mode = get("[data-gyro-mode]");
  const sensitivity = get("[data-gyro-sensitivity]");
  for (const [selector, key] of [
    ["[data-gyro-title]", "title"], ["[data-gyro-enable-label]", "enable"],
    ["[data-gyro-mode-label]", "mode"], ["[data-gyro-sensitivity-label]", "sensitivity"],
    ['option[value="ads"]', "ads"], ['option[value="always"]', "always"],
  ]) bind(get(selector), "gyro." + key);
  function render() {
    const { preferences, status, unavailable } = gyro;
    row.hidden = devices.effective !== "touch";
    checkbox.checked = preferences.enabled;
    checkbox.disabled = !!unavailable || status === "requesting";
    mode.value = preferences.mode;
    sensitivity.value = preferences.sensitivity;
    get("output").textContent = preferences.sensitivity.toFixed(2) + "×";
    bind(get("[data-gyro-status]"), "gyro.status." + status);
  }
  checkbox.addEventListener("change", () => checkbox.checked ? void gyro.enable() : gyro.disable());
  mode.addEventListener("change", () => gyro.save({ mode: mode.value }));
  sensitivity.addEventListener("input", () => gyro.save({ sensitivity: Number(sensitivity.value) }));
  gyro.addEventListener("change", render);
  devices.addEventListener("change", render);
  render();
}
