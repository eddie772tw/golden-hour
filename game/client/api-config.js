// Only local HTML configuration approves a backend. Remote JSON cannot grant
// itself permission to send SDP to a different signaling origin.
const approvedRTCOrigins = new WeakMap();
export const ORIGINAL_ORIGIN = "https://cod.apikeygame.top:8008";

export function originalApiURL(path, pageURL) {
  const url = new URL(path, ORIGINAL_ORIGIN);
  if (url.origin !== ORIGINAL_ORIGIN || url.username || url.password || url.search || url.hash || !url.pathname.startsWith("/api/"))
    throw Error("原版服务器 API 地址无效。");
  return new URL("/api/original/" + url.pathname.slice(5), pageURL);
}

export function apiOrigin(value, pageURL) {
  // An explicit empty address disables multiplayer; absence keeps native development same-origin.
  if (value === "") throw Error("联机功能暂未开放，请使用单人训练。");
  const page = new URL(pageURL);
  if (!value) return page.origin;
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw Error("API 地址必须是完整的 Origin，不能包含路径或登录信息。");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw Error("API 地址必须使用 HTTPS（localhost 开发除外）。");
  return url.origin;
}

export function rtcSignalingURL(config, pageURL) {
  const origin = approvedRTCOrigins.get(config) || new URL(pageURL).origin;
  const url = new URL(config.url, origin + "/");
  if (url.origin !== origin || url.username || url.password)
    throw Error("WebRTC 信令必须使用批准的游戏服务器。");
  return url;
}

export async function loadApiConfig(origin, pageURL, request = globalThis.fetch, { gateway = false } = {}) {
  const approved = apiOrigin(origin, pageURL);
  const proxied = gateway && approved === ORIGINAL_ORIGIN;
  try {
    const response = await request(proxied ? originalApiURL("/api/config", pageURL) : new URL("/api/config", approved), {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw Error("联机服务未启动或暂时不可用，请稍后重试。");
    const config = await response.json();
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw Error("联机配置无效，请稍后重试。");
    if (config.rtc && typeof config.rtc === "object") {
      approvedRTCOrigins.set(config.rtc, approved);
      const signaling = rtcSignalingURL(config.rtc, pageURL);
      if (proxied) {
        config.rtc = { ...config.rtc, url: originalApiURL(signaling.href, pageURL).href };
        approvedRTCOrigins.set(config.rtc, new URL(pageURL).origin);
      }
    }
    if (proxied) {
      if (!config.rtc) throw Error("原版服务器未提供 WebRTC 连接。");
      // The local gateway forwards HTTP signaling, not QUIC. The original's
      // verified working fallback is WebRTC, so use it without a failed QUIC wait.
      config.preferredTransport = "webrtc";
    }
    return config;
  } catch (cause) {
    const error = new Error(cause.message || "联机请求失败，请检查网络后重试。", { cause });
    if (approved !== new URL(pageURL).origin && approved.startsWith("https:"))
      error.trustURL = new URL("/api/health", approved).href;
    throw error;
  }
}
