"""Opt-in real-server smoke test. Start this repo's client first; requires Playwright + Edge.

GH_ORIGINAL_LIVE=1 enables one short public room as an anonymous test client.
GH_DEV_PORT selects the client (default 48722); GH_LIVE_CAPTURES saves evidence.
GH_LIVE_SECONDS observes a live match (default 60, range 1..300).
GH_LIVE_HEADED=1 shows the independent test browser.
No Bilibili login, account import, kills or cloud-save writes are performed.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

if os.environ.get("GH_ORIGINAL_LIVE") != "1":
    raise SystemExit("Set GH_ORIGINAL_LIVE=1 to explicitly enable a real public-server test")
origin = "http://127.0.0.1:" + os.environ.get("GH_DEV_PORT", "48722")
out = Path(os.environ.get("GH_LIVE_CAPTURES", "test-results/original-live"))
out.mkdir(parents=True, exist_ok=True)
duration = int(os.environ.get("GH_LIVE_SECONDS", "60"))
assert 1 <= duration <= 300, "GH_LIVE_SECONDS must be 1..300"
result = {"atUTC": datetime.now(timezone.utc).isoformat(), "clientOrigin": origin,
          "backend": "https://cod.apikeygame.top:8008", "freshAnonymousProfile": True,
          "observationSeconds": duration, "networkSamples": []}
with sync_playwright() as pw:
    exe = os.environ.get("GH_BROWSER")
    browser = pw.chromium.launch(channel=None if exe else "msedge", executable_path=exe,
        headless=os.environ.get("GH_LIVE_HEADED") != "1",
        args=["--disable-background-networking", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(locale="zh-TW", viewport={"width":1280,"height":800}, service_workers="block")
    ctx.add_init_script("localStorage.setItem('gh_weapon_models_v1', JSON.stringify({pistol:'gbull',smg:'chingi',shotgun:'linbei'}))")
    external, errors, responses = [], [], []
    def guard(route):
        if route.request.url.startswith((origin+"/", "blob:", "data:")):
            route.continue_()
        else:
            external.append(route.request.url)
            route.abort()
    ctx.route("**/*", guard)
    page = ctx.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda response: responses.append({"url":response.url,"status":response.status})
        if "/api/original/" in response.url else None)
    try:
        page.goto(origin+"/?server=https%3A%2F%2Fcod.apikeygame.top%3A8008&pvp=1", wait_until="domcontentloaded")
        page.locator("#weapon-model").wait_for(state="attached", timeout=180000)
        page.wait_for_function("document.querySelectorAll('#online-list .online-room-entry').length>0 || /暂无|暫無/.test(document.querySelector('#online-directory-status').textContent)", timeout=25000)
        result["listedRooms"] = page.locator("#online-list .online-room-entry").count()
        assert page.locator("#account-open").count() == 0
        page.locator("#original-name").fill("Community compatibility test")
        page.locator("#online-create").click()
        page.wait_for_function("GH.debug.network?.snapshots>5 && GH.debug.network.transport==='webrtc'", timeout=30000)
        result["joined"] = True
        result["network"] = page.evaluate("({...GH.debug.network})")
        assert result["network"]["transport"] == "webrtc"
        page.wait_for_function("GH.debug.match.state==='live' && GH.debug.match.time>30", timeout=15000)
        page.evaluate("async()=>{await GH.debug.gfx.whenReady();GH.debug.ctx.hud.show('pause');}")
        page.locator('#pg-pause [data-act="resume"]').click()
        page.wait_for_function("GH.debug.input.locked && GH.debug.input.enabled", timeout=8000)
        before = page.evaluate("({x:GH.debug.player.pos.x,z:GH.debug.player.pos.z,ack:GH.debug.network.ack})")
        page.keyboard.down("w")
        try:
            page.wait_for_function("p=>GH.debug.network.ack>p.ack && Math.hypot(GH.debug.player.pos.x-p.x,GH.debug.player.pos.z-p.z)>0.05", arg=before, timeout=5000)
        finally:
            page.keyboard.up("w")
        result["movementAcknowledged"] = True
        result["primaryProfile"] = page.evaluate("GH.debug.arsenal.slots[0].def.profileId")
        result["secondaryProfile"] = page.evaluate("GH.debug.arsenal.slots[1].def.profileId")
        assert result["primaryProfile"] == "ar" and result["secondaryProfile"] == "pistol"
        page.evaluate("GH.debug.arsenal.swap(1)")
        page.wait_for_function("GH.debug.arsenal.slot.def.profileId==='pistol' && GH.debug.arsenal.slot.ammo===15")
        result["secondaryAmmo"] = page.evaluate("GH.debug.arsenal.slot.ammo")
        print("PASS real WebRTC join, movement ACK and factory loadout; observing live state", flush=True)
        for _ in range(duration):
            result["networkSamples"].append(page.evaluate("({...GH.debug.network})"))
            page.wait_for_timeout(1000)
        # Require new authoritative updates at the end; a frozen page with an
        # old 'connected' label must not count as a successful live acceptance.
        snapshots = page.evaluate("GH.debug.network.snapshots")
        page.wait_for_function("n=>GH.debug.network.snapshots>n+5", arg=snapshots, timeout=25000)
        result["freshStateAtEnd"] = True
        result["deathsAtEnd"] = page.evaluate("GH.debug.player.deaths")
        result["observedNetwork"] = page.evaluate("({...GH.debug.network})")
        result["noReconnects"] = result["observedNetwork"].get("connections") == 1
        page.evaluate("GH.debug.ctx.hud.menus._act('online')")
        page.evaluate("""async()=>{await Promise.all(Object.values(GH.debug.ctx.hud.menus.pages)
            .flatMap(p=>p.getAnimations().map(a=>a.finished.catch(()=>{}))));}""")
        page.screenshot(path=str(out/"repo-original-server-joined.png"))
        assert not external and not errors, (external, errors)
        result["passed"] = True
    except Exception as error:
        result["passed"] = False
        result["failure"] = str(error)
        result["uiError"] = page.locator("#online-error").text_content() if page.locator("#online-error").count() else None
        page.screenshot(path=str(out/"failure.png"))
        raise
    finally:
        result["finalNetwork"] = page.evaluate("globalThis.GH?.debug?.network")
        if page.locator("body.online-session").count():
            page.evaluate("GH.debug.ctx.hud.menus._act('online-leave')")
            page.wait_for_function("!document.body.classList.contains('online-session')", timeout=8000)
            result["leftMatch"] = True
        result.update(responses=responses, externalRequests=external, pageErrors=errors)
        (out/"result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n", encoding="utf-8", newline="\n")
        browser.close()
print(json.dumps(result, ensure_ascii=False, indent=2))
