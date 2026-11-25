import { bind } from "../../i18n/dom.js";
import { BUILTIN_HOTEL, loadMapCatalog } from "./map-assets.js";
import { prepareMap, installMap } from "./map-runtime.js";

export function installTrainingMenu(gh) {
  const { menus } = gh.debug.ctx.hud;
  const deploy = menus.cb.onDeploy, quit = menus.cb.onQuit, back = menus.back;
  const page = menus._page("training", `
    <header class="topbar"><button type="button" class="backb" data-nav id="training-back"></button><h2></h2></header>
    <div class="training-layout">
      <div id="training-maps" role="group"></div>
      <div class="training-actions">
        <p id="training-status" role="status"></p>
        <button type="button" class="nv primary" data-nav id="training-deploy"></button>
      </div>
    </div>`);
  const list = page.querySelector("#training-maps"), status = page.querySelector("#training-status");
  const backButton = page.querySelector("#training-back"), deployButton = page.querySelector("#training-deploy");
  bind(page.querySelector("h2"), "training.pick");
  bind(deployButton, "training.deploy");
  let catalogRequest, mapRequest, selected, prepared, release;

  function cancelPending() {
    catalogRequest?.abort();
    mapRequest?.abort();
    catalogRequest = mapRequest = null;
    prepared?.dispose();
    prepared = null;
  }

  function releaseMap() {
    const cleanup = release;
    release = null;
    cleanup?.();
  }

  function close() {
    cancelPending();
    releaseMap();
    menus.cb.sound("back");
    menus.go("main");
  }

  function labelMap(element, map) {
    if (["hotel", "shipment", "sublevel-07"].includes(map.id)) bind(element, "training.map." + map.id);
    else element.textContent = map.id;
  }

  function setChoices(choices) {
    const focused = document.activeElement?.dataset.trainingMap;
    const buttons = choices.map(map => {
      const button = document.createElement("button"), title = document.createElement("b");
      button.type = "button";
      button.className = "nv";
      button.setAttribute("data-nav", "");
      button.dataset.trainingMap = map.id;
      button.setAttribute("aria-pressed", String(map.id === selected.id));
      labelMap(title, map);
      button.append(title);
      button.onclick = () => {
        menus.cb.sound("click");
        void choose(map);
      };
      return button;
    });
    list.replaceChildren(...buttons);
    if (focused) buttons.find(button => button.dataset.trainingMap === focused)?.focus({ preventScroll: true });
  }

  async function choose(map) {
    mapRequest?.abort();
    prepared?.dispose();
    prepared = null;
    releaseMap();
    selected = map;
    for (const button of list.children) button.setAttribute("aria-pressed", String(button.dataset.trainingMap === map.id));
    const request = mapRequest = new AbortController();
    bind(backButton, "training.cancel");
    bind(status, "training.loading");
    status.removeAttribute("title");
    deployButton.disabled = true;
    try {
      const candidate = await prepareMap(gh, map, { signal: request.signal });
      if (request.signal.aborted) {
        candidate.dispose();
        return;
      }
      prepared = candidate;
      deployButton.disabled = false;
      bind(status, map.version === "builtin" ? "training.import" : "training.ready");
    } catch (error) {
      if (request.signal.aborted) return;
      bind(status, "training.failed");
      status.title = error.message;
    } finally {
      if (mapRequest === request) {
        mapRequest = null;
        bind(backButton, "training.back");
      }
    }
  }

  async function open() {
    cancelPending();
    releaseMap();
    selected = BUILTIN_HOTEL;
    setChoices([selected]);
    list.setAttribute("aria-labelledby", (page.querySelector("h2").id = "training-title"));
    menus.go("training");
    list.firstElementChild.focus({ preventScroll: true });
    void choose(selected);

    const request = catalogRequest = new AbortController();
    try {
      const catalog = await loadMapCatalog({ signal: request.signal });
      if (request.signal.aborted) return;
      setChoices(catalog.maps);
      const hotel = catalog.maps.find(map => map.id === catalog.defaultMap);
      if (hotel.version !== selected.version) void choose(hotel);
    } catch (error) {
      if (!request.signal.aborted) {
        bind(status, "training.catalogFailed");
        status.title = error.message;
      }
    } finally {
      if (catalogRequest === request) catalogRequest = null;
    }
  }

  backButton.onclick = close;
  deployButton.onclick = () => {
    if (!prepared && !release) return;
    catalogRequest?.abort();
    try {
      if (!release) {
        release = installMap(gh, prepared);
        prepared = null;
      }
      // Run on this click so the native pointer-lock request has activation.
      deploy();
    } catch (error) {
      cancelPending();
      releaseMap();
      deployButton.disabled = true;
      bind(status, "training.failed");
      status.title = error.message;
    }
  };
  menus.cb.onDeploy = () => void open();
  menus.cb.onQuit = (...args) => {
    try {
      return quit(...args);
    } finally {
      releaseMap();
    }
  };
  menus.back = function (...args) {
    if (this.page === "training") close();
    else return back.apply(this, args);
  };
  addEventListener("pagehide", cancelPending);
}
