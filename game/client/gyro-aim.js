export const GYRO_SETTINGS_KEY = "gh-gyro-aim-v1";
const radians = Math.PI / 180;
const signalTimeout = 2500;
const filtered = rate => Math.sign(rate) * Math.max(0, Math.min(720, Math.abs(rate)) - 1);
const preferences = value => ({
  enabled: value?.enabled === true,
  mode: value?.mode === "always" ? "always" : "ads",
  sensitivity: Number.isFinite(value?.sensitivity) ? Math.max(.25, Math.min(3, value.sensitivity)) : 1,
});

export class GyroAim extends EventTarget {
  constructor({ win, storage, look }) {
    super();
    this.win = win;
    this.storage = storage;
    this.look = look;
    let saved;
    try { saved = JSON.parse(storage?.getItem(GYRO_SETTINGS_KEY)); } catch {}
    this.preferences = preferences(saved);
    this.motion = win.DeviceMotionEvent;
    const policy = win.document.permissionsPolicy ?? win.document.featurePolicy;
    const blocked = ["accelerometer", "gyroscope"].some(feature =>
      policy?.features?.().includes(feature) && !policy.allowsFeature(feature));
    this.unavailable = !win.isSecureContext ? "insecure" : blocked ? "blocked" : !this.motion ? "unsupported" : null;
    this.status = this.unavailable ?? "idle";
    this.position = null;
    this.onMotion = event => this.sample(event);
  }
  save(change) {
    this.preferences = preferences({ ...this.preferences, ...change });
    try { this.storage?.setItem(GYRO_SETTINGS_KEY, JSON.stringify(this.preferences)); } catch {}
    this.dispatchEvent(new Event("change"));
  }
  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.dispatchEvent(new Event("change"));
  }
  async enable() {
    if (this.unavailable || this.status === "requesting") return;
    if (typeof this.motion.requestPermission === "function") {
      this.setStatus("requesting");
      let permission;
      try { permission = await this.motion.requestPermission(); } catch {}
      if (permission !== "granted") return this.disable("denied");
    }
    this.save({ enabled: true });
    this.setStatus("checking");
    this.sync();
  }
  disable(status = "idle") {
    this.save({ enabled: false });
    this.setStatus(status);
    this.stop();
  }
  update({ selected, active, ads }) {
    this.selected = selected;
    this.active = active;
    this.ads = ads;
    if (selected && this.preferences.enabled && this.status === "idle" && !this.unavailable)
      this.setStatus("checking");
    this.sync();
  }
  sync() {
    if (!this.selected || !this.preferences.enabled || this.unavailable || this.win.document.hidden ||
        this.status !== "checking" && !this.active) return this.stop();
    if (this.listening) return;
    this.listening = true;
    this.win.addEventListener("devicemotion", this.onMotion);
    this.timer = this.win.setTimeout(() => {
      this.setStatus("noData");
      this.sync();
    }, signalTimeout);
  }
  reset() { this.position = null; }
  stop() {
    if (!this.listening) return;
    this.listening = false;
    this.win.removeEventListener("devicemotion", this.onMotion);
    this.win.clearTimeout(this.timer);
    this.reset();
  }
  sample(event) {
    if (!this.listening || this.win.document.hidden) return;
    // DeviceMotion rotationRate names the X and Y axes alpha and beta.
    const { alpha, beta } = event.rotationRate || {};
    if (!Number.isFinite(alpha) || !Number.isFinite(beta)) return this.reset();
    this.win.clearTimeout(this.timer);
    this.setStatus("ready");
    if (!this.active || (this.preferences.mode === "ads" && !this.ads)) {
      this.sync();
      return this.reset();
    }
    const angle = this.win.screen.orientation?.angle ?? this.win.orientation ?? 0;
    const previous = this.position;
    this.position = { angle, time: event.timeStamp };
    if (previous?.angle !== angle) return;
    const dt = (event.timeStamp - previous.time) / 1000;
    if (!(dt > 0 && dt <= .12)) return;
    const sin = Math.sin(angle * radians), cos = Math.cos(angle * radians);
    const scale = dt * radians * this.preferences.sensitivity;
    this.look(filtered(alpha * sin + beta * cos) * scale,
      filtered(alpha * cos - beta * sin) * scale);
  }
}
