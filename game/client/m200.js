import { serverTarget } from "./server-target.js";

export const M200 = Object.freeze({
  id: "m200", name: "M200 INTERVENTION", cls: "SNIPER RIFLE", auto: false,
  rpm: 38, dmg: [110, 100], range: [70, 180], head: 2.25, mag: 5, reserve: 25,
  adsTime: .43, zoom: 3, sprintOut: .28, hip: [3.2, 6.5], ads: .1, pellets: 1,
  recoil: { v: 5.8, h: 1.4, rec: 3.5, climb: .65, first: 1.8, punch: 3 },
  kick: 5.2, mobility: .78, adsMove: .62, casing: 0, flash: 1.1, shake: .5, impulse: 9,
});
export const M200_RELOAD = 2.8;
export const M200_ACTION = 1.25;
export const m200Enabled = !serverTarget.original || serverTarget.weaponFormat === "v60115";

const parts = {
  optic: { m200scope: "FACTORY SCOPE", m200prism: "PRISM SCOPE", m200long: "LONG-RANGE SCOPE" },
  muzzle: { none: null, m200quiet: "M200 SUPPRESSOR", m200brake: "M200 BRAKE" },
  underbarrel: { m200bipod: "FACTORY BIPOD", m200fold: "FOLDING BIPOD", m200light: "LIGHT BIPOD" },
  magazine: { std: null, m200ext: "EXTENDED MAGAZINE BODY", m200fast: "QUICK-CHANGE MAGAZINE BODY" },
  stock: { std: null, m200stocklight: "LIGHT STOCK", m200padded: "PADDED STOCK" },
};

export function configureM200(specs, choices, attachments, weapons, primaries) {
  // The GLB variants change appearance. The community server owns gameplay stats.
  specs.m200 = M200;
  choices.m200 = Object.fromEntries(Object.entries(parts).map(([slot, options]) => {
    for (const [id, name] of Object.entries(options)) {
      if (name) attachments[slot][id] = { name, desc: "M200 APPEARANCE ONLY", mods: {} };
    }
    return [slot, Object.keys(options)];
  }));
  if (m200Enabled) {
    weapons.push("m200");
    primaries.push("m200");
  }
}

export function installM200Handling(ctx) {
  const { arsenal, vm } = ctx;
  const startReload = arsenal.startReload;
  const updateArsenal = arsenal.update;
  const eject = arsenal._eject;
  let pendingReload, firedSlot, ejected;
  arsenal.startReload = function () {
    if (this.def.id === "m200" && this.sinceFire < M200_ACTION) {
      pendingReload = this.slot;
      return;
    }
    pendingReload = null;
    return startReload.call(this);
  };
  arsenal._eject = function () {
    if (this.def.id !== "m200" || this.sinceFire > .01) return eject.call(this);
    firedSlot = this.slot;
    ejected = false;
  };
  arsenal.update = function (dt) {
    updateArsenal.call(this, dt);
    if (!ctx.player.alive || this.state === "holster") pendingReload = firedSlot = null;
    if (this.slot === firedSlot && !ejected && this.sinceFire >= .34) {
      ejected = true;
      eject.call(this);
      ctx.audio.reload("shotgun", "pump_back");
    }
    if (this.slot === pendingReload && this.sinceFire >= M200_ACTION && this.state === "ready") this.startReload();
  };
  const hud = document.getElementById("hud");
  const scope = document.createElement("div");
  scope.id = "m200-scope";
  scope.hidden = true;
  scope.setAttribute("aria-hidden", "true");
  hud.prepend(scope);
  const update = vm.update;
  vm.update = function (dt, player, arsenal) {
    update.call(this, dt, player, arsenal);
    const scoped = this.id === "m200" && player.alive && player.adsK >= .94 && globalThis.GH.G.state === "playing";
    scope.hidden = !scoped;
    if (scoped) this.rig.visible = false;
  };
}
