import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export function openGame(url) {
  console.log("Open " + url + " in your usual browser profile.");
  if (process.env.GH_NO_BROWSER === "1") return;
  const child = spawn(join(process.env.SystemRoot, "explorer.exe"), [url], {
    detached: true, stdio: "ignore", windowsHide: true,
  });
  child.on("error", err => console.error(err.message));
  child.unref();
}

export async function portableOptions(role, args, addresses) {
  const state = join(process.env.LOCALAPPDATA, "Golden Hour");
  const env = process.env;
  const root = fileURLToPath(new URL("../../", import.meta.url));
  env.GH_OPENSSL = join(root, "runtime", "openssl.exe");
  env.OPENSSL_CONF = join(root, "runtime", "openssl.cnf");
  env.GH_DATA_DIR ||= join(state, "dedicated");
  env.GH_CAREER_DB ||= join(state, "career.sqlite");

  const server = role === "portable-server";
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    let [mode, target] = args;
    if (server && !mode) mode = "serve";
    if (!mode) {
      console.log("Golden Hour\n1. 單人訓練 / Solo\n2. 區網開房 / Host\n3. 貼邀請加入 / Join");
      mode = ({1:"solo", 2:"host", 3:"join"})[(await rl.question("> ")).trim()];
    }
    if (!(server ? ["serve"] : ["solo", "host", "join"]).includes(mode))
      throw Error(server ? "Use Start-Server.cmd serve [IPv4]" : "Choose solo, host or join.");
    if (mode === "join" && !target)
      target = (await rl.question("完整邀請 / Full gh1:// invitation: ")).trim();
    if ((mode === "host" || mode === "serve") && !target) {
      if (!addresses.length) throw Error("Connect to a LAN or hotspot first.");
      if (addresses.length === 1) target = addresses[0];
      else {
        addresses.forEach((ip,i) => console.log((i+1) + ". " + ip));
        const answer = (await rl.question("區網 IPv4 或編號 / LAN IPv4 or number: ")).trim();
        target = addresses[Number(answer)-1] ?? answer;
      }
    }
    if (mode === "solo") mkdirSync(state,{recursive:true});
    if (mode === "host" || mode === "serve") {
      console.log("Server data: " + env.GH_DATA_DIR);
      const cert = existsSync(join(env.GH_DATA_DIR, "host.crt"));
      const key = existsSync(join(env.GH_DATA_DIR, "host.key"));
      if (cert !== key) throw Error("Restore both host.crt and host.key before starting.");
      if (!cert && existsSync(join(env.GH_DATA_DIR, "career.sqlite")))
        console.log("Opening existing career database with a new TLS invitation.");
    }
    return [mode, target];
  } finally { rl.close(); }
}
