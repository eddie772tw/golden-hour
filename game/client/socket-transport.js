const protocol = "gh-pvp-v1";

// WebSocket text carries reliable frames and binary carries the state lane.
export class SocketTransport {
  constructor(url) {
    const socket = this.socket = new WebSocket(url, protocol);
    socket.binaryType = "arraybuffer";
    this.closed = new Promise(resolve => { this.finish = resolve; });
    this.ready = new Promise((resolve, reject) => {
      this.rejectReady = reject;
      socket.addEventListener("open", () => {
        if (socket.protocol === protocol) resolve();
        else this.close("socket-protocol");
      }, { once: true });
    });
    this.ready.catch(() => {});
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    let events, snapshots;
    const lane = (start, highWaterMark, text) => ({
      readable: new ReadableStream({ start }, { highWaterMark }),
      writable: { getWriter: () => ({ write: async bytes => {
        if (socket.readyState !== WebSocket.OPEN) throw Error("WebSocket 已关闭。");
        if (socket.bufferedAmount + bytes.byteLength > (text ? 65536 : 8192)) {
          if (!text) return false;
          throw Error("WebSocket 发送队列已满。");
        }
        socket.send(text ? decoder.decode(bytes) : bytes);
        return true;
      } }) },
    });
    this.stream = lane(controller => { events = controller; }, 128, true);
    this.datagrams = lane(controller => { snapshots = controller; }, 1, false);
    this.controllers = [events, snapshots];
    socket.addEventListener("message", ({ data }) => {
      if (!this.controllers) return;
      if (typeof data === "string") {
        const bytes = encoder.encode(data);
        if (bytes.byteLength > 16384 || events.desiredSize <= 0) return this.close("event-overflow");
        events.enqueue(bytes);
      } else if (data instanceof ArrayBuffer && data.byteLength <= 1200 && snapshots.desiredSize > 0) {
        snapshots.enqueue(new Uint8Array(data));
      }
    });
    for (const event of ["close", "error"]) socket.addEventListener(event, () => this.close("socket-" + event), { once: true });
  }
  async createBidirectionalStream() { return this.stream; }
  close(reason = "local-close") {
    if (!this.controllers) return;
    this.closeReason = reason;
    for (const controller of this.controllers) controller.close();
    this.controllers = null;
    this.rejectReady(Error("WebSocket 连接未能打开。"));
    this.finish();
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}
