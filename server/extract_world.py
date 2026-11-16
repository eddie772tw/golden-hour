"""Regenerate world.json from an isolated, running dev client (same setup as check_browser.py)."""
import json, os, sys
from pathlib import Path
base=Path(__file__).resolve().parent
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    exe=os.environ.get("GH_BROWSER")
    b=pw.chromium.launch(channel=None if exe else "msedge",executable_path=exe,args=["--enable-unsafe-swiftshader"])
    p=b.new_page()
    p.goto("http://127.0.0.1:"+os.environ.get("GH_DEV_PORT","48722")+"/?toy=extract",wait_until="domcontentloaded")
    p.locator('[data-act="online"]:visible').first.click(timeout=150000)
    p.locator("#account-open").wait_for()
    data=p.evaluate("""() => {
      const d=GH.debug, specs={};
      for (const id of ["ar","smg","shotgun"]) {
        // Read the native archetypes before the menu's per-profile equipment gate.
        Object.getPrototypeOf(d.arsenal).reset.call(d.arsenal,id);
        for (const {def:w} of d.arsenal.slots) specs[w.id]={id:w.id, interval:60/w.rpm,
          mag:w.mag,reserve:w.reserve,pellets:w.pellets,damage:w.dmg[0],farDamage:w.dmg[1],range:w.range,hip:w.hip[0],ads:w.ads};
      }
      return {version:GHBoot.stats.version,nodes:d.nav.nodes.map(n=>[n.x,n.y,n.z]),
        colliders:d.world.cols.filter(c=>!c.off&&!c.pane).map(c=>({min:[c.x0,c.y0,c.z0],max:[c.x1,c.y1,c.z1],noMove:!!c.noMove,noRay:!!c.noRay})),
        walls:d.hotel.walls.map(({axis,pos,a0,a1,y0,y1,openings})=>({axis,pos,a0,a1,y0,y1,
          openings:openings.map(o=>({a0:o.a0,a1:o.a1,y0:o.y0??y0,y1:o.y1??y1}))})),
        weapons:Object.values(specs)};
    }""")
    assert {w["id"] for w in data["weapons"]}=={"ar","smg","shotgun","pistol"},data["weapons"]
    assert len(data["nodes"])>=10 and data["colliders"]
    target=base/"world.json"
    target.with_suffix(".tmp").write_text(json.dumps(data,separators=(",",":"))+"\n",encoding="utf-8")
    target.with_suffix(".tmp").replace(target)
    print(len(data["colliders"]),"colliders,",len(data["nodes"]),"nodes,",len(data["weapons"]),"weapons")
