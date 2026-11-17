"""Root-operated Edge latencyHint ABBA×2 dry-native S0 necessary-condition screen.

Usage: python run_audio_latency.py --client <portable-client> --name <unique-name>
Optional --out, --client-port 48910, --server-port 48913, --endpoint-note.
Requires existing Playwright via GH_BENCH_DEPS; installs/downloads nothing.
Creates real user-click AudioContexts; no autoplay/fake/mute override, game load
or loopback. Budget FAIL is valid evidence and does not itself imply a tool error.
"""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import urllib.request

HERE = Path(__file__).resolve().parent


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024): h.update(chunk)
    return h.hexdigest()


def source_metadata(client):
    manifest = client.parent / (client.name + "-manifest.json")
    result = {"coreSHA256": digest(client / "game/core/game.js"), "playSHA256": digest(client / "Play.cmd")}
    if manifest.is_file():
        m = json.loads(manifest.read_text(encoding="utf8"))
        for name, expected in m.get("vendor", {}).items():
            path = (client / name).resolve()
            if not path.is_relative_to(client) or digest(path) != expected: raise RuntimeError("Vendor SHA mismatch: " + name)
        if m.get("files", {}).get("game/core/game.js") != result["coreSHA256"]: raise RuntimeError("Portable core manifest mismatch")
        result.update(commit=m.get("commit"), manifestSHA256=digest(manifest), vendor=m.get("vendor", {}), vendorVerified=True)
    else:
        result.update(manifestSHA256=None, vendorVerified=False, vendor={})
        for folder in ("runtime", "node_modules", "licenses"):
            for p in sorted((client / folder).rglob("*")):
                if p.is_file(): result["vendor"][p.relative_to(client).as_posix()] = digest(p)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--out", type=Path, default=Path(os.environ.get("GH_BENCH_OUT", HERE / "evidence")))
    parser.add_argument("--client-port", type=int, default=48910)
    parser.add_argument("--server-port", type=int, default=48913)
    parser.add_argument("--endpoint-note", default="Unchanged OS default endpoint required; operator confirmation not supplied")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}", args.name): parser.error("Use a unique simple name")
    if args.client_port == args.server_port: parser.error("Client/server ports must differ")
    client = args.client.resolve(); out = args.out.resolve(); out.mkdir(parents=True, exist_ok=True)
    output = out / (args.name + ".json"); log_path = out / (args.name + "-server.log")
    if output.exists() or log_path.exists(): raise RuntimeError("Refusing to overwrite evidence")
    for port in (args.client_port, args.server_port):
        with socket.socket() as s: s.bind(("127.0.0.1", port))  # Reject an existing root job; never attach/kill it.
    metadata = source_metadata(client)
    if os.environ.get("GH_BENCH_DEPS"): sys.path.insert(0, os.environ["GH_BENCH_DEPS"])
    from playwright.sync_api import sync_playwright
    data_dir = out / "isolated" / args.name; data_dir.mkdir(parents=True, exist_ok=False)
    env = {k: v for k, v in os.environ.items() if not k.startswith("GH_")}
    env.update(GH_NO_BROWSER="1", GH_NONINTERACTIVE="1", GH_CLIENT_PORT=str(args.client_port),
               GH_SERVER_PORT=str(args.server_port), GH_ROUND_SECONDS="3600", GH_DATA_DIR=str(data_dir),
               GH_CAREER_DB=str(data_dir / "career.sqlite"), LOCALAPPDATA=str(data_dir / "appdata"))
    result = {"schema": "gh-audio-latency-run-v1", "name": args.name, "diagnosticOnly": True,
              "source": metadata, "endpointNote": args.endpoint_note, "ok": False,
              "probeSHA256": digest(HERE / "audio_latency_probe.js"), "runnerSHA256": digest(Path(__file__)),
              "system": platform.platform(), "physicalLatencyAccepted": False, "consoleErrors": [], "responseErrors": []}
    proc = browser = context = None
    log = log_path.open("w", encoding="utf8")
    try:
        proc = subprocess.Popen([os.environ["ComSpec"], "/d", "/c", "Play.cmd", "solo"], cwd=client,
                                env=env, stdout=log, stderr=subprocess.STDOUT)
        origin = "http://127.0.0.1:" + str(args.client_port)
        for _ in range(300):
            try:
                with urllib.request.urlopen(origin + "/api/health", timeout=1) as r:
                    result["health"] = r.read(4096).decode("utf8"); break
            except Exception:
                if proc.poll() is not None: raise RuntimeError("Owned portable server exited")
                time.sleep(.1)
        else: raise RuntimeError("Owned portable server health timeout")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=False,
                args=["--disable-background-networking", "--enable-automation"],
                ignore_default_args=["--mute-audio", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"])
            result["browserVersion"] = browser.version
            cmd = browser.new_browser_cdp_session().send("Browser.getBrowserCommandLine")["arguments"]
            result["browserArguments"] = [x for x in cmd if not x.startswith("--user-data-dir=")]
            if any(x.startswith(("--autoplay-policy", "--use-fake", "--mute-audio", "--disable-audio-output")) for x in cmd):
                raise RuntimeError("Unexpected autoplay/fake/muted audio browser flag")
            context = browser.new_context(viewport={"width": 760, "height": 400}, locale="en-US")
            page = context.new_page()
            page.route('**/favicon.ico', lambda route: route.fulfill(status=204, body=''))
            page.on("pageerror", lambda e: result["consoleErrors"].append(str(e)))
            page.on("console", lambda m: result["consoleErrors"].append(m.text) if m.type == "error" else None)
            page.on("response", lambda r: result["responseErrors"].append({"url":r.url,"status":r.status}) if r.status>=400 else None)
            page.goto(origin + "/api/health", wait_until="domcontentloaded")
            page.set_content('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Native audio latency diagnostic</title>'
                '<h1>Native S0 output-timestamp screen</h1><p>ABBA × 2; fresh 48k contexts; six dry metal/brass cues each.</p>'
                '<button id="probe-arm" disabled>Preparing original source before user gesture</button>')
            page.add_script_tag(path=str(HERE / "audio_latency_probe.js"), type="module")
            page.wait_for_function("typeof __prepareAudioLatencyProbe==='function'")
            result["prepared"] = page.evaluate('''async(expectedSHA256)=>{
              const response=await fetch('/core/game.js',{cache:'no-store'});
              if(!response.ok)throw Error('Original core HTTP '+response.status);
              return __prepareAudioLatencyProbe({source:await response.text(),expectedSHA256});
            }''', metadata["coreSHA256"])
            result["environment"] = page.evaluate("({userAgent:navigator.userAgent,secureContext:isSecureContext,hidden:document.hidden,origin:location.origin,timeOrigin:performance.timeOrigin})")
            assert result["environment"]["secureContext"] and not result["environment"]["hidden"]
            for arm in range(8):
                # Playwright dispatches the normal trusted pointer click; no evaluate(resume).
                page.locator("#probe-arm").click()
                page.wait_for_function("n=>!__audioLatencyProbe.running&&__audioLatencyProbe.arms.length===n", arg=arm + 1, timeout=30000)
                snapshot = page.evaluate("__audioLatencyProbe")
                result["probe"] = snapshot
                output.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf8")
                if snapshot["arms"][-1].get("closedState") != "closed":
                    raise RuntimeError("Previous AudioContext did not close; refusing another arm")
                print("AUDIO-LATENCY-ARM", arm, snapshot["arms"][-1].get("gate"), flush=True)
            result["probe"] = page.evaluate("__audioLatencyProbe")
            p = result["probe"]
            result["latencyGate"] = "fail" if any(a["gate"] == "fail" for a in p["arms"]) else "pass" if all(a["gate"] == "pass" for a in p["arms"]) else "invalid"
            result["ok"] = p["done"] and p.get("comparable", False) and not p["errors"] and not result["consoleErrors"] and not result["responseErrors"] and all(not a["errors"] and a["gate"] != "invalid" for a in p["arms"])
            result["physicalLatencyAccepted"] = False
            context.close(); context = None; browser.close(); browser = None
    except Exception as error:
        result["failure"] = repr(error)
    finally:
        if context:
            try: context.close()
            except Exception: pass
        if browser:
            try: browser.close()
            except Exception: pass
        output.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf8")
        if proc and proc.poll() is None:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
        log.close()
    return 0 if result["ok"] else 2


if __name__ == "__main__": raise SystemExit(main())
