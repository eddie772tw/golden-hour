"""Exercise two local gateways against a dedicated server on GH_LAN_IP (or loopback).
Requires installed dependencies, OpenSSL, and Python Playwright. Uses temporary server data.
"""
import argparse, json, os, re, shutil, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_account import create_account

root=Path(__file__).resolve().parents[1]
ip=os.environ.get("GH_LAN_IP","127.0.0.1")
host="http://127.0.0.1:48861"
guest="http://127.0.0.1:48862"
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--client",type=Path,help="extracted Windows client package")
parser.add_argument("--dedicated",type=Path,help="extracted Windows dedicated server package")
parser.add_argument("--previous",type=Path,help="previous source checkout with installed dependencies")
options=parser.parse_args()
if bool(options.client)!=bool(options.dedicated) or (options.previous and not options.client):
    parser.error("Use --client and --dedicated together when testing packages")
procs=[]
upgraded=False
def start(args,log,env):
    cwd=root
    cmd=["node","server/dedicated/launch.mjs",*args]
    child_env={k:v for k,v in os.environ.items() if not k.startswith("GH_")}
    child_env.update(env)
    if options.previous and not upgraded:
        cwd=options.previous
    elif options.client:
        cwd=options.dedicated if args[0]=="serve" else options.client
        entry="Start-Server.cmd" if args[0]=="serve" else "Play.cmd"
        # Drive the shipped launchers, with no system Node, npm or OpenSSL on PATH.
        child_env.update(PATH=str(Path(os.environ["SystemRoot"])/"System32"),GH_NONINTERACTIVE="1",
                         GH_NO_BROWSER="1",LOCALAPPDATA=str(temp/"user"))
        cmd=[os.environ["ComSpec"],"/d","/c",entry,*args]
    with log.open("ab") as output:
        procs.append(subprocess.Popen(cmd,cwd=cwd,env=child_env,stdout=output,stderr=subprocess.STDOUT))
def stop():
    for proc in reversed(procs):
        if proc.poll() is None:
            if options.client:
                subprocess.run(["taskkill","/F","/T","/PID",str(proc.pid)],capture_output=True,check=True)
            else:proc.terminate()
        proc.wait(timeout=10)
    procs.clear()
def ready(url,log):
    for _ in range(100):
        try:
            with urllib.request.urlopen(url+"/api/health",timeout=2) as r:
                if r.status==200:return
        except OSError:time.sleep(.1)
    raise RuntimeError(log.read_text(errors="replace"))
with tempfile.TemporaryDirectory() as tmp, sync_playwright() as pw:
    temp=Path(tmp);log=temp/"server.log"
    env={"GH_SERVER_PORT":"48863","GH_CLIENT_PORT":"48861","GH_ROUND_SECONDS":"25","GH_DATA_DIR":str(temp/"legacy"/"dedicated")}
    if options.client and not options.previous:env.pop("GH_DATA_DIR")
    try:
        if options.client and not options.previous:
            start(["serve",ip],log,env)
            for _ in range(100):
                if re.search(r"gh1://[^\s]+",log.read_text(encoding="utf8",errors="replace")):break
                time.sleep(.1)
            invite=re.search(r"gh1://[^\s]+",log.read_text(encoding="utf8",errors="replace"))
            if not invite:raise RuntimeError(log.read_text(encoding="utf8",errors="replace"))
            start(["join",invite.group()],log,{"GH_CLIENT_PORT":"48861"})
        else:start(["host",ip],log,env)
        ready(host,log)
        invitation=re.search(r"gh1://[^\s]+",log.read_text(encoding="utf8",errors="replace")).group()
        start(["join",invitation],log,{"GH_CLIENT_PORT":"48862"});ready(guest,log)
        bad=invitation[:-1]+("a" if invitation[-1]!="a" else "b")
        start(["join",bad],log,{"GH_CLIENT_PORT":"48864"})

        for _ in range(50):
            try:
                urllib.request.urlopen("http://127.0.0.1:48864/api/health",timeout=2)
            except urllib.error.HTTPError as err:
                assert err.code==502
                break
            except OSError:
                time.sleep(.1)
            else:raise AssertionError("Accepted a changed host certificate")
        else:raise AssertionError("Pin test gateway did not start")
        try:
            urllib.request.urlopen(urllib.request.Request(host+"/api/rtc",data=b"{}",headers={"Origin":host,"Content-Type":"application/json"}))
        except urllib.error.HTTPError as err:
            assert err.code==401
        else:raise AssertionError("RTC accepted an unauthenticated offer")
        # A gateway replaced between challenge and proof must not forward the proof body.
        try:
            urllib.request.urlopen(urllib.request.Request(host+"/api/auth/prove",data=b"{}",headers={
                "Origin":host,"Content-Type":"application/json","X-GH-Host-Pin":bad.rsplit("/",1)[1]}))
        except urllib.error.HTTPError as err:
            assert err.code==409
        else:raise AssertionError("Gateway accepted a proof for another invitation")
        exe=os.getenv("GH_BROWSER")
        browser=pw.chromium.launch(channel=None if exe else "msedge",executable_path=exe,
            args=["--enable-unsafe-swiftshader","--disable-background-networking"])
        errors=[]
        def client(url):
            ctx=browser.new_context(service_workers="block",locale="en-US")
            ctx.route("**/*",lambda route: route.continue_() if route.request.url.startswith((url+"/","data:","blob:")) else (errors.append(route.request.url),route.abort())[1])
            page=ctx.new_page();page.on("pageerror",lambda error:errors.append(str(error)))
            page.goto(url,wait_until="domcontentloaded")
            return page
        a=client(host);b=client(guest)
        create_account(a,"Host");create_account(b,"Guest")
        # Capture the guest's normal connection to send deterministic firing input on the wire.
        b.evaluate("""async()=>{const {Connection}=await import('/client/net.js');const original=Connection.prototype.connect;
            Connection.prototype.connect=function(...args){window.fixtureNet=this;
            this.addEventListener('snapshot',e=>window.fixtureSnapshot=e.detail);
            return original.apply(this,args);};}""")
        a.locator("#online-create").click()
        a.wait_for_function("GH.debug.network?.snapshots>2")
        code=a.locator("#room-invite").input_value()
        assert code.startswith(invitation+"/"),code
        b.locator("#join-room-code").fill(code.rsplit("/",1)[1])
        b.locator("#join-room-code + button").click()
        try:
            b.wait_for_function("window.fixtureSnapshot?.players?.length>1",timeout=20000)
        except Exception:
            print("Guest", b.evaluate("[document.querySelector('#join-room-code').value,document.querySelector('#online-error').textContent,document.querySelector('#online-status').textContent,GH.debug.network,window.fixtureNet?.id]"), errors, flush=True)
            raise
        ice=b.wait_for_function("""async()=>{const stats=await fixtureNet.transport.pc.getStats();
          const transport=[...stats.values()].find(r=>r.type==='transport' && r.selectedCandidatePairId);
          const pair=stats.get(transport?.selectedCandidatePairId) ??
            [...stats.values()].find(r=>r.type==='candidate-pair' && r.state==='succeeded' && r.nominated);
          const remote=stats.get(pair?.remoteCandidateId);
          return remote?.address && [remote.address,remote.protocol];}""",timeout=10000).json_value()
        assert ice and ice[0]==ip and ice[1]=="udp",ice
        b.evaluate("""async()=>{let me,enemy;
          for(let i=0;i<10;i++){
            me=fixtureSnapshot.players.find(p=>p.id===fixtureNet.id);
            enemy=fixtureSnapshot.players.find(p=>p.id===1);
            if(me.kills) return;
            if(enemy) await fixtureNet.send({type:'shot',yaw:Math.atan2(me.x-enemy.x,me.z-enemy.z),pitch:0});
            await new Promise(r=>setTimeout(r,190));
          }
          if(!fixtureSnapshot.players.find(p=>p.id===fixtureNet.id).kills)throw Error("No verified human elimination");
        }""")
        for page in [a,b]:
            page.wait_for_function("GH.G.state==='over'",timeout=55000)
            page.evaluate("GH.debug.ctx.hud.menus._act('online-leave')")
            page.wait_for_function("!document.body.classList.contains('online-session')")
        b.locator('[data-act="online"]:visible').first.click()
        b.locator("#account-open").click();uid=b.locator("#account-id").text_content()
        with b.expect_download() as download:b.locator("#account-export").click()
        save=temp/"transfer.ghsave";download.value.save_as(save)
        assert uid not in save.read_text() and "Guest" not in save.read_text()
        a.context.close();b.close();guest_context=b.context
        stop()
        upgraded=True
        if options.dedicated:
            # First source-to-portable upgrade follows the documented stopped-server copy.
            # Portable-to-portable restart uses the existing version-independent data directory.
            if options.previous:
                shutil.copytree(env["GH_DATA_DIR"],temp/"user"/"Golden Hour"/"dedicated")
            env.pop("GH_DATA_DIR",None)
            start(["serve",ip],log,env)
            start(["join",invitation],log,{"GH_CLIENT_PORT":"48861"})
            start(["join",invitation],log,{"GH_CLIENT_PORT":"48862"})
            ready(guest,log)
        else:
            start(["host",ip],log,env)
            start(["join",invitation],log,{"GH_CLIENT_PORT":"48862"})
        ready(host,log)
        # Reopen at the same origin and unlock the existing IndexedDB account without import.
        reopened=guest_context.new_page()
        reopened.goto(guest+"/api/health")
        same=reopened.evaluate("""async()=>{const {Vault}=await import('/client/account-vault.js');
          const v=new Vault();await v.init();await v.unlock('test portable passphrase');await v.authenticate();
          return [v.account.id,v.account.receipts[0].record,(await v.read('/api/receipt')).record,(await v.read('/api/ranks')).mine.score];
        }""")
        assert same[0]==uid and same[1]==same[2] and same[1][3]==1 and same[3]>=1,same
        guest_context.close()
        fresh=client(host);fresh.locator('[data-act="online"]:visible').first.click(timeout=180000)
        fresh.locator("#account-open").click();fresh.locator("#account-pass").fill("test portable passphrase")
        fresh.once("dialog",lambda dialog:dialog.accept())
        fresh.locator("#account-file").set_input_files(save)
        fresh.locator("#account-dialog").wait_for(state="hidden",timeout=30000)
        result=fresh.evaluate("""async(text)=>{const {unlockSave}=await import('/client/local-account.js');
          const {account}=await unlockSave(text,'test portable passphrase');
          const {Vault}=await import('/client/account-vault.js');const v=new Vault();
          await v.init();await v.unlock('test portable passphrase');await v.authenticate();
          return {id:v.account.id,record:account.receipts[0].record,rank:(await v.read('/api/ranks')).mine,
              restored:(await v.read('/api/receipt')).record};
        }""",save.read_text())
        assert result["id"]==uid and result["record"]==result["restored"],result
        assert result["record"][3]==1 and dict(result["record"][4])["ar"]>=1 and result["rank"]["score"]>=1,result
        assert result["record"][5][0]==1 and result["record"][5][3]>=100,result
        fresh.reload(wait_until="domcontentloaded")
        fresh.locator('[data-act="online"]:visible').first.click(timeout=180000)
        fresh.locator("#online-create").click()
        fresh.locator("#account-pass").fill("wrong")
        fresh.locator("#account-unlock").click()
        fresh.wait_for_function("document.querySelector('#account-dialog output').textContent.length>0")
        assert fresh.locator("#account-dialog").is_visible() and fresh.evaluate("!GH.debug.network.snapshots")
        fresh.locator("#account-pass").fill("test portable passphrase")
        fresh.locator("#account-unlock").click()
        fresh.locator("#account-dialog").wait_for(state="hidden",timeout=30000)
        assert not errors,errors
        print("LAN match, invite, verified kill, signed result, encrypted export/import and restart passed on",ip,flush=True)
        browser.close()
    finally:stop()
