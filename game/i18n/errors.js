import zh from "./zh-CN.js";

// Preserve the source text for the live locale adapter, including after a switch.
export function protocolError(event) {
  const key = Object.hasOwn(zh, event.code) && event.code.startsWith("error.") ? event.code : "error.command";
  return zh[key].replace(/\{(\d+)\}/g, (_, i) => String(event.params?.[i] ?? ""));
}
