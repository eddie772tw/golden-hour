import { bind, installLanguageMenu } from "../i18n/dom.js";
import { selectedModel, weaponName, factoryNames } from "./weapon-models.js";
import { installModelSelector } from "./gunsmith-models.js";
import { Connection } from "./net.js";
import { CompetitiveEngine } from "./competitive-engine.js";
import { loadApiConfig, ORIGINAL_ORIGIN } from "./api-config.js";
import { RoomDirectory, joinHello } from "./lobby.js";
import { ToyAccount } from "./toy-account.js";
import { OnlineKills } from "./online-kills.js";
import { MatchReportGate } from "./online-results.js";
import { installToyMenus } from "./toy-menu.js";
import { installTrainingKills } from "./training-kills.js";
import { installTouchSettings } from "./touch-settings.js";
import { installInputSettings } from "./input-settings.js";
import { installNativeProgress } from "./native-progress.js";
import { fixture } from "./toy-fixture.js";
import { WeaponAccess, installWeaponGate } from "./toy-weapons.js";
import { Vault } from "./account-vault.js";
import { installAccountMenu } from "./account-menu.js";
import { serverTarget, targetURL } from "./server-target.js";

const net = new Connection();
const engine = new CompetitiveEngine(net);
const account = new ToyAccount({sdk:serverTarget.original ? null : fixture()});
const onlineKills = new OnlineKills(account);
const reportGate = new MatchReportGate();
const query = new URLSearchParams(location.search);
const multiplayerEnabled = !query.has("solo") && (serverTarget.original || serverTarget.origin !== "");
let lastRosterAt = 0;
let joinGeneration = 0;
let room = null,
  busy = false,
  returnPage = null;
await engine.ready();
const { ctx } = engine;
// Read-only diagnostics consumed by the local graphics settings report.
engine.debug.network = net.metrics;
const menus = ctx.hud.menus;
installLanguageMenu(menus);
installTouchSettings({ menus, controls: globalThis.GHTouch });
installInputSettings({ menus, devices: globalThis.GHInput, controls: globalThis.GHTouch });
const $ = (id) => document.getElementById(id);
const visible = (id, value) => {
  $(id).hidden = !value;
};
const label = (id, value) => {
  $(id).textContent = value;
};
const inMatch = () => room && ["live", "countdown"].includes(room.phase);
// The scoreboard uses the public roster. Spatial actors stay limited to visible models.
function scoreboardMatch(match) {
  if (!room || !engine.active) return match;
  return {...match, actors:room.players.map(member=>({...member,isPlayer:member.id===net.id}))};
}
const board = ctx.hud.board;
ctx.hud.board = function(match,...args) { return board.call(this,scoreboardMatch(match),...args); };
const current = () => room?.players.find((p) => p.id === net.id);
const difficultyLabel = (value) => ({ recruit: "新兵", regular: "普通", hardened: "强化", veteran: "老兵" }[value] || "普通");

// Register one more page with the game's own menu controller. All navigation,
// backgrounds, transitions, keyboard controls, gunsmith and HUD stay native.
const deploy = menus.pages.main.querySelector('[data-act="deploy"]');
deploy.dataset.act = "online";
deploy.querySelector("b").textContent = "联机对战";
const training = document.createElement("button");
training.className = "nv";
training.dataset.nav = "";
training.dataset.act = "deploy";
training.innerHTML = "<b>单人训练</b><em>离线 · 人机作战</em>";
deploy.after(training);
if (!multiplayerEnabled) {
  training.classList.add("primary");
  deploy.remove();
}
const page = menus._page(
  "online",
  `
  <header class="topbar"><button class="backb" data-nav data-act="online-back">‹ <span>返回</span></button><h2>联机作战</h2><span class="online-mode">暮色酒店 · 团队死斗 · 先到 40 分</span></header>
  <div class="online-layout">
    <div class="online-commands">
      <div class="sech"><span id="online-section">公共房间大厅</span><span id="online-members">5 对 5</span></div>
      <div id="online-connect">
        <div class="row online-field"><span>干员呼号</span><strong id="online-name" translate="no">匿名干员</strong></div>
        <button class="nv primary" id="online-quick" data-nav data-act="online-quick"><b>快速加入</b><em>立即进入战场 ›</em></button>
        <p class="online-connect-hint">优先加入正在进行的公开对局；没有空位时自动创建，补齐人机后立即开战。</p>
        <button class="nv" id="online-create" data-nav data-act="online-create"><b>创建房间</b><em>公开大厅 · 自动开战 ›</em></button>
      </div>
      <div id="online-room" hidden>
        <button class="nv primary" id="online-next" data-nav data-act="online-next" hidden><b>再来一局</b><em>当前房间立即开战 ›</em></button>
        <button class="nv" id="online-resume" data-nav data-act="online-resume" hidden><b>返回战场</b><em>›</em></button>
      </div>
      <button class="nv" data-nav data-act="online-gunsmith"><b>枪匠</b><em id="online-loadout">使用当前装备 ›</em></button>
      <button class="nv" id="online-leave" data-nav data-act="online-leave" hidden><b>退出房间</b><em>返回主菜单</em></button>
      <p id="online-status" role="status">快速加入或在大厅选择房间，空位自动补齐人机。</p>
      <p id="online-error" role="alert" hidden></p>
      <p id="online-trust" hidden>跨站连接未完成，可能与网络、服务器、跨域设置或证书信任有关；这不代表已确认是证书错误。<a id="online-trust-link" target="_blank" rel="noopener noreferrer" data-nav>打开服务器页面 / 信任证书 ↗</a>。如浏览器显示证书提示，请核对服务器地址并手动确认，然后回到游戏再次点击创建或加入。换证后可能需要重新确认；游戏无法绕过浏览器证书校验。</p>
    </div>
    <div class="online-squad">
      <div id="online-hall">
        <div class="kicker">PUBLIC ROOMS · 公开战场</div>
        <div class="sech online-hall-heading"><span>实时房间列表</span><button class="btn" id="online-refresh" data-nav data-act="online-refresh">刷新连接</button></div>
        <p id="online-directory-status" role="status">正在获取公开房间…</p>
        <p id="online-directory-trust" hidden>列表不可用不代表已确认是证书错误。<a id="online-directory-trust-link" target="_blank" rel="noopener noreferrer" data-nav>打开服务器页面 / 检查证书 ↗</a>。如浏览器提示证书问题，请核对地址并手动确认，再刷新连接。你可以刷新连接或尝试快速加入。</p>
        <div id="online-list" class="online-room-list" aria-label="公开房间"></div>
        <p class="online-fill">5 对 5 · 先到 40 分 · 真人加入接替人机。大厅选房，加入即可开战。可前往枪匠配置武器。</p>
      </div>
      <div id="online-roster" hidden><div class="sech"><span id="online-phase">编队准备</span><span>真人优先 · 自动补位</span></div><h3 id="online-result" hidden></h3><div class="tbl" id="online-teams"></div><div class="online-team-actions"><button class="btn" id="online-team-a" data-nav data-act="online-team-a">加入先锋</button><button class="btn" id="online-team-b" data-nav data-act="online-team-b">加入余烬</button></div><p class="online-fill">人机自动就绪 · 真人加入时替换人机 · 断线后由人机暂时代打</p></div>
    </div>
  </div>
  <footer class="legend"><span><kbd>↑</kbd><kbd>↓</kbd> 导航</span><span><kbd>ENTER</kbd> 选择</span><span><kbd>ESC</kbd> 返回</span></footer>`,
);
const directory = new RoomDirectory({
  origin: serverTarget.origin,
  gateway: serverTarget.original,
  pageURL: location.href,
  onChange: renderDirectory,
});
function syncDirectory() {
  directory.setActive(multiplayerEnabled && menus.page === "online" && !menus.root.classList.contains("hidden") && !room && !busy && !document.hidden);
}
document.addEventListener("visibilitychange", syncDirectory);
page.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-act]");
  if (button) menus._act(button.dataset.act);
});
const originalGo = menus.go;
menus.go = function (name, force) {
  if (!multiplayerEnabled && name === "online") return;
  originalGo.call(this, name, force);
  if (name === "online") {
    this.root.dataset.bg = room ? "dim" : "menu";
    const first = page.querySelector("[data-nav]:not([hidden]):not(:disabled)");
    first?.focus({ preventScroll: true });
    updateLoadout();
  }
  syncDirectory();
};
const originalHide = menus._hide;
menus._hide = function (...args) {
  originalHide.apply(this, args);
  syncDirectory();
};
const originalBack = menus.back;
menus.back = function () {
  if (this.page === "gunsmith" && this.gs.mode === "camo")
    return originalBack.call(this);
  if (returnPage && ["gunsmith", "settings"].includes(this.page)) {
    const target = returnPage;
    returnPage = null;
    this.go(target);
    updateLoadout();
    return;
  }
  if (this.page === "online") {
    if (busy) { void leave(); return; }
    this.go(inMatch() ? "pause" : "main");
    return;
  }
  return originalBack.call(this);
};
const originalAct = menus._act;
menus._act = function (action, direction) {
  if (!multiplayerEnabled && (action === "online" || action?.startsWith("online-"))) return;
  if (action?.startsWith("online-room:")) {
    this.cb.sound("click");
    join("listed", action.slice("online-room:".length));
    return;
  }
  if (actions[action]) {
    this.cb.sound("click");
    actions[action]();
    return;
  }
  return originalAct.call(this, action, direction);
};
const originalResume = menus.cb.onResume,
  originalQuit = menus.cb.onQuit,
  originalAgain = menus.cb.onAgain;
menus.cb.onResume = () => (engine.active ? resume() : originalResume());
menus.cb.onQuit = () => (engine.active ? leave() : originalQuit());
menus.cb.onAgain = () => {
  if (engine.active) {
    if (room && !inMatch()) void command({ type: "ready", ready: true });
    return;
  }
  originalAgain();
};
const roomButton = document.createElement("button");
roomButton.className = "nv";
roomButton.dataset.nav = "";
roomButton.dataset.act = "online";
roomButton.innerHTML = "<b>查看房间</b><em>编队 · 当前对局</em>";
roomButton.hidden = true;
menus.pages.pause.querySelector(".vnav").append(roomButton);
const dragButton = roomButton.cloneNode(true);
dragButton.dataset.act = "online-drag";
dragButton.innerHTML = "<b>拖动瞄准</b><em>当前窗口的备用操作</em>";
menus.pages.pause.querySelector(".vnav").append(dragButton);
const progression = installNativeProgress({ gh: engine.gh, account });
const vault=new Vault();
if (!serverTarget.original) {
  try {await vault.init();} catch(e){console.error("Local account storage",e);}
}
const previousPersist=globalThis.GHProgress.persist;
let saveTimer;
function savePreferences(){
  if(!vault.account)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{void vault.export().catch(err=>error(err.message));},100);
}
globalThis.GHProgress.persist=(...args)=>{
  const bridge=globalThis.GHProgress;
  if(vault.account && (args[0]===bridge.profileKey || args[0]===bridge.buildKey)){
    savePreferences();return true;
  }
  return previousPersist(...args);
};
document.addEventListener("change",e=>{if(e.target.id==="weapon-model")savePreferences();});
const access = new WeaponAccess(serverTarget.original
  ? async()=>({unlocked:Object.keys(factoryNames),rules:{},kills:{}})
  : path=>vault.read(path));
if (serverTarget.original) await access.check();
else net.issueTicket=()=>vault.authenticate();
const accountMenu=serverTarget.original ? null : installAccountMenu(vault,async()=>{
  await vault.authenticate();
  const config=await loadApiConfig(serverTarget.origin,location.href);
  if(config.legacyMigration)await vault.migrate();
  await access.check();await vault.sync();
});
onlineKills.progression = serverTarget.original ? null : progression;
const toyMenus = installToyMenus({ account, engine, progression, access });
if (serverTarget.original) {
  for (const button of menus.root.querySelectorAll('[data-act="toy-ranks"]')) button.remove();
}
const targetForm=document.createElement("form");
targetForm.id="server-target";
targetForm.innerHTML=`<details><summary></summary>
  <label class="row online-field"><span data-server-label="mode"></span><select id="server-mode"><option value="local"></option><option value="original"></option></select></label>
  <label class="row online-field"><span data-server-label="address"></span><input id="server-origin" type="url" spellcheck="false" autocomplete="url"></label>
  <button class="btn" id="server-apply" type="submit"></button>
  </details><p id="server-policy" role="status"></p>`;
bind(targetForm.querySelector("summary"),"server.target");
for (const label of targetForm.querySelectorAll("[data-server-label]")) bind(label,"server."+label.dataset.serverLabel);
const targetMode=targetForm.querySelector("#server-mode"), targetOrigin=targetForm.querySelector("#server-origin");
for (const option of targetMode.options) bind(option,"server."+option.value);
bind(targetForm.querySelector("#server-apply"),"server.apply");
bind(targetForm.querySelector("#server-policy"),serverTarget.original ? "server.originalWeapons" : "server.localWeapons");
targetMode.value=serverTarget.original ? "original" : "local";
// This is the API origin declared by the archived original HTML. Selection is
// explicit; merely opening the client never contacts this endpoint.
targetOrigin.value=serverTarget.original ? serverTarget.origin : ORIGINAL_ORIGIN;
targetOrigin.disabled=!serverTarget.original;
targetMode.onchange=()=>{targetOrigin.disabled=targetMode.value!=="original";};
targetForm.onsubmit=event=>{
  event.preventDefault();
  if (busy || room) return;
  try {location.assign(targetURL(location.href,targetMode.value==="original",targetOrigin.value));}
  catch (e) {error(e.message);}
};
$("online-connect").prepend(targetForm);
const remoteName=document.createElement("input"),remoteNameLabel=document.createElement("label"),remoteNameCaption=document.createElement("span");
remoteName.id="original-name";remoteName.maxLength=32;remoteName.value=account.playerName;remoteName.autocomplete="nickname";
remoteNameLabel.className="row online-field";bind(remoteNameCaption,"server.name");remoteNameLabel.append(remoteNameCaption,remoteName);
remoteNameLabel.hidden=!serverTarget.original;$("online-connect").append(remoteNameLabel);
$("online-name").parentElement.hidden=serverTarget.original;
const invitation=serverTarget.original ? {} : await fetch("/api/invite").then(r=>r.json()).catch(()=>({}));
const code=document.createElement("input"),codeLabel=document.createElement("label"),joinCode=document.createElement("button");
bind(codeLabel,"account.code");codeLabel.htmlFor=code.id="join-room-code";code.maxLength=8;code.value=invitation.room||"";
joinCode.type="button";joinCode.className="btn";bind(joinCode,"account.join");
joinCode.onclick=()=>{const id=code.value.trim().toUpperCase();if(/^[A-F0-9]{8}$/.test(id))void join("listed",id);else code.focus();};
$("online-connect").append(codeLabel,code,joinCode);
const inviteField=document.createElement("input"),inviteLabel=document.createElement("label");
bind(inviteLabel,"account.invite");inviteLabel.htmlFor=inviteField.id="room-invite";
inviteField.readOnly=true;inviteField.onclick=()=>inviteField.select();$("online-room").append(inviteLabel,inviteField);
installWeaponGate({ access, engine, progression });
installModelSelector(menus);
const trainingKills = installTrainingKills({ gh: engine.gh, account, isOnline: () => engine.active });
function saveKills() {
  trainingKills.sample();
  void account.flush();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveKills();
});
addEventListener("pagehide", saveKills);

function updateLoadout() {
  label("online-loadout", weaponName(selectedModel(ctx.settings.primary)) + " ›");
  if (engine.active && engine.primary !== ctx.settings.primary) {
    engine.primary = ctx.settings.primary;
    if (!inMatch()) {
      ctx.arsenal.reset(engine.primary);
      engine.applySpecs();
    }
    if (!inMatch()) command({ type: "equip", weapon: selectedModel(engine.primary) });
  }
}
function openRoom() {
  if (engine.active) {
    engine.stopInput();
    engine.dragActive = false;
    engine.input.unlock();
    engine.input.keys.clear();
    engine.gh.G.state = inMatch() ? "paused" : "menu";
  }
  ctx.hud.show(inMatch() ? "pause" : "menu");
  menus.go("online");
  renderRoom();
}
function resume(drag = false) {
  if (!inMatch()) return openRoom();
  engine.lastUpdateAt = null;
  engine.gh.G.state = "playing";
  ctx.hud.show(null);
  if (drag) engine.enableDrag();
  else {
    engine.dragMode = false;
    engine.dragActive = false;
    engine.releaseDrag();
    engine.lock();
  }
}
function status(value) {
  label("online-status", value + (net.writer && net.metrics.transport ? ` · ${net.metrics.transport === "webrtc" ? "WebRTC" : "WebTransport"}` : ""));
}
function error(value) {
  label("online-error", value);
  visible("online-error", true);
}
async function command(value) {
  try {
    await net.send(value);
  } catch (e) {
    error(e.message);
  }
}
function setJoinBusy() {
  targetMode.disabled=busy;
  targetOrigin.disabled=busy || targetMode.value!=="original";
  targetForm.querySelector("#server-apply").disabled=busy;
  remoteName.disabled=busy;
  for (const id of ["online-quick", "online-create", "online-refresh"])
    $(id).disabled = busy;
  for (const button of $("online-list").querySelectorAll("button"))
    button.disabled = busy || button.dataset.joinable !== "true";
}
function renderDirectory({ state, rooms, message, trustURL }) {
  label("online-directory-status", state === "loading"
    ? "正在获取公开房间…"
    : state === "offline" ? message
      : rooms.length ? `${rooms.length} 个公开房间 · 实时更新` : "暂无公开房间。点击快速加入，自动创建并立即开战。");
  visible("online-directory-trust", !!trustURL);
  if (trustURL) $("online-directory-trust-link").href = trustURL;
  const list = $("online-list");
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.act : null;
  list.replaceChildren();
  const phases = { lobby: "即将开战", countdown: "开战倒计时", live: "对局进行中", over: "等待再战" };
  for (const summary of rooms) {
    const entry = document.createElement("section");
    entry.className = "online-room-entry";
    const info = document.createElement("div");
    const host = document.createElement("b");
    bind(host, "room.host", summary.hostName);
    const details = document.createElement("span");
    details.textContent = `${phases[summary.phase]} · ${difficultyLabel(summary.difficulty)}人机 · ${summary.humans} 真人 / ${summary.bots} 人机 · ${summary.humans}/${summary.capacity} 席`;
    info.append(host, details);
    const button = document.createElement("button");
    button.className = "btn";
    button.dataset.nav = "";
    button.dataset.act = "online-room:" + summary.room;
    button.dataset.joinable = String(summary.joinable);
    button.disabled = busy || !summary.joinable;
    button.textContent = summary.joinable ? "加入战场 ›" : "真人已满";
    entry.append(info, button);
    list.append(entry);
  }
  if (focused) {
    const next = [...list.querySelectorAll("button")].find((button) => button.dataset.act === focused && !button.disabled);
    (next || $("online-quick")).focus({ preventScroll: true });
  }
}
async function join(mode, roomID) {
  if (!multiplayerEnabled || busy || room) return;
  if(!serverTarget.original && !vault.account){accountMenu.open();return;}
  busy = true;
  const generation = ++joinGeneration;
  setJoinBusy();
  syncDirectory();
  visible("online-error", false);
  visible("online-trust", false);
  status("正在连接战场…");
  try {
    net.checkSupport();
    if (generation !== joinGeneration) return;
    const config = await loadApiConfig(serverTarget.origin, location.href, globalThis.fetch, { gateway: serverTarget.original });
    if (generation !== joinGeneration) return;
    if (query.get("transport") === "webrtc") config.preferredTransport = "webrtc";
    await engine.enter(ctx.settings.primary);
    if (generation !== joinGeneration) return;
    const name=serverTarget.original ? remoteName.value.trim().slice(0,32) || account.playerName : vault.account.name;
    const hello = joinHello(mode, name, roomID);
    if (mode !== "listed") hello.difficulty = ctx.settings.difficulty;
    await net.connect(hello, config);
    if (generation !== joinGeneration) return;
    await command({ type: "equip", weapon: engine.ctx.arsenal.slots[0].def.profileId });
    if (generation !== joinGeneration) return;
    roomButton.hidden = false;
    menus.pages.pause.querySelector("h1").textContent = "战术菜单";
  } catch (e) {
    if (generation !== joinGeneration) return;
    error(e.message);
    if (e.trustURL) {
      $("online-trust-link").href = e.trustURL;
      visible("online-trust", true);
    }
    status("连接未完成");
    await net.leave();
    if (generation !== joinGeneration) return;
    engine.exit();
    room = null;
    renderRoom();
    openRoom();
  } finally {
    if (generation === joinGeneration) {
      busy = false;
      setJoinBusy();
      syncDirectory();
    }
  }
}
async function leave() {
  const generation = ++joinGeneration;
  busy = true;
  setJoinBusy();
  syncDirectory();
  await net.leave();
  if (generation !== joinGeneration) return;
  onlineKills.reset();
  void account.flush();
  engine.exit();
  toyMenus.render();
  room = null;
  busy = false;
  setJoinBusy();
  returnPage = null;
  reportGate.reset();
  roomButton.hidden = dragButton.hidden = true;
  menus.pages.pause.querySelector("h1").textContent = "已暂停";
  visible("online-error", false);
  visible("online-trust", false);
  renderRoom();
  menus.go("main");
  status("已退出房间。空位由人机接替。");
}
const actions = {
  online: async () => {
    openRoom();accountMenu?.render();
  },
  deploy: async () => {
    await toyMenus.authorize();
    if (room) await leave();
    originalAct.call(menus, "deploy", 1);
  },
  "online-back": () => menus.back(),
  "online-quick": () => join("quick"),
  "online-create": () => join("create"),
  "online-refresh": () => directory.retry(),
  "online-next": () => command({ type: "ready", ready: true }),
  "online-team-a": () => command({ type: "team", team: 0 }),
  "online-team-b": () => command({ type: "team", team: 1 }),
  "online-leave": leave,
  "online-resume": () => resume(),
  "online-drag": () => resume(true),
  "online-gunsmith": () => {
    returnPage = "online";
    menus.go("gunsmith");
  },
};
function renderRoom() {
  const difficulty = difficultyLabel(room?.difficulty || ctx.settings.difficulty);
  page.querySelector(".online-mode").textContent = `暮色酒店 · 团队死斗 · ${difficulty}人机 · 先到 40 分`;
  visible("online-connect", !room);
  visible("online-hall", !room);
  syncDirectory();
  for (const id of ["online-room", "online-roster", "online-leave"])
    visible(id, !!room);
  if (!room) {
    label("online-section", "公共房间大厅");
    label("online-members", "5 对 5");
    return;
  }
  inviteField.value=invitation.invite?invitation.invite+"/"+room.room:room.room;
  const me = current(),
    active = inMatch();
  if (menus.page === "online") menus.root.dataset.bg = "dim";
  const humans = room.players.filter((p) => !p.bot).length;
  label("online-section", "公开战场");
  label("online-members", `${humans} 真人 / ${10 - humans} 人机`);
  label(
    "online-phase",
    active ? "对局进行中" : room.phase === "over" ? "对局战绩" : "编队准备",
  );
  const table = $("online-teams");
  table.replaceChildren();
  for (let team = 0; team < 2; team++) {
    const section = document.createElement("section");
    section.className = "t" + team;
    const heading = document.createElement("div");
    heading.className = "th";
    const title = document.createElement("b");
    title.textContent = team ? "余烬" : "先锋";
    const score = document.createElement("em");
    score.textContent =
      active || room.phase === "over" ? room.scores[team] : "5 / 5";
    heading.append(title, score);
    section.append(heading);
    for (const [index, p] of room.players
      .filter((p) => p.team === team)
      .entries()) {
      const row = document.createElement("div");
      row.className = "rw online-member" + (p.id === net.id ? " me" : "");
      const n = document.createElement("span");
      n.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("span");
      if (p.id === net.id) bind(name, "room.you", p.name);
      else { name.translate = false; name.textContent = p.name; }
      const state = document.createElement("span");
      state.textContent =
        active || room.phase === "over"
          ? p.kills + " / " + p.deaths
          : p.bot
            ? "人机 · 就绪"
            : !p.connected
              ? "人机代打"
              : "在线";
      const role = document.createElement("small");
      role.textContent =
        p.id === room.host ? "房主" : p.bot ? "自动补位" : "真人干员";
      name.append(role);
      row.append(n, name, state);
      section.append(row);
    }
    table.append(section);
  }
  visible("online-next", !active);
  visible("online-resume", active);
  for (const id of ["online-team-a", "online-team-b"]) $(id).disabled = active;
  visible("online-result", room.phase === "over");
  if (room.phase === "over")
    label(
      "online-result",
      room.winner < 0
        ? "平局"
        : room.winner === me?.team
          ? "任务完成 · 胜利"
          : "任务结束 · 再战",
    );
  status(
    active
      ? "战场持续运行，空位由人机补齐。"
      : "点击再来一局，留在当前房间立即开战。",
  );
}
net.addEventListener("status", ({ detail }) => {
  status(detail);
  if (detail.includes("中断") && inMatch()) engine.pause();
});
net.addEventListener("error", ({ detail }) => error(detail));
net.addEventListener("event", ({ detail: e }) => {
  if (!serverTarget.original) {
    if ((e.type === "career" || e.type === "welcome") && e.career) access.apply(e.career);
    if(["career","welcome","round-end"].includes(e.type)) void vault.sync().catch(err=>error(err.message));
  }
  if (e.type==="spawn" && room) {
    const member=room.players.find(p=>p.id===e.id);
    if (member) member.alive=true;
  }
  engine.event(e);
  const settlement = serverTarget.original ? null : onlineKills.event(e, net.id);
  if (e.type === "error") return error(e.message);
  if (e.type === "welcome") visible("online-error", false);
  if (e.type === "room") {
    room = e;
    engine.setRoom(e);
    renderRoom();
    const me = room.players.find((player) => player.id === net.id);
    if (engine.active && me && reportGate.claim(room)) {
      const match = ctx.match;
      match.scores = room.scores;
      match.scoreLimit = room.scoreLimit || 40;
      match.state = "over";
      for (const player of room.players) {
        const actor = engine.actor(player.id);
        if (!actor) continue;
        Object.assign(actor, {
          name: player.name,
          team: player.team,
          kills: player.kills,
          deaths: player.deaths,
          score: player.score,
        });
      }
      engine.gh.G.state = "over";
      const outcome = room.winner < 0 ? -1 : room.winner === me.team ? 0 : 1;
      ctx.hud.matchEnd(outcome, scoreboardMatch(match), settlement?.award);
    }
  }
});
net.addEventListener("snapshot", ({ detail: s }) => {
  engine.snapshot(s);
  if (room) {
    room.scores = s.scores;
    for (const p of s.players) {
      const member = room.players.find((q) => q.id === p.id);
      if (member) {
        member.kills = p.kills;
        member.deaths = p.deaths;
        member.score = p.score;
      }
    }
    if (performance.now() - lastRosterAt > 500) {
      lastRosterAt = performance.now();
      if (menus.page === "online") renderRoom();
      if (menus.page === "pause") menus._refreshPause();
    }
  }
});
engine.addEventListener("lockerror", () => {
  dragButton.hidden = false;
  if (!inMatch()) return;
  menus.pages.pause.querySelector('[data-act="resume"] em').textContent = "点击后锁定鼠标 ›";
  ctx.hud.hint("点击「继续」锁定鼠标并返回战场；受限窗口可选择「拖动瞄准」。", 7);
});
engine.addEventListener("lock", ({ detail: locked }) => {
  if (locked) menus.pages.pause.querySelector('[data-act="resume"] em').textContent = "›";
  if (!locked && inMatch() && engine.gh.G.state === "playing") engine.pause();
});
if (multiplayerEnabled) setInterval(() => {
  if (net.writer) command({ type: "ping", nonce: performance.now() });
}, 1500);
if (multiplayerEnabled && query.has("pvp")) openRoom();
