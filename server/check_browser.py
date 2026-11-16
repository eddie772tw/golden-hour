"""Run against npm start. Requires Playwright Python and Edge (or GH_BROWSER executable)."""
import os, sys
from browser_account import create_account
from pathlib import Path
from urllib.parse import urlsplit
base = Path(__file__).resolve().parent
from playwright.sync_api import sync_playwright
origin = "http://127.0.0.1:" + os.environ.get("GH_DEV_PORT","48722")

with sync_playwright() as pw:
    exe = os.environ.get("GH_BROWSER")
    browser = pw.chromium.launch(channel=None if exe else "msedge", executable_path=exe,
        args=["--enable-unsafe-swiftshader","--disable-background-networking"])
    ctx = browser.new_context(locale="zh-CN", viewport={"width":900,"height":600}, service_workers="block")
    errors, external = [], []
    def guard(route):
        url=route.request.url
        if url.startswith((origin+"/","blob:","data:")): route.continue_()
        else: external.append(urlsplit(url).netloc); route.abort()
    ctx.route("**/*",guard)
    page=ctx.new_page()
    page.on("pageerror",lambda error: errors.append(str(error)))
    page.goto(origin+"/?toy=host", wait_until="domcontentloaded")
    create_account(page,"DEV host")
    page.evaluate("GH.debug.ctx.hud.menus.go('main')")
    page.locator('[data-act="toy-ranks"]:visible').first.click(timeout=150000)
    page.wait_for_function("document.querySelector('#toy-my-rank').textContent.includes('尚未上榜')")
    page.locator('[data-act="toy-back"]:visible').click()
    page.evaluate("""() => {
      const menus=GH.debug.ctx.hud.menus;
      menus.go('gunsmith'); menus.gs.w='smg'; menus._gsRender(false); menus._gsEquip();
    }""")
    page.wait_for_function("document.querySelector('[data-unlock-checks]').textContent.includes('0/10')")
    page.evaluate("GH.debug.ctx.hud.menus.go('main')")
    page.locator('[data-act="online"]:visible').first.click(timeout=150000)
    page.wait_for_function("document.querySelector('#online-directory-status').textContent.includes('暂无')")
    page.locator("#online-create").click()
    try:
        page.wait_for_function("GH.debug.network?.snapshots>2 && GH.debug.match.actors.length>=5",timeout=25000)
    except Exception:
        print(page.locator("#online-error").text_content(),page.locator("#online-status").text_content(),errors,flush=True)
        raise
    print("UI: created WebRTC match with",page.evaluate("GH.debug.match.actors.length"),"actors", flush=True)
    ctx2=browser.new_context(locale="en-US", service_workers="block")
    ctx2.route("**/*",guard)
    guest=ctx2.new_page()
    guest.on("pageerror",lambda error: errors.append(str(error)))
    guest.goto(origin+"/api/health")
    result=guest.evaluate("""async () => {
      const {RoomDirectory,joinHello}=await import('/client/lobby.js');
      const {Connection}=await import('/client/net.js');
      const {Vault}=await import('/client/account-vault.js');
      const {createAccount}=await import('/client/local-account.js');
      const vault=new Vault();vault.account=await createAccount("Guest");
      const {loadApiConfig}=await import('/client/api-config.js');
      const until=async fn=>{const end=performance.now()+20000; while(!fn()){if(performance.now()>end)throw Error('condition timed out: '+fn); await new Promise(r=>setTimeout(r,30));}};
      let rooms, roster, snapshot, pong=false, welcomes=0;
      const dir=new RoomDirectory({pageURL:location.href,onChange:e=>{rooms=e.rooms;}});
      dir.setActive(true); await until(()=>rooms?.length===1 && rooms[0].hostName==='DEV host');
      const n=new Connection(), config=await loadApiConfig(undefined, location.href);
      n.addEventListener('event',({detail:e})=>{if(e.type==='room')roster=e;if(e.type==='pong')pong=e.nonce===123;if(e.type==='welcome')welcomes++;});
      n.addEventListener('snapshot',({detail:s})=>snapshot=s);
      n.issueTicket=()=>vault.authenticate();
      await n.connect(joinHello('listed','Guest',rooms[0].room),config);
      const headers={Authorization:'Bearer '+vault.session};
      await n.send({type:'equip',weapon:'shotgun',unlocked:true});
      await until(()=>rooms[0].humans===2 && roster?.players.filter(p=>!p.bot).length===2 && snapshot);
      await n.send({type:'ping',nonce:123}); await until(()=>pong);
      const me=()=>snapshot.players.find(p=>p.id===n.id), start=me().z;
      await n.input({seq:12,forward:1,yaw:0}); await until(()=>me().ack===12 && Math.abs(me().z-start)>0.01);
      await n.send({type:'shot',yaw:1,pitch:0}); await until(()=>me().ammo===29);
      await n.send({type:'reload'}); await until(()=>me().ammo===30 && me().reserve===149);
      const read=async path=>(await fetch(path,{headers})).json();
      if((await fetch('/api/ranks',{method:'POST',headers,body:'{"score":999}'})).status!==405)
        throw Error('rank write accepted');
      const hostID=roster.players.find(p=>p.name==='DEV host').id;
      for(let shot=0;shot<4;shot++){
        const target=snapshot.players.find(p=>p.id===hostID), self=me();
        await n.send({type:'shot',yaw:Math.atan2(self.x-target.x,self.z-target.z),pitch:0});
        await until(()=>me().ammo===29-shot && me().cooldown===0);
      }
      await until(()=>me().kills===1);
      if((await read('/api/career')).kills.ar!==1 || (await read('/api/ranks')).mine.score!==1)
        throw Error('verified kill missing from career or leaderboard');
      const id=n.id; n.transport.close(); await until(()=>welcomes===2 && n.writer && n.id===id && me().ack===12);
      if((await read('/api/ranks')).mine.score!==1)throw Error('resume duplicated score');
      await n.leave(); await until(()=>rooms[0].humans===1); dir.setActive(false);
      return {id,welcomes,pong};
    }""")
    page.wait_for_function("document.querySelector('#online-members').textContent.includes('1 真人')")
    guest.goto(origin+"/?toy=guest",wait_until="domcontentloaded")
    guest.locator('[data-act="online"]:visible').first.wait_for(timeout=150000)
    guest.evaluate("GH.debug.ctx.hud.menus.go('gunsmith')")
    guest.locator('#gs-tabs [data-w="pistol"]').click()
    guest.locator("#weapon-model").select_option("gbull")
    guest.evaluate("GH.debug.ctx.hud.menus.go('main')")
    guest.locator('[data-act="online"]:visible').first.click(timeout=150000)
    guest.evaluate("GH.debug.ctx.hud.menus.go('main')")
    create_account(guest,"DEV guest")
    guest.locator("#online-quick").click()
    guest.wait_for_function("GH.debug.network?.snapshots>2 && GH.debug.match.actors.some(p=>p.name==='DEV host')")
    page.wait_for_function("GH.debug.match.actors.some(p=>p.name==='DEV guest')")
    guest.evaluate("GH.debug.arsenal.swap(1)")
    guest.wait_for_function("GH.debug.ctx.vm.gun.root.getObjectByName('gbull') && GH.debug.arsenal.slot.ammo===20")
    page.wait_for_function("GH.debug.ctx.botCtx.scene.getObjectByName('gbull_world_lod')")
    # Exercise the running renderer with a hide/reveal transition. The server's wall
    # selection is tested separately on the serialized packets in test.mjs.
    page.evaluate("""async () => {
      const {Engine}=await import('/client/engine.js'), original=Engine.prototype.snapshot;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{Engine.prototype.snapshot=original;reject(Error('snapshot timeout'));},5000);
        Engine.prototype.snapshot=function(s) {
          Engine.prototype.snapshot=original;clearTimeout(timer);
          try {
            const guest=[...this.remotes.values()].find(r=>r.actor.name==='DEV guest');
            if(!guest)throw Error('missing visible guest');
            const id=guest.actor.id;
            original.call(this,{...s,players:s.players.filter(p=>p.id!==id)});
            if(this.remotes.has(id)||guest.rig.root.parent||this.ctx.match.actors.some(a=>a.id===id)||
               this.snapshots.some(s=>s.players.some(p=>p.id===id)))throw Error('hidden rig or stale position');
            const table=document.createElement('div'); this.ctx.hud.board(this.ctx.match,table,true);
            if(!table.textContent.includes('DEV guest'))throw Error('scoreboard lost hidden player');
            original.call(this,s);
            if(!this.remotes.has(id)||!this.ctx.match.actors.some(a=>a.id===id))throw Error('reveal failed');
            resolve();
          } catch(e){reject(e);}
        };
      });
    }""")
    # Switch only the guest while both clients are receiving the same live match.
    before = guest.evaluate("GH.debug.network.snapshots")
    guest.evaluate("GH.debug.ctx.hud.menus.show('pause')")
    guest.locator("[data-locale]").select_option("ja-JP-x-kyoto")
    guest.wait_for_function("n => GH.debug.network.snapshots > n", arg=before)
    assert guest.locator("#online-name").text_content() == "DEV guest"
    assert guest.locator("#online-members").text_content() == "人間2人／ボット8体"
    assert page.locator("html").get_attribute("lang") == "zh-CN"
    assert "2 真人" in page.locator("#online-members").text_content()
    guest.evaluate("GH.debug.ctx.hud.menus._act('online-leave')")
    guest.wait_for_function("!document.body.classList.contains('online-session')")
    page.evaluate("GH.debug.ctx.hud.menus._act('online-leave')")
    page.wait_for_function("!document.body.classList.contains('online-session')")
    assert not external and not errors,(external,errors)
    print("Second client:",result,"; movement ACK, ammo/reload, resume, two rendered players, leave; page errors/external HTTP: 0")
    browser.close()
