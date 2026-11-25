import { ORIGINAL_V60115, ORIGINAL_V60115_ORIGIN } from "./original-v60115.js";
import { apiOrigin } from "./api-config.js";

// A URL-selected target is fixed for the lifetime of the page, including retries.
// Switching servers reloads the client before constructing weapons or accounts.
export function connectionTarget(pageURL, configuredOrigin) {
  const query = new URL(pageURL).searchParams;
  const original = query.has("server");
  const origin = original ? query.get("server") : configuredOrigin;
  let newOrigin = false;
  if (original) {
    try { newOrigin = apiOrigin(origin, pageURL) === ORIGINAL_V60115_ORIGIN; } catch {}
  }
  const version = original && (newOrigin || query.get("serverVersion") === ORIGINAL_V60115) ? ORIGINAL_V60115 : null;
  return Object.freeze({ original, origin, ...(version && { version, weaponFormat: version }) });
}
export const serverTarget = connectionTarget(globalThis.location?.href ?? "http://localhost/",
  globalThis.document?.documentElement?.dataset.apiOrigin);

export function targetURL(pageURL, original, origin, version) {
  const url = new URL(pageURL);
  if (original) {
    if (!origin.trim()) throw Error("请输入服务器地址。");
    url.searchParams.set("server", apiOrigin(origin.trim(), pageURL));
  } else url.searchParams.delete("server");
  url.searchParams.delete("serverVersion");
  if (original && version === ORIGINAL_V60115) url.searchParams.set("serverVersion", version);
  url.searchParams.delete("solo");
  url.searchParams.set("pvp", "1");
  return url.href;
}
