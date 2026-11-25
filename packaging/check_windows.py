"""Exercise the extracted Windows packages. Requires Python Playwright and Edge."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit
import zipfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def await_text(log, text, proc):
    for _ in range(180):
        content = log.read_text(encoding="utf8", errors="replace")
        if text in content:
            return
        if proc.poll() is not None:
            break
        time.sleep(.1)
    raise RuntimeError(f"Missing {text!r} in {content}")


@contextmanager
def menu(folder, temp, port):
    log = temp/f"{port}.log"
    clean = {k:v for k,v in os.environ.items() if not k.startswith("GH_")}
    env = dict(clean, LOCALAPPDATA=str(temp/"user"), GH_CLIENT_PORT=str(port),
               GH_SERVER_PORT="48855", GH_NO_BROWSER="1", GH_NONINTERACTIVE="1",
               PATH=str(Path(os.environ["SystemRoot"])/"System32"))
    with log.open("wb") as output:
        proc = subprocess.Popen([os.environ["ComSpec"],"/d","/c","Play.cmd"], cwd=folder,
                                env=env, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT)
        def choose(prompt, value):
            await_text(log, prompt, proc)
            proc.stdin.write((value+"\n").encode())
            proc.stdin.flush()
        try:
            yield choose, log, proc
        finally:
            if proc.poll() is None:
                subprocess.run(["taskkill","/T","/F","/PID",str(proc.pid)],capture_output=True,check=True)
            proc.wait(timeout=10)
            proc.stdin.close()


def deploy_solo(page):
    page.wait_for_function("window.GH?.ready && GH.debug", timeout=180000)
    page.evaluate("async()=>{await GHBoot.runtimeReady;await GH.debug.gfx.whenReady();}")
    page.bring_to_front()
    # The first gesture can prepare sounds/equipment. The game then explicitly
    # asks for another Deploy gesture; do not bypass its preparation/input gate.
    page.locator('#pg-main [data-act="deploy"]').click(timeout=60000)
    deploy = page.locator("#training-deploy")
    for _ in range(3):
        deploy.click(timeout=60000)
        page.evaluate("""async()=>{const g=GH.debug.gfx;
          if(g._deploying)await g._deploying;await g.whenReady();}""")
        status=page.evaluate("""({state:GH.G.state,
          error:String(GH.debug.gfx.preparation.error||GHBoot.stats.preparationError||''),
          message:document.getElementById('err')?.textContent})""")
        if status['error'] or status['message']:
            raise RuntimeError(f"Solo preparation failed: {status}")
        if status['state']=='playing':
            return
        if status['state']!='menu':
            raise RuntimeError(f"Unexpected state after Deploy: {status}")
    raise RuntimeError(f"Solo did not enter play after preparation: {status}")


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output",type=Path)
    parser.add_argument("--previous",type=Path,help="exercise upgrade from this runnable source checkout")
    args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="Golden Hour ZIP ") as tmp:
        temp=Path(tmp)
        for line in (args.output/"SHA256SUMS.txt").read_text().splitlines():
            sha,name=line.split("  ")
            archive=args.output/name
            with archive.open("rb") as f:
                assert hashlib.file_digest(f,"sha256").hexdigest()==sha,name
            with zipfile.ZipFile(archive) as z:z.extractall(temp)
        client=temp/"Golden-Hour-Client-Windows-x64"
        server=temp/"Golden-Hour-Dedicated-Server-Windows-x64"
        assert (server/"Start-Server.cmd").is_file() and not (server/"game/index.html").exists()
        with menu(client,temp,48851) as (choose, log, proc):
            choose("> ", "1")
            url="http://127.0.0.1:48851/?solo"
            await_text(log,url,proc)
            with sync_playwright() as pw:
                exe=os.getenv("GH_BROWSER")
                browser=pw.chromium.launch(channel=None if exe else "msedge",executable_path=exe,
                                           args=["--enable-unsafe-swiftshader","--disable-background-networking"])
                page=browser.new_page()
                page.goto(url)
                deploy_solo(page)
                browser.close()
        selection=os.environ.get("GH_LAN_IP","1")
        with menu(client,temp,48851) as (choose,log,proc):
            choose("> ","2")
            # On hosts with one LAN interface it is selected automatically.
            for _ in range(180):
                status=log.read_text(encoding="utf8",errors="replace")
                if "IPv4 or number:" in status:
                    choose("IPv4 or number:",selection)
                    break
                if "Invite: gh1://" in status:break
                time.sleep(.1)
            await_text(log,"/?pvp",proc)
            invitation=json.load(urllib.request.urlopen("http://127.0.0.1:48851/api/invite"))["invite"]
            with menu(client,temp,48852) as (choose,log,proc):
                choose("> ","3")
                choose("Full gh1:// invitation:",invitation)
                await_text(log,"/?pvp",proc)
                assert urllib.request.urlopen("http://127.0.0.1:48852/api/health").status==200
        cmd=[sys.executable,str(ROOT/"server/check_lan.py"),"--client",str(client),"--dedicated",str(server)]
        if args.previous:cmd.extend(["--previous",str(args.previous.resolve())])
        subprocess.run(cmd,check=True,env=dict(os.environ,GH_LAN_IP=urlsplit(invitation).hostname))
        print("Both ZIPs, all three interactive menu options and account continuity passed.")


if __name__=="__main__":
    main()
