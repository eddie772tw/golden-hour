import { apiOrigin } from "./api-config.js";

// A URL-selected target is fixed for the lifetime of the page, including retries.
// Switching servers reloads the client before constructing weapons or accounts.
export function connectionTarget(pageURL, configuredOrigin) {
  const query = new URL(pageURL).searchParams;
  return Object.freeze({ original: query.has("server"),
    origin: query.has("server") ? query.get("server") : configuredOrigin });
}
export const serverTarget = connectionTarget(globalThis.location?.href ?? "http://localhost/",
  globalThis.document?.documentElement?.dataset.apiOrigin);

export function targetURL(pageURL, original, origin) {
  const url = new URL(pageURL);
  if (original) {
    if (!origin.trim()) throw Error("请输入服务器地址。");
    url.searchParams.set("server", apiOrigin(origin.trim(), pageURL));
  } else url.searchParams.delete("server");
  url.searchParams.delete("solo");
  url.searchParams.set("pvp", "1");
  return url.href;
}
