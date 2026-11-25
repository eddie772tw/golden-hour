"""One rendered client and three separate signed Edge WebRTC clients on loopback.

The test starts and stops its own community server with an in-memory career DB.
Set GH_BROWSER to use a specific Chromium executable.
"""
import os
from pathlib import Path
import socket
import subprocess
import tempfile

from playwright.sync_api import sync_playwright
from browser_account import create_account

root = Path(__file__).resolve().parents[1]
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
origin = f"http://127.0.0.1:{port}"
env = {key: value for key, value in os.environ.items() if not key.startswith("GH_")}
env.update(GH_DEV_PORT=str(port), GH_CAREER_DB=":memory:")
peer_runtime = """async ({name,room,ready=true,protocol=1})=>{
  const {Connection}=await import('/client/net.js');
  const {Vault}=await import('/client/account-vault.js');
  const {loadApiConfig}=await import('/client/api-config.js');
  const vault=new Vault();
  await vault.init();
  await vault.create(name,'portable integration test passphrase');
  const config=await loadApiConfig(location.origin,location.href);
  const net=new Connection({original:false, connectTimeoutMs:6000});
  net.issueTicket=()=>vault.authenticate();
  const data=globalThis.coopTest={net,vault,welcomes:0};
  net.addEventListener('event',e=>{
    if(e.detail.type==='room') data.room=e.detail;
    if(e.detail.type==='welcome') data.welcomes++;
  });
  net.addEventListener('snapshot',e=>data.snapshot=e.detail);
  try{
    await net.connect({name,room,...(protocol && {coopProtocol:protocol})},config);
    if(ready) await net.send({type:'ready',ready:true});
    return {id:net.id,format:net.metrics.transport};
  }catch(e){
    await net.leave();
    return {error:String(e.message)};
  }
}"""
errors = []
with tempfile.TemporaryFile() as log:
    process = subprocess.Popen(["node", "server/server.mjs"], cwd=root, env=env,
        stdout=subprocess.PIPE, stderr=log, text=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        assert process.stdout.readline().strip() == f"Golden Hour: {origin}"
        with sync_playwright() as play:
            executable = os.environ.get("GH_BROWSER")
            browser = play.chromium.launch(channel=None if executable else "msedge", executable_path=executable,
                args=["--enable-unsafe-swiftshader", "--disable-background-networking"])

            def new_client(path):
                context = browser.new_context(viewport={"width": 1280, "height": 800}, service_workers="block")
                context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(
                    (origin + "/", "blob:", "data:")) else route.abort())
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(origin + path, wait_until="domcontentloaded")
                return page

            host = new_client("/")
            create_account(host, "Coop Host")
            host.locator("#community-mode").wait_for(state="visible", timeout=15000)
            host.locator("#community-mode").select_option("zombie-coop")
            host.locator("#online-create").click()
            host.wait_for_function("GH.debug.network?.snapshots>2")
            assert host.locator("#online-next").is_disabled()
            room = host.evaluate("""async()=>{
              const feeds=new EventSource('/api/rooms/events');
              return new Promise((resolve,reject)=>{
                feeds.addEventListener('rooms',({data})=>{
                  feeds.close();
                  try {
                    const r=JSON.parse(data).rooms.find(x=>x.hostName==='Coop Host');
                    if(r?.capacity!==4 || r?.bots!==0) throw Error('invalid coop listing');
                    resolve(r.room);
                  } catch(e) { reject(e); }
                },{once:true});
              });
            }""")
            legacy = new_client("/api/health")
            rejected = legacy.evaluate(peer_runtime, {"name": "Legacy", "room": room, "protocol": 0})
            assert "不支持" in rejected["error"], rejected
            legacy.context.close()

            peers = [new_client("/api/health") for _ in range(3)]
            ids = [page.evaluate(peer_runtime, {"name": f"Coop Peer {index}", "room": room})
                for index, page in enumerate(peers, 1)]
            assert sorted(entry["id"] for entry in ids) == [2, 3, 4], ids
            assert all(entry["format"] == "webrtc" for entry in ids), ids
            fourth = peers[-1]
            fourth.wait_for_function("coopTest.room.modeState.connected===4")
            assert fourth.evaluate("coopTest.room.phase") == "lobby"
            extra = new_client("/api/health")
            rejected = extra.evaluate(peer_runtime, {"name": "Extra", "room": room})
            assert "已满" in rejected["error"], rejected
            extra.context.close()
            assert host.locator("#online-next").is_enabled()
            host.locator("#online-next").click()
            host.locator(".community-coop-hud").wait_for(state="visible", timeout=20000)
            for page in peers:
                page.wait_for_function("coopTest.snapshot?.zombies?.length === 4 && coopTest.snapshot.players.length === 4")
                page.evaluate("coopTest.net.input({seq:12,forward:1,yaw:Math.PI})")
                page.wait_for_function("coopTest.snapshot.players.find(p=>p.id===coopTest.net.id)?.ack===12")
            before = fourth.evaluate("coopTest.net.id")
            fourth.evaluate("coopTest.net.transport.close()")
            fourth.wait_for_function("coopTest.welcomes===2 && coopTest.net.metrics.connections===2")
            assert fourth.evaluate("coopTest.net.id") == before
            assert fourth.evaluate("coopTest.snapshot.players.length") == 4
            assert fourth.evaluate("coopTest.room.modeState.connected") == 4
            assert "感染者" in host.locator(".community-coop-hud").text_content()
            assert not errors, errors
            print("PASS four independent signed WebRTC seats, legacy/fifth rejection, host start, "
                  "four-enemy snapshot and HUD, movement ACK and same-seat resume", flush=True)
            for page in peers:
                page.evaluate("coopTest.net.leave()")
            browser.close()
    finally:
        process.terminate()
        process.wait(timeout=10)
        log.seek(0)
        diagnostics = log.read().decode(errors="replace").strip()
        if diagnostics:
            print(diagnostics)
