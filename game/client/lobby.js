import { apiOrigin } from "./api-config.js";

// Room identifiers stay inside the lobby/transport protocol; players select a room.
export function joinHello(mode, name, room) {
  if (mode === "quick") return { name, quick: true };
  // Older deployed servers require this constant flag to list a created room.
  if (mode === "create") return { name, create: true, public: true };
  if (mode !== "listed" || typeof room !== "string" || !room) throw Error("请从大厅选择房间。");
  return { name, room };
}

export class RoomDirectory {
  constructor({ origin, pageURL, onChange, EventSource = globalThis.EventSource }) {
    this.origin = origin;
    this.pageURL = pageURL;
    this.onChange = onChange;
    this.EventSource = EventSource;
    this.active = false;
    this.generation = 0;
    this.source = null;
  }
  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.close();
    if (active) this.open();
  }
  retry() {
    this.close();
    if (this.active) this.open();
  }
  close() {
    this.generation++;
    this.source?.close();
    this.source = null;
  }
  open() {
    const generation = this.generation;
    this.onChange({ state: "loading", rooms: [] });
    let approved;
    const offline = (message) => {
      const trustURL = approved && approved !== new URL(this.pageURL).origin && approved.startsWith("https:")
        ? new URL("/api/health", approved).href : null;
      this.onChange({ state: "offline", rooms: [], message, trustURL });
    };
    try {
      approved = apiOrigin(this.origin, this.pageURL);
      if (typeof this.EventSource !== "function") throw Error("当前浏览器不支持实时房间列表。");
      const source = new this.EventSource(new URL("/api/rooms/events", approved).href, { withCredentials: false });
      this.source = source;
      const current = () => this.active && generation === this.generation && source === this.source;
      source.addEventListener("rooms", (event) => {
        if (!current()) return;
        try {
          const data = JSON.parse(event.data);
          if (data?.type !== "rooms" || !Array.isArray(data.rooms) || !data.rooms.every((room) =>
            room && /^[A-F0-9]{8}$/.test(room.room) && typeof room.hostName === "string" &&
            ["lobby", "countdown", "live", "over"].includes(room.phase) && room.capacity === 10 &&
            Number.isInteger(room.humans) && room.humans > 0 && room.humans <= 10 &&
            Number.isInteger(room.bots) && room.bots >= 0 && room.bots <= 10 && typeof room.joinable === "boolean"
          )) throw Error("房间列表数据无效，请重试。");
          this.onChange({ state: "ready", rooms: data.rooms });
        } catch (error) {
          offline(error.message);
        }
      });
      source.addEventListener("error", () => {
        if (current()) offline("实时列表连接中断，正在等待恢复。你可以等待列表恢复或尝试快速加入。");
      });
    } catch (error) {
      offline(error.message);
    }
  }
}
