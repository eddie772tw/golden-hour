"""Edge + two owned loopback servers: original protocol and existing local auth.

Requires Python Playwright and Edge, or GH_BROWSER. No public server is contacted.
Optional GH_COMPAT_CAPTURES stores menu screenshots for visual inspection.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
from urllib.parse import quote
from urllib.request import urlopen

from playwright.sync_api import sync_playwright
from browser_account import create_account

root = Path(__file__).resolve().parents[1]
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
origin = f"http://127.0.0.1:{port}"
env = {k: v for k, v in os.environ.items() if not k.startswith("GH_")}
env.update(GH_DEV_PORT=str(port), GH_CAREER_DB=":memory:", GH_TEST_CLIENT_ORIGIN=origin)
processes = []
with tempfile.TemporaryFile() as log:
    try:
        for script in ["server/server.mjs", "server/fixtures/original-server.mjs"]:
            process = subprocess.Popen(["node", script], cwd=root, env=env,
                stdout=subprocess.PIPE, stderr=log, text=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            processes.append(process)
            line = process.stdout.readline().strip()
            assert line, f"Server failed to start: {script}"
            if script.endswith("original-server.mjs"):
                remote = line
        with sync_playwright() as pw:
            exe = os.environ.get("GH_BROWSER")
            browser = pw.chromium.launch(channel=None if exe else "msedge", executable_path=exe,
                args=["--enable-unsafe-swiftshader", "--disable-background-networking"])
            ctx = browser.new_context(viewport={"width": 1280, "height": 800}, service_workers="block")
            requests, errors, blocked = [], [], []
            def guard(route):
                url = route.request.url
                if url.startswith((origin+"/", remote+"/", "blob:", "data:")):
                    requests.append(url)
                    route.continue_()
                else:
                    blocked.append(url)
                    route.abort()
            ctx.route("**/*", guard)
            saved = json.dumps({"pistol": "gbull", "smg": "chingi", "shotgun": "linbei"}, separators=(",", ":"))
            ctx.add_init_script("""if (!localStorage.getItem('gh_weapon_models_v1'))
                localStorage.setItem('gh_weapon_models_v1', %s);""" % json.dumps(saved))
            page = ctx.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(origin+"/?server="+quote(remote, safe="")+"&pvp=1&toy=host", wait_until="domcontentloaded")
            page.locator("#weapon-model").wait_for(state="attached", timeout=180000)
            assert page.locator("#account-open").count() == 0
            assert page.locator("#original-name").is_visible()
            assert "Shop" in page.locator("#server-policy").text_content()
            for family, model in [("pistol", "gbull"), ("smg", "chingi"), ("shotgun", "linbei")]:
                page.evaluate("family=>{const m=GH.debug.ctx.hud.menus;m.go('gunsmith');m.gs.w=family;m._gsRender(false);}", family)
                assert page.locator("#weapon-model").is_disabled()
                assert page.locator("#weapon-model").input_value() == family
                assert page.evaluate("([family,model])=>!GH.debug.ctx.hud.menus.studio.ensure(family).root.getObjectByName(model)", [family, model])
            page.evaluate("GH.debug.ctx.hud.menus._act('online')")
            page.evaluate("""async()=>{await Promise.all(Object.values(GH.debug.ctx.hud.menus.pages)
                .flatMap(p=>p.getAnimations().map(a=>a.finished.catch(()=>{}))));}""")
            if os.environ.get("GH_COMPAT_CAPTURES"):
                dest = Path(os.environ["GH_COMPAT_CAPTURES"])
                dest.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(dest/"original-compatible-menu.png"))
                page.locator("#server-target summary").click()
                page.screenshot(path=str(dest/"original-compatible-server-selection.png"))
                page.locator("#server-target summary").click()
            page.locator("#original-name").fill("Original guest")
            page.locator("#online-create").click()
            page.wait_for_function("GH.debug.network?.snapshots>2", timeout=25000)
            page.evaluate("GH.debug.arsenal.swap(1)")
            page.wait_for_function("GH.debug.arsenal.slot.def.profileId==='pistol' && GH.debug.arsenal.slot.ammo===15")
            result = page.evaluate("""async remote=>{
              const {Connection}=await import('/client/net.js');
              const {loadApiConfig}=await import('/client/api-config.js');
              const n=new Connection({original:true});
              n.issueTicket=()=>{throw Error('Local admission requested');};
              let snapshot,welcomes=0;
              n.addEventListener('snapshot',({detail:s})=>snapshot=s);
              n.addEventListener('event',({detail:e})=>{if(e.type==='welcome')welcomes++;});
              const until=async fn=>{const end=performance.now()+15000;while(!fn()){
                if(performance.now()>end)throw Error('Timed out: '+fn);await new Promise(r=>setTimeout(r,25));}};
              const config=await loadApiConfig(remote,location.href);
              await n.connect({name:'Protocol guest',quick:true,ticket:'must-not-send',profile:'must-not-send'},config);
              await until(()=>snapshot);
              const me=()=>snapshot.players.find(p=>p.id===n.id);
              await n.send({type:'equip',weapon:'gbull'});await until(()=>me().weapon==='pistol');
              const z=me().z;
              await n.input({seq:12,forward:1,yaw:0});await until(()=>me().ack===12&&Math.abs(me().z-z)>0.01);
              await n.send({type:'shot',yaw:0,pitch:0});await until(()=>me().ammo===14);
              await n.send({type:'reload'});await until(()=>me().ammo===15);
              const id=n.id;n.transport.close();
              await until(()=>welcomes===2&&n.writer&&n.id===id&&me().ack===12);
              await n.send({type:'equip',weapon:'chingi'});await until(()=>me().weapon==='smg');
              await n.send({type:'equip',weapon:'linbei'});await until(()=>me().weapon==='shotgun');
              const ack=me().ack;await n.leave();return {welcomes,id,ack};
            }""", remote)
            print("PASS anonymous RTC, movement, shot/reload, resume and three equip fallbacks", result, flush=True)
            page.evaluate("GH.debug.ctx.hud.menus._act('online-leave')")
            page.wait_for_function("!document.body.classList.contains('online-session')")
            assert page.evaluate("localStorage.getItem('gh_weapon_models_v1')") == saved
            assert not any("shop-weapons/" in url or "/api/auth/" in url or "/api/career" in url or "/api/invite" in url for url in requests), requests
            with urlopen(remote+"/test/evidence") as response:
                evidence = json.load(response)
            assert not evidence["unexpected"], evidence
            assert evidence["offers"] and all(item["authorization"] is None for item in evidence["offers"])
            assert len(evidence["hellos"]) >= 3 and not any("ticket" in h or "profile" in h for h in evidence["hellos"])
            assert all(weapon in ["ar", "smg", "shotgun", "pistol"] for weapon in evidence["equips"])
            assert evidence["inputs"] > 0
            # Switch back through the actual form. Saved Shop preferences become
            # effective again; the existing local account/RTC flow still works.
            page.evaluate("GH.debug.ctx.hud.menus._act('online')")
            page.locator("#server-target summary").click()
            page.locator("#server-mode").select_option("local")
            page.locator("#server-apply").click()
            page.wait_for_url(lambda url: "server=" not in url)
            page.locator("#account-open").wait_for(timeout=180000)
            print("PASS switching back to the local account mode", flush=True)
            page.evaluate("const m=GH.debug.ctx.hud.menus;m.go('gunsmith');m.gs.w='pistol';m._gsRender(false)")
            assert page.locator("#weapon-model").is_enabled()
            assert page.locator("#weapon-model").input_value() == "gbull"
            page.evaluate("GH.debug.ctx.hud.menus.go('main')")
            create_account(page, "Local guest")
            page.locator("#online-create").click()
            page.wait_for_function("GH.debug.network?.snapshots>2", timeout=25000)
            page.evaluate("GH.debug.arsenal.swap(1)")
            page.wait_for_function("GH.debug.arsenal.slot.def.profileId==='gbull' && GH.debug.arsenal.slot.ammo===20")
            page.evaluate("GH.debug.ctx.hud.menus._act('online-leave')")
            page.wait_for_function("!document.body.classList.contains('online-session')")
            assert not errors and not blocked, (errors, blocked)
            print("PASS original-compatible UI/RTC: saved-model fallback, no Shop art/accounts, anonymous hello, movement ACK, shot/reload, resume, all three equip fallbacks; local account/Shop round trip", result)
            browser.close()
    finally:
        for process in reversed(processes):
            process.terminate()
            process.wait(timeout=10)
        log.seek(0)
        diagnostics = log.read().decode("utf-8", errors="replace")
        if diagnostics.strip():
            print(diagnostics)
