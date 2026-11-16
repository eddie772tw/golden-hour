// Extend the native menu controller, rather than putting another overlay over
// the game's keyboard/touch navigation and pause lifecycle.
import { bind, sourceText } from "../i18n/dom.js";

export function installToyMenus({ account, engine, progression, access }) {
  const { ctx } = engine;
  const menus = ctx.hud.menus;
  let returnPage = "main", attempted = false, authorizing = false, rankBusy = false;
  const profile = document.createElement("div");
  profile.className = "toy-profile";
  profile.innerHTML = `<span data-toy-save-state role="status">本地试玩</span><button class="btn" data-nav data-act="toy-profile-action">同步 B站身份</button>`;
  const career = document.createElement("div");
  career.className = "toy-career";
  const main = menus.pages.main;
  main.append(career);
  career.append(main.querySelector("#pcard"), main.querySelector("#mastery"));
  for (const name of ["main", "pause"]) {

    const button = document.createElement("button");
    button.className = "nv";
    button.dataset.nav = "";
    button.dataset.act = "toy-ranks";
    button.innerHTML = "<b>击杀排行榜</b><em>联机 · 对人击杀 ›</em>";
    menus.pages[name].querySelector(".vnav").append(button);
  }
  const page = menus._page("toy-ranks", `
    <header class="topbar"><button class="backb" data-nav data-act="toy-back">‹ <span>返回</span></button><h2>竞技击杀排行榜</h2></header>
    <div class="online-layout toy-rank-layout">
      <section class="online-commands">
        <div class="sech"><span>TOY 干员档案</span><span>个人云存档</span></div>
        <h3 data-toy-name>匿名干员</h3>
        <p data-toy-summary>本机对战档案</p>
        <div class="toy-kill-stats"><span>累计击杀<strong data-toy-total>0</strong></span><span>联机<strong data-toy-online>0</strong></span><span>单人训练<strong data-toy-training>0</strong></span></div>
        <p id="toy-account-status" role="status"></p>
        <button class="nv" data-nav data-act="toy-authorize"><b>同步 B站身份</b><em>自动使用 SDK 昵称</em></button>
        <button class="nv" data-nav data-act="toy-sync"><b>同步个人档案</b><em>个人云档</em></button>
        <button class="nv" data-nav data-act="toy-import-progress" hidden><b>导入这台设备的旧进度</b><em>合并到当前 B站账号 · 不重复累加</em></button>
        <p>等级、总经验、场次、胜场、击杀、各枪精通和枪匠配置共用成长云档。旧本地进度尚未绑定账号，可在这里选择导入。</p>
        <p>竞技榜只累计服务器确认的对人击杀。左侧个人云档包含训练与人机战绩。</p>
      </section>
      <section class="online-squad">
        <div class="sech online-hall-heading"><span>总榜 · 按累计击杀排序</span><button class="btn" data-nav data-act="toy-refresh">刷新榜单</button></div>
        <p id="toy-my-rank">完成有效击杀后可查看自己的排名。</p>
        <p id="toy-rank-status" role="status">进入时读取一次，之后可手动刷新。</p>
        <table class="toy-rank-table"><thead><tr><th scope="col">名次</th><th scope="col">干员</th><th scope="col">累计击杀</th></tr></thead><tbody id="toy-rank-list"></tbody></table>
      </section>
    </div>
    <footer class="legend"><span><kbd>↑</kbd><kbd>↓</kbd> 导航</span><span><kbd>ENTER</kbd> 选择</span><span><kbd>ESC</kbd> 返回</span></footer>`);
  page.addEventListener("click", event => {
    const button = event.target.closest("button[data-act]");
    if (button) menus._act(button.dataset.act);
  });
  const setText = (selector, value) => {
    for (const element of menus.root.querySelectorAll(selector)) element.textContent = value;
  };
  function render() {
    const state = account.state;
    const name = account.playerName;
    engine.player.name = name;
    for (const label of menus.root.querySelectorAll("[data-toy-name]")) {
      label.translate = !state.authenticated;
      label.textContent = name;
    }
    setText("[data-toy-summary]", state.authenticated ? `Toy 身份 · 累计 ${state.total} 击杀` : "本机对战档案");
    for (const mode of ["total", "online", "training"]) setText(`[data-toy-${mode}]`, String(state[mode] || 0));
    setText("#toy-account-status", (state.sync === "error" ? state.message : "") || (state.authenticated ? "已读取 Toy 身份。" : "开始游玩时尝试读取 Toy 昵称；不授权也可匿名试玩。"));
    for (const button of menus.root.querySelectorAll('[data-act="toy-authorize"]')) button.disabled = authorizing || engine.active;
    for (const button of menus.root.querySelectorAll('[data-act="toy-sync"]')) button.disabled = !state.authenticated || state.sync === "syncing";
    const identity = menus.root.querySelector("#pcard .pc-k");
    if (identity) bind(identity, account.isToy ? "profile.toy" : "profile.local", state.authenticated ? name : sourceText(name));
    const card = menus.pages.main.querySelector("#pcard");
    if (card && profile.parentNode !== card) card.append(profile);
    const labels = { loading: "正在恢复云档…", pending: "成长进度待同步", synced: "成长云档已同步", readonly: "当前环境只读", error: "云档同步失败" };
    setText("[data-toy-save-state]", state.authenticated ? (state.sync === "error" ? "云档同步失败，请重试" : labels[state.progressSync] || "正在读取成长云档…") : "本地试玩 · 未同步云档");
    const button = profile.querySelector("button");
    button.hidden = !account.isToy;
    button.textContent = state.authenticated ? "同步云档" : "同步 B站身份";
    button.disabled = authorizing || state.sync === "syncing" || engine.active;
    page.querySelector('[data-act="toy-import-progress"]').hidden = !state.authenticated || state.status !== "ready" || !progression?.hasLegacy;
  }
  async function authorize({ explicit = false } = {}) {
    if (!account.isToy) return account.state;
    if (engine.active || authorizing || (!explicit && (attempted || account.state.authenticated))) return account.state;
    attempted = true;
    authorizing = true;
    render();
    try {
      await account.prepare();
      const result = await account.authorize();
      await access?.check();
      return result;
    } finally {
      authorizing = false;
      render();
    }
  }
  async function ranks(refresh = false) {
    if (rankBusy) return;
    rankBusy = true;
    const status = page.querySelector("#toy-rank-status");
    status.textContent = "正在读取竞技榜…";
    page.querySelector('[data-act="toy-refresh"]').disabled = true;
    try {
      const result = await access.read("/api/ranks");
      const body = page.querySelector("#toy-rank-list");
      body.replaceChildren();
      for (const item of result.list) {
        const row = document.createElement("tr");
        for (const value of [item.rank, item.nickname, item.score]) {
          const cell = document.createElement("td");
          cell.translate = false;
          cell.textContent = String(value);
          row.append(cell);
        }
        body.append(row);
      }
      status.textContent = result.list.length ? "前 20 名 · 可手动刷新。" : "暂时无人上榜。完成第一次有效对人击杀即可上榜。";
      page.querySelector("#toy-my-rank").textContent = result.mine
        ? result.mine.ranked ? `我的排名：第 ${result.mine.rank} 名 · ${result.mine.score} 击杀` : "你尚未上榜。"
        : "匿名可查看总榜，完成有效击杀后可查看自己的排名。";
    } catch (error) {
      status.textContent = error.message || "排行榜暂时不可用，请稍后手动刷新。";
    } finally {
      rankBusy = false;
      page.querySelector('[data-act="toy-refresh"]').disabled = false;
    }
  }
  const originalAct = menus._act;
  menus._act = function (action, direction) {
    if (action === "toy-profile-action") return void (account.state.status === "ready" ? account.flush() : authorize({ explicit: true }));
    if (action === "toy-import-progress") return void progression?.importLegacy().then(render);
    if (action === "toy-authorize") {
      this.cb.sound("click");
      void authorize({ explicit: true }).then(() => menus.page === "toy-ranks" && ranks(true));
      return;
    }
    if (action === "toy-ranks") {

      this.cb.sound("click");
      returnPage = ["pause", "end"].includes(this.page) ? this.page : "main";
      this.go("toy-ranks");
      void ranks();
      return;
    }
    if (action === "toy-back") return this.go(returnPage);
    if (action === "toy-refresh") return void ranks(true);
    if (action === "toy-sync") return void account.flush().then(render);
    return originalAct.call(this, action, direction);
  };
  const originalBack = menus.back;
  menus.back = function () {
    if (this.page === "toy-ranks") return this.go(returnPage);
    return originalBack.call(this);
  };
  const originalRefresh = menus._refreshMain;
  menus._refreshMain = function (...args) {
    const result = originalRefresh.apply(this, args);
    render();
    return result;
  };
  account.addEventListener("change", render);
  void account.prepare().then(render);
  render();
  return { authorize, render };
}
