"""Start npm start first. Requires Python Playwright and Edge, or set GH_BROWSER."""
import os
from playwright.sync_api import sync_playwright

origin = "http://127.0.0.1:" + os.getenv("GH_DEV_PORT", "48722")
labels = {
    "zh-CN": ("单人训练", "创建房间", "武器解锁"),
    "en-US": ("Solo training", "Create room", "Weapon unlocks"),
    "zh-TW": ("單人訓練", "建立房間", "武器解鎖"),
    "ja-JP": ("ソロ訓練", "部屋を作る", "武器解除"),
    "ja-JP-x-kyoto": ("ソロ訓練", "部屋を作る", "武器解除"),
}
with sync_playwright() as pw:
    exe = os.getenv("GH_BROWSER")
    browser = pw.chromium.launch(channel=None if exe else "msedge", executable_path=exe,
        args=["--enable-unsafe-swiftshader", "--disable-background-networking"])
    ctx = browser.new_context(locale="ja-JP", viewport={"width": 960, "height": 600}, service_workers="block")
    page = ctx.new_page()
    errors, external = [], []
    def guard(route):
        if route.request.url.startswith((origin+"/","blob:","data:")):
            route.continue_()
        else:
            external.append(route.request.url)
            route.abort()
    ctx.route("**/*", guard)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(origin, wait_until="domcontentloaded")
    selector = page.locator("[data-locale]")
    selector.wait_for(timeout=150000)
    assert selector.input_value() == "ja-JP"
    for lang, (training, create, unlock) in labels.items():
        selector.select_option(lang)
        page.wait_for_function("lang => document.documentElement.lang === lang", arg=lang)
        assert page.locator('#pg-main [data-act="deploy"] b').text_content() == training
        page.locator("#language-menu button").click()
        assert page.locator("#credits-dialog strong").inner_text() == "蒙哥汗马利@LankiYang"
        page.locator("#credits-dialog button").click()
        page.locator('#pg-main [data-act="settings"]').click()
        assert page.locator("#pg-settings.on select[data-input-mode]").count() == 1
        page.evaluate("GH.debug.ctx.hud.menus.go('main')")
        page.locator('#pg-main [data-act="toy-ranks"]').click()
        page.wait_for_selector("#pg-toy-ranks.on")
        page.locator('[data-act="toy-back"]:visible').click()
        page.evaluate("""() => { const m=GH.debug.ctx.hud.menus; m.go('gunsmith'); m.gs.w='smg'; m._gsRender(false); m._gsEquip(); }""")
        assert page.locator("#pg-toy-unlock h2").text_content() == unlock
        page.wait_for_function("document.querySelector('[data-unlock-checks]').textContent.includes('0/10')")
        page.evaluate("GH.debug.ctx.hud.menus.go('main')")
        page.locator('#pg-main [data-act="online"]').click()
        assert page.locator("#online-create b").text_content() == create
        page.evaluate("GH.debug.ctx.hud.menus.go('main')")
    for width in [390, 640]:
        page.set_viewport_size({"width":width, "height":740})
        page.locator("#language-menu button").click()
        box = page.locator("#credits-dialog").bounding_box()
        assert 0 <= box["x"] and box["x"]+box["width"] <= width
        page.locator("#credits-dialog button").click()
    page.set_viewport_size({"width":960, "height":600})
    page.reload(wait_until="domcontentloaded")
    selector.wait_for(timeout=150000)
    assert selector.input_value() == "ja-JP-x-kyoto"
    page.locator('#pg-main [data-act="deploy"]').click()
    page.wait_for_function("GH.debug.match.live && GH.debug.match.time < 479.9", timeout=90000)
    assert page.evaluate("GH.debug.match.bots.length") == 9
    pos = page.evaluate("GH.debug.player.pos.toArray()")
    page.keyboard.down("w")
    page.wait_for_function("p => GH.debug.player.pos.distanceToSquared({x:p[0],y:p[1],z:p[2]}) > .04", arg=pos)
    page.keyboard.up("w")
    ammo = page.evaluate("GH.debug.arsenal.slots[0].ammo")
    page.mouse.down()
    page.wait_for_function("a => GH.debug.arsenal.slots[0].ammo < a", arg=ammo)
    page.mouse.up()
    page.keyboard.press("Escape")
    page.wait_for_function("GH.G.state === 'paused'")
    hud = {
        "zh-CN": ("已暂停", "先锋"), "en-US": ("PAUSED", "VANGUARD"),
        "zh-TW": ("已暫停", "先鋒"), "ja-JP": ("一時停止", "ヴァンガード"),
        "ja-JP-x-kyoto": ("一時停止", "ヴァンガード"),
    }
    for lang in labels:
        selector.select_option(lang)
        assert page.evaluate("GH.G.state === 'paused' && GH.debug.arsenal.slots[0].ammo") < ammo
        assert page.locator("#pg-pause h1").text_content() == hud[lang][0]
        assert page.locator("#hpname").text_content() == hud[lang][1]
    assert not errors and not external, (errors, external)
    print("Five locales, menus, credits, narrow screen, persistence and solo input passed.")
    browser.close()
