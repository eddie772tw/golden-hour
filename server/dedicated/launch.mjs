import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, chmodSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { isIPv4 } from "node:net";
import { resolve, sep, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { openGame, portableOptions } from "./portable.mjs";
import { originalGateway } from "../original-gateway.mjs";

const [entry, ...args] = process.argv.slice(2);
const localPort = Number(process.env.GH_CLIENT_PORT || 48722),
  local = "http://127.0.0.1:" + localPort;
const game = fileURLToPath(new URL("../../game/", import.meta.url));
function parseInvite(value) {
  const u = new URL(value);
  const match = /^\/([a-f0-9]{64})(?:\/([A-F0-9]{8}))?$/.exec(u.pathname);
  if (
    u.protocol !== "gh1:" ||
    !match ||
    !u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !isIPv4(u.hostname)
  )
    throw Error("Invalid gh1 invitation");
  return {
    host: u.hostname,
    port: Number(u.port),
    pin: match[1],
    room: match[2],
  };
}
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter(
    (n) =>
      n.family === "IPv4" && !n.internal && !n.address.startsWith("169.254."),
  )
  .map((n) => n.address);
const portable = entry === "portable-client" || entry === "portable-server";
const [mode, arg] = portable ? await portableOptions(entry, args, addresses) : [entry, args[0]];
let invite;
if (mode === "solo" && portable) {
  process.env.GH_DEV_PORT = String(localPort);
  process.env.GH_BIND_IP = "127.0.0.1";
  await import("../server.mjs");
  openGame(local + "/?solo");
} else if (mode === "host" || mode === "serve") {
  const ip = arg ?? (addresses.length === 1 ? addresses[0] : null);
  if (!isIPv4(ip ?? "") || (!addresses.includes(ip) && ip !== "127.0.0.1"))
    throw Error("Select this computer's LAN IPv4: " + addresses.join(", "));
  const port = Number(process.env.GH_SERVER_PORT || 48723);
  const dir = resolve(
    process.env.GH_DATA_DIR ||
      fileURLToPath(new URL("../.local/dedicated", import.meta.url)),
  );
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = join(dir, "host.key"),
    cert = join(dir, "host.crt");
  if (!existsSync(key) && !existsSync(cert)) {
    const bundled = join(
      process.env.ProgramFiles || "C:/Program Files",
      "Git/usr/bin/openssl.exe",
    );
    const openssl =
      process.env.GH_OPENSSL ||
      (process.platform === "win32" && existsSync(bundled)
        ? bundled
        : "openssl");
    execFileSync(
      openssl,
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-nodes",
        "-sha256",
        "-days",
        "3650",
        "-subj",
        "/CN=GoldenHour",
        "-keyout",
        key,
        "-out",
        cert,
      ],
      { stdio: "pipe" },
    );
    chmodSync(key, 0o600);
  }
  const fingerprint = new X509Certificate(readFileSync(cert)).fingerprint256
    .replaceAll(":", "")
    .toLowerCase();
  invite = "gh1://" + ip + ":" + port + "/" + fingerprint;
  Object.assign(process.env, {
    GH_BIND_IP: ip,
    GH_DEV_PORT: String(port),
    GH_TLS_KEY: key,
    GH_TLS_CERT: cert,
    GH_CAREER_DB: join(dir, "career.sqlite"),
  });
  await import("../server.mjs");
  console.log("Invite: " + invite);
} else if (mode === "join") invite = arg;
else
  throw Error(
    "Use host <LAN IPv4>, serve <LAN IPv4>, or join <gh1 invitation>",
  );

if (mode === "host" || mode === "join") {
  const target = parseInvite(invite);
  const upstream = "https://" + target.host + ":" + target.port;
  const agent = new https.Agent();
  // Check the invite fingerprint before handing any socket to the HTTP request.
  agent.createConnection = (options, done) => {
    const socket = tls.connect({
      ...options,
      servername: undefined,
      rejectUnauthorized: false,
    });
    const failed = (err) => done(err);
    socket.once("error", failed);
    socket.once("secureConnect", () => {
      socket.off("error", failed);
      const pin = socket
        .getPeerCertificate()
        .fingerprint256?.replaceAll(":", "")
        .toLowerCase();
      if (pin !== target.pin) {
        socket.destroy();
        done(Error("Host fingerprint changed"));
        return;
      }
      done(null, socket);
    });
  };
  const api = new Set([
    "/api/config",
    "/api/rtc",
    "/api/rooms/events",
    "/api/health",
    "/api/career",
    "/api/ranks",
    "/api/receipt",
    "/api/auth/challenge",
    "/api/auth/prove",
  ]);
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".json": "application/json",
    ".glb": "model/gltf-binary",
  };
  http
    .createServer(async (req, res) => {
      try {
        if (
          req.headers.host !== local.slice(7) ||
          (req.headers.origin && req.headers.origin !== local) ||
          (req.method !== "GET" && req.headers.origin !== local)
        ) {
          res.writeHead(403).end();
          return;
        }
        const path = new URL(req.url, local).pathname;
        if (path.startsWith("/api/original/")) {
          await originalGateway(req, res, new URL(req.url, local), local);
          return;
        }
        if (path === "/api/invite") {
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(
              JSON.stringify({
                invite: invite.split("/").slice(0, 4).join("/"),
                room: target.room,
              }),
            );
          return;
        }
        if (path === "/api/auth/prove" && req.headers["x-gh-host-pin"] !== target.pin) {
          res.writeHead(409).end("Invitation changed. Authenticate again.");
          return;
        }
        if (api.has(path)) {
          const headers = { origin: upstream };
          for (const h of ["content-type", "authorization"])
            if (req.headers[h]) headers[h] = req.headers[h];
          const proxy = https.request(
            upstream + path,
            { agent, method: req.method, headers },
            (remote) => {
              res.writeHead(remote.statusCode, {
                ...(path === "/api/auth/challenge" && { "X-GH-Host-Pin": target.pin }),
                "Content-Type": remote.headers["content-type"] || "text/plain",
                "Cache-Control": "no-store",
              });
              remote.pipe(res);
              remote.on("error", () => res.destroy());
            },
          );
          proxy.on("error", () => {
            if (!res.headersSent) res.writeHead(502);
            res.end("Host unavailable or fingerprint mismatch");
          });
          res.on("close", () => proxy.destroy());
          req.pipe(proxy);
          return;
        }
        if (req.method !== "GET" || path.startsWith("/api/")) {
          res.writeHead(404).end();
          return;
        }
        const file = resolve(
          game,
          "." + decodeURIComponent(path === "/" ? "/index.html" : path),
        );
        if (!file.startsWith(resolve(game) + sep)) {
          res.writeHead(403).end();
          return;
        }
        const body = await readFile(file);
        res
          .writeHead(200, {
            "Content-Type": types[extname(file)] || "application/octet-stream",
            "Cache-Control": "no-store",
          })
          .end(body);
      } catch {
        res.writeHead(404).end();
      }
    })
    .listen(localPort, "127.0.0.1", () => {
      if (portable) openGame(local + "/?pvp");
      else console.log("Open " + local + " in this computer's browser.");
    });
}
