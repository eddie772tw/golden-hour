import { bind } from "../i18n/dom.js";

const labels = { ar: "KR-7", pistol: "STRIX 9", smg: "VESPER", shotgun: "M12" };

export class WeaponAccess extends EventTarget {
  constructor(read) {
    super();
    this.read = read;
    this.version = 0;
    this.state = { unlocked:["ar","pistol"], rules:{smg:{source:"ar",required:10},shotgun:{source:"smg",required:10}}, kills:{} };
  }
  canUse(id) { return this.state.unlocked.includes(id); }
  apply(state) {
    this.version++;
    this.state = state;
    this.dispatchEvent(new Event("change"));
  }
  async check() {
    const version = ++this.version;
    try {
      const state = await this.read("/api/career");
      if (version===this.version) this.apply(state);
    } catch {
      if (version===this.version) this.apply({unlocked:["ar","pistol"],kills:{},rules:this.state.rules,error:"无法读取服务器战绩，请重试。"});
    }
  }
}

export function installWeaponGate({access,engine,progression}) {
  const {menus} = engine.ctx.hud;
  const page = menus._page("toy-unlock", `
    <header class="topbar"><button class="backb" data-nav data-act="unlock-back">‹ 返回</button><h2>武器解锁</h2></header>
    <div class="online-layout"><section class="online-commands">
    <h3>对战武器进度</h3><p>使用指定武器击杀其他真人玩家。服务器确认击杀后立即累计。</p>
    <div data-unlock-checks class="toy-unlock-checks"></div>
    <button class="btn" data-nav data-act="unlock-check">刷新进度</button></section></div>`);
  page.addEventListener("click", event => {
    const button=event.target.closest("button[data-act]");
    if (button) menus._act(button.dataset.act);
  });
  const render = () => {
    const list=page.querySelector("[data-unlock-checks]");
    list.replaceChildren();
    if (access.state.error) list.textContent=access.state.error;
    for (const [id,rule] of Object.entries(access.state.rules)) {
      const row=document.createElement("p");
      const count=access.state.kills[rule.source] || 0;
      const progress=document.createElement("span");
      bind(progress,"weapon.progress",labels[id],labels[rule.source],count,rule.required);
      row.append(progress);
      if (access.canUse(id)) row.append(" · 已解锁");
      list.append(row);
    }
    if (menus.page==="gunsmith") menus._gsRender(false);
  };
  const act=menus._act, back=menus.back;
  menus._act=function(action,direction) {
    if (action==="unlock-back") return this.go("gunsmith");
    if (action==="unlock-check") return void access.check();
    return act.call(this,action,direction);
  };
  menus.back=function(){return this.page==="toy-unlock"?this.go("gunsmith"):back.call(this);};
  const equip=menus._gsEquip, renderGun=menus._gsRender;
  menus._gsEquip=function(...args) {
    if (access.canUse(this.gs.w)) return equip.apply(this,args);
    this.go("toy-unlock"); render(); void access.check();
  };
  menus._gsRender=function(...args) {
    const result=renderGun.apply(this,args);
    if (!access.canUse(this.gs.w)) {
      const button=this.pages.gunsmith.querySelector("#gs-equip");
      button.disabled=false; button.textContent="查看解锁条件";
    }
    return result;
  };
  const arsenal=engine.ctx.arsenal, reset=arsenal.reset;
  arsenal.reset=function(primary,...args) {
    if (!access.canUse(primary)) primary=engine.ctx.settings.primary="ar";
    return reset.call(this,primary,...args);
  };
  progression.setWeaponPolicy(id=>access.canUse(id));
  access.addEventListener("change",()=>{progression.refresh();render();});
  if (!access.canUse(engine.ctx.settings.primary)) engine.ctx.settings.primary="ar";
  render();
}
