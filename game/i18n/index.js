import en from "./en-US.js";
import cn from "./zh-CN.js";
import tw from "./zh-TW.js";
import ja from "./ja-JP.js";
import kyoto from "./ja-JP-x-kyoto.js";

export const catalogs = { "zh-CN": cn, "en-US": en, "zh-TW": tw, "ja-JP": ja, "ja-JP-x-kyoto": kyoto };
export const languages = {
  "zh-CN": "简体中文", "en-US": "English (US)", "zh-TW": "繁體中文（台灣）",
  "ja-JP": "日本語", "ja-JP-x-kyoto": "日本語（京都）",
};
export function resolveLocale(saved, preferences = []) {
  if (Object.hasOwn(catalogs, saved)) return saved;
  for (const preference of preferences) {
    const tag = preference.toLowerCase();
    if (/^zh(?:-|$)/.test(tag)) return /-(?:hant|tw|hk|mo)(?:-|$)/.test(tag) ? "zh-TW" : "zh-CN";
    if (/^en(?:-|$)/.test(tag)) return "en-US";
    if (/^ja(?:-|$)/.test(tag)) return "ja-JP";
  }
  return "zh-CN";
}
export function message(locale, key, args = []) {
  const template = catalogs[locale]?.[key] ?? cn[key];
  if (template === undefined) throw new Error("Unknown message " + key);
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[i] ?? ""));
}

// Original renderers emit English or Simplified Chinese. Match whole source messages
// and remember the originals in the DOM adapter so rendering stays reversible.
const aliases = new Map(Object.entries({
  "CROSSHAIR COLOUR": "core.crosshair_colour",
  "Pick the colour you lose least against the sunset. The crosshair always turns red over an enemy.": "core.pick_the_colour_you_lose_least_against_the",
  "INITIALISING RENDERER": "core.initialising_renderer",
  "PREPARING THE ARMOURY": "core.preparing_the_armoury"
}));
const patterns = [];
const escape = value => value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
for (const [key, source] of Object.entries(cn)) {
  for (const candidate of new Set([source, en[key]])) {
    if (!candidate.includes("{0}")) {
      if (!aliases.has(candidate)) aliases.set(candidate, key);
      continue;
    }
    // Structured messages with names, runtime telemetry or adjacent parameters
    // are formatted at their call sites. Never parse arbitrary player names.
    if (!key.startsWith("stats.") && candidate !== source) continue;
    if (/^(room\.|profile\.|weapon\.|input\.connected|stats\.by)/.test(key) || /\}\{/.test(candidate)) continue;
    const indices = [];
    const parts = candidate.split(/(\{\d+\})/).map(part => {
      if (!/^\{\d+\}$/.test(part)) return escape(part);
      indices.push(Number(part.slice(1,-1)));
      return key === "stats.distance" ? "(\\d+)" : "(.+?)";
    });
    patterns.push({ key, indices, re: new RegExp("^" + parts.join("") + "$") });
  }
}
export function legacy(locale, raw, nested = false) {
  const source = raw.trim().replace(/\s+/g, " ");
  if (!source || /^[\d\s.,:+%/—×-]+$/.test(source)) return raw;
  let key = aliases.get(source), value;
  if (key) value = message(locale, key);
  else if (!nested && source.length <= 1024) {
    if (source.startsWith("已连接：")) return message(locale, "input.connected", [source.slice(4)]);
    const failure = /^(.+)失败(?:（错误码 (\d+)）)?，可稍后手动重试；未同步进度仍保留。$/.exec(source);
    if (failure) {
      const code = failure[2] ? message(locale, "client.error_0", [failure[2]]) : "";
      return message(locale, "client.0_failed_1_retry_later_your_unsynced_progress", [legacy(locale, failure[1], true), code]);
    }
    for (const rule of patterns) {
      const match = rule.re.exec(source);
      if (!match) continue;
      const args = [];
      rule.indices.forEach((index, i) => { args[index] = legacy(locale, match[i+1], true); });
      value = message(locale, rule.key, args);
      break;
    }
    if (!value && source.startsWith("BY ")) value = message(locale, "stats.by", [source.slice(3)]);
    if (!value && source.includes(" · ")) value = source.split(" · ").map(p => legacy(locale, p)).join(" · ");
    if (!value) {
      const stat = /^([+−-]\d+%\s+)(.+)$/.exec(source);
      const score = /^(VANGUARD|EMBER)( \d+ — \d+)$/.exec(source);
      if (stat) value = stat[1] + legacy(locale, stat[2], true);
      if (score) value = legacy(locale, score[1], true) + score[2];
    }
  }
  return value === undefined ? raw : raw.replace(/\S[\s\S]*\S|\S/, () => value);
}
