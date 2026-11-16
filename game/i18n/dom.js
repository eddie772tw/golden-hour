import { catalogs, languages, legacy, message, resolveLocale } from "./index.js";

const storageKey = "golden-hour.language";
let saved;
try { saved = localStorage.getItem(storageKey); } catch {}
let locale = resolveLocale(saved, navigator.languages);
const original = new WeakMap(), bindings = new WeakMap();
const attrs = ["aria-label", "placeholder", "title", "alt"];
const skip = "script,style,canvas,textarea,svg,[translate=no],[data-l10n-bound]";
const tips = new Map(Object.entries(catalogs["en-US"]).filter(([k,v]) => k.startsWith("core.") && v.includes("<b>")).map(([k,v]) => [v,k]));
let tipKey, lastTip;

// Use sourceText only for game-authored fragments. Names and IDs are opaque arguments.
export const sourceText = value => () => legacy(locale, String(value));

export function bind(element, key, ...args) {
  bindings.set(element, {key, args});
  element.setAttribute("data-l10n-bound", "");
  element.textContent = message(locale, key, args.map(value => typeof value === "function" ? value() : value));
}
export function setLocale(value) {
  if (!Object.hasOwn(languages, value)) return;
  locale = value;
  document.documentElement.lang = value;
  try { localStorage.setItem(storageKey, value); } catch {}
  walk(document.body);
  for (const el of document.querySelectorAll("[data-l10n-bound]")) {
    const entry = bindings.get(el);
    if (entry) bind(el, entry.key, ...entry.args);
  }
  document.querySelectorAll("[data-locale]").forEach(select => { select.value = locale; });
  document.dispatchEvent(new Event("languagechange"));
}
function update(node, field, value, put) {
  let state = original.get(node);
  let source = state?.[field]?.rendered === value ? state[field].source : value;
  const rendered = legacy(locale, source);
  if (rendered !== source || state?.[field]) {
    if (!state) original.set(node, state = {});
    state[field] = {source, rendered};
  }
  if (value !== rendered) put(rendered);
}
function walk(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!node.parentElement || node.parentElement.closest(skip)) return;
    update(node, "text", node.data, v => { node.data = v; });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || node.closest(skip)) return;
  if (node.id === "ltipp") {
    const html = node.innerHTML;
    if (html !== lastTip) tipKey = tips.get(html);
    if (tipKey) {
      // Only catalog-authored tip markup (bold key bindings) is admitted here.
      lastTip = message(locale, tipKey);
      if (html !== lastTip) node.innerHTML = lastTip;
      return;
    }
  }
  for (const attr of attrs) {
    if (node.hasAttribute(attr)) update(node, attr, node.getAttribute(attr), v => node.setAttribute(attr,v));
  }
  for (const child of node.childNodes) walk(child);
}
document.documentElement.lang = locale;
walk(document.body);
new MutationObserver(records => {
  for (const r of records) {
    if (r.target.parentElement?.closest("#ltipp") || r.target.id === "ltipp") walk(document.getElementById("ltipp"));
    else if (r.type === "childList") r.addedNodes.forEach(walk);
    else walk(r.target);
  }
}).observe(document.body,{childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:attrs});

export function installLanguageMenu(menus) {
  const bar = document.createElement("div");
  bar.id = "language-menu";
  const label = document.createElement("label"), caption = document.createElement("span");
  const select = document.createElement("select");
  select.dataset.locale = "";
  bind(caption, "menu.language");
  for (const [value, name] of Object.entries(languages)) {
    const option = new Option(name, value);
    option.lang = value; option.translate = false;
    select.add(option);
  }
  select.value = locale;
  select.onchange = () => setLocale(select.value);
  label.append(caption, select);
  const credits = document.createElement("button"), dialog = document.createElement("dialog");
  const heading = document.createElement("h2"), role = document.createElement("p");
  const name = document.createElement("strong"), close = document.createElement("button");
  bind(credits, "menu.credits"); bind(heading, "menu.credits"); bind(role, "menu.developer"); bind(close, "menu.close");
  name.translate = false; name.textContent = "蒙哥汗马利@LankiYang";
  heading.id = "credits-title"; dialog.setAttribute("aria-labelledby", heading.id);
  dialog.append(heading, role, name, close); dialog.id = "credits-dialog";
  credits.onclick = () => dialog.showModal(); close.onclick = () => dialog.close();
  dialog.addEventListener("keydown", e => e.stopPropagation());
  bar.append(label, credits); menus.root.append(bar); document.body.append(dialog);
}
