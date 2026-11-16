"""Run against a local server like check_languages.py. Exercises the native view and world rigs."""
import os
from browser_account import create_account
from pathlib import Path
from playwright.sync_api import sync_playwright

origin = "http://127.0.0.1:" + os.getenv("GH_DEV_PORT", "48722")
guns = [("pistol", "gbull", "G-Bull", 20), ("smg", "chingi", "Chin-Gi", 30),
        ("shotgun", "linbei", "Lin-Bei", 6)]
with sync_playwright() as pw:
    exe = os.getenv("GH_BROWSER")
    browser = pw.chromium.launch(channel=None if exe else "msedge", executable_path=exe,
                                 args=["--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    # Offline range fixture for a player who already earned both primary families.
    page.route("**/api/career", lambda route: route.fulfill(json={
        "kills": {"ar": 10, "smg": 10}, "unlocked": ["ar","pistol","smg","shotgun"], "rules": {}}))
    page.goto(origin, wait_until="domcontentloaded")
    page.locator('#pg-main [data-act="deploy"]').wait_for(timeout=180000)
    create_account(page,"Range")
    page.evaluate("GH.debug.ctx.hud.menus.go('gunsmith')")
    for family, model, name, _ in guns:
        page.locator('#gs-tabs [data-w="'+family+'"]').click()
        page.locator("#weapon-model").select_option(model)
        title = page.locator("#gs-wname").text_content()
        assert title == name, (model, title, errors)
        assert page.evaluate("""([family,model])=>{
            const s=GH.debug.ctx.hud.menus.studio;
            return !!s.ensure(family).root.getObjectByName(model);
        }""", [family, model])
    page.evaluate("GH.debug.ctx.hud.menus.go('main')")
    page.locator('#pg-main [data-act="deploy"]').click()
    page.wait_for_function("GH.debug.match.live && GH.debug.match.time < 479.9", timeout=90000)
    # Exercise every native family on the firing range without writing competitive progress.
    for family, model, name, rounds in guns:
        page.evaluate("family => GH.debug.arsenal.reset(family)", family)
        page.wait_for_function("GH.debug.arsenal.state === 'ready'", timeout=60000)
        detail = page.evaluate("""([family,model])=>{
            const ctx=GH.debug.ctx, gun=ctx.vm.gun;
            const body=gun.root.getObjectByName(model);
            const world=ctx.botCtx.worldGun(family,null,model).root.getObjectByName(model+'_world_lod');
            const factory=ctx.botCtx.worldGun(family);
            const tris=g=>g.children.reduce((n,c)=>n+c.geometry.index.count/3,0);
            const nativeHand=hand=>{let n=0;hand.traverse(o=>{if(o.isMesh)n++});return hand.visible && n>0};
            if (model!=='gbull') {
                const reflex=ctx.vm.ctx.buildGun(family,{build:{...gun.build,optic:"reflex"}});
                const ironParts=body.children.filter(p=>p.userData.removableIrons);
                const stowed=reflex.root.getObjectByName(model).children.filter(p=>p.userData.removableIrons);
                if (!ironParts.length || !ironParts.every(p=>p.visible) ||
                    stowed.length!==ironParts.length || stowed.some(p=>p.visible)) throw Error("optic obstructed: "+model);
            }
            const {sight,frontSight}=gun.anchors;
            const aligned=model==='gbull' || (frontSight && frontSight.z<sight.z &&
                Math.hypot(frontSight.x-sight.x,frontSight.y-sight.y)<.00001);
            return { model:ctx.arsenal.def.profileId, aligned:!!aligned, view:tris(body), world:tris(world),
                ammo:ctx.arsenal.slot.ammo, hands:[gun.hands.right,gun.hands.left].every(nativeHand),
                factoryUnaffected:!factory.root.getObjectByName(model+'_world_lod') };
        }""", [family, model])
        assert detail["model"] == model and detail["ammo"] == rounds, detail
        assert detail["aligned"] and detail["hands"] and detail["factoryUnaffected"], detail
        assert 0 < detail["world"] < detail["view"], detail
        out = os.getenv("GH_WEAPON_CAPTURES")
        def capture(pose):
            if out:
                page.screenshot(path=str(Path(out) / (model + "-" + pose + ".png")))
        capture("idle")
        page.mouse.down(button="right")
        page.wait_for_function("GH.debug.arsenal.ads > .9")
        capture("ads")
        page.mouse.up(button="right")
        page.mouse.down()
        page.wait_for_function("n=>GH.debug.arsenal.slot.ammo<n", arg=rounds, timeout=20000)
        page.mouse.up()
        page.wait_for_function("GH.debug.arsenal.state === 'ready' && GH.debug.arsenal.pumpWait<=0 && GH.debug.arsenal.cool<=0")
        before = page.evaluate("GH.debug.ctx.vm.gun.hands.left.matrixWorld.toArray()")
        page.keyboard.press("r")
        page.wait_for_function("""before => {
            const a=GH.debug.arsenal,h=GH.debug.ctx.vm.gun.hands.left;
            return a.state.startsWith('reload') && a.clipT>.06 && h.visible &&
                h.matrixWorld.toArray().some((v,i)=>Math.abs(v-before[i])>.002);
        }""", arg=before)
        capture("reload")
        page.wait_for_function("n=>GH.debug.arsenal.slot.ammo===n", arg=rounds, timeout=60000)
        print(name, detail, flush=True)
    # Measure the centre fifth of the screen on each axis in the native ADS camera.
    # Fix the resting pose so recoil, breathing, scenery and HUD do not affect the count.
    for family, model in [("smg","chingi"), ("shotgun","linbei")]:
        coverage = page.evaluate("""([family,model])=>{
            const {vm,gfx}=GH.debug.ctx, renderer=gfx.renderer;
            vm.show(family);
            const gun=vm.gun;
            gun.resetPose();
            gun.arms.reset(); gun.arms.flush(null); gun.arms.snap();
            vm.rig.visible=true;
            for (const node of [vm.rig,vm.pose,vm.clip]) {
                node.position.set(0,0,0);
                node.quaternion.identity();
            }
            vm.pose.position.copy(gun.anchors.sight).multiplyScalar(-1);
            vm.pose.position.z-=gun.adsDist;
            vm.setFov(1);
            const gl=renderer.getContext(), w=gl.drawingBufferWidth, h=gl.drawingBufferHeight;
            const cw=Math.floor(w/5), ch=Math.floor(h/5);
            vm.cam.aspect=w/h; vm.cam.updateProjectionMatrix();
            const solid=gun.root.getObjectByName(model).children[0].material.clone();
            solid.map=solid.normalMap=null; solid.emissive.set(0xffffff); solid.toneMapped=false;
            const original=vm.scene.overrideMaterial;
            try {
                vm.scene.overrideMaterial=solid;
                renderer.setRenderTarget(null); renderer.setClearColor(0);
                renderer.clear(); renderer.render(vm.scene,vm.cam);
                const pixels=new Uint8Array(cw*ch*4);
                gl.readPixels((w-cw)>>1,(h-ch)>>1,cw,ch,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
                let covered=0;
                for(let i=0;i<pixels.length;i+=4) if(pixels[i]>128) covered++;
                return covered/(cw*ch);
            } finally {
                vm.scene.overrideMaterial=original;
                solid.dispose();
            }
        }""", [family,model])
        assert 0.03 < coverage < 0.20, (model, coverage)
        print(model, "centre ADS coverage", format(coverage, ".1%"), flush=True)
    assert not errors, errors
    browser.close()
