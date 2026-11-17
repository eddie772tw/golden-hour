import http2 from "node:http2";
import tls from "node:tls";
import { ORIGINAL_ORIGIN } from "../game/client/api-config.js";

const upstream = new URL(ORIGINAL_ORIGIN);
const toyOrigin = "https://www.bilibilitoy.com";
const paths = new Map([
  ["/config", "GET"], ["/health", "GET"], ["/rooms/events", "GET"],
  ["/rtc", "POST"], ["/rtc/offer", "POST"],
]);
let active = 0;

function connectOriginal() {
  return http2.connect(ORIGINAL_ORIGIN, {
    createConnection: () => tls.connect({
      host: upstream.hostname, port: Number(upstream.port), ALPNProtocols: ["h2"],
      // This endpoint resets SNI handshakes. Omitting the routing extension
      // still requires a trusted chain AND the exact configured host identity.
      servername: "", rejectUnauthorized: true,
      checkServerIdentity: (_, cert) => tls.checkServerIdentity(upstream.hostname, cert),
    }),
  });
}

// A fixed-origin, fixed-path relay; never a general proxy. connect is injectable
// only for the loopback protocol test. Browser requests cannot select a host,
// TLS settings, headers, redirects or an authentication identity.
export async function originalGateway(req, res, url, localOrigin, connect = connectOriginal) {
  const reply = (status, message) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(message);
  };
  if (req.headers.host !== new URL(localOrigin).host || (req.headers.origin && req.headers.origin !== localOrigin))
    return reply(403, "Local origin required");
  const suffix = url.pathname.slice("/api/original".length);
  if (!url.pathname.startsWith("/api/original/") || url.search || !paths.has(suffix))
    return reply(404, "Unknown original API");
  if (req.method !== paths.get(suffix)) return reply(405, "Method not allowed");
  if (req.method === "POST" && (req.headers.origin !== localOrigin || req.headers["content-type"] !== "application/json"))
    return reply(403, "Same-origin JSON required");
  let body;
  if (req.method === "POST") {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) return reply(413, "Offer too large");
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
    try {
      const offer = JSON.parse(body);
      if (offer.type !== "offer" || typeof offer.sdp !== "string" || !offer.sdp.includes("m=application")) throw Error();
    } catch { return reply(400, "Expected data-channel SDP offer"); }
  }
  if (res.destroyed) return;
  if (active >= 16) return reply(503, "Original connection limit");
  active++;
  let client, stream, timer, closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true; active--; clearTimeout(timer);
    stream?.destroy(); client?.destroy();
  };
  const fail = () => {
    if (closed) return;
    if (res.headersSent) res.destroy();
    else reply(502, "Original server connection failed; retry later");
    cleanup();
  };
  res.once("close", cleanup);
  try {
    client = connect();
    client.on("error", fail);
    client.once("close", () => { if (!closed) fail(); });
    client.setTimeout(90000, fail);
    timer = setTimeout(fail, 10000);
    stream = client.request({ ":method": req.method, ":path": "/api" + suffix,
      origin: toyOrigin, "accept-encoding": "identity",
      accept: suffix === "/rooms/events" ? "text/event-stream" : "application/json",
      ...(body && { "content-type": "application/json" }),
    });
    stream.on("error", fail);
    stream.once("response", headers => {
      clearTimeout(timer);
      res.writeHead(headers[":status"], {
        "Content-Type": headers["content-type"] || "text/plain",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      });
      res.flushHeaders();
      stream.pipe(res);
    });
    stream.once("end", cleanup);
    stream.end(body);
  } catch { fail(); }
}
