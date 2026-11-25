"""Exercise the imported solo maps in Edge on an isolated loopback origin."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from threading import Event, Thread

from playwright.sync_api import sync_playwright


GAME = Path(__file__).resolve().parents[1] / "game"
held, release = Event(), Event()
cancel_scene = True


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == "/api/invite":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"{}")
            return
        if cancel_scene and self.path.endswith("/shipment/3/scene.glb"):
            held.set()
            release.wait(25)
        try:
            super().do_GET()
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass


def run(origin):
    external, errors, accounts, console_errors = [], [], [], []
    with sync_playwright() as playwright:
        exe = os.environ.get("GH_BROWSER")
        browser = playwright.chromium.launch(channel=None if exe else "msedge", executable_path=exe,
            args=["--enable-unsafe-swiftshader", "--disable-background-networking"])
        context = browser.new_context(locale="en-US", viewport={"width": 960, "height": 620},
            service_workers="block")
        context.add_init_script("""
            localStorage.setItem("golden-hour.language", "en-US");
        """)

        def guard(route):
            url = route.request.url
            if url.startswith((origin + "/", "data:", "blob:")):
                if url.startswith((origin + "/api/account", origin + "/api/ticket")):
                    accounts.append(url)
                route.continue_()
            else:
                external.append(url)
                route.abort()

        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.goto(origin + "/?solo", wait_until="domcontentloaded")
        start = page.locator('#pg-main [data-act="deploy"]')
        start.wait_for(timeout=180000)
        page.evaluate("""
            () => {
                const d = GH.debug;
                window.hotel = { cols: d.world.cols, nodes: d.nav.nodes, panes: d.glass.panes,
                    props: d.physics.props.length, roots: d.mapRuntime.hotelRoots };
                window.authoredSpawns = new Map();
                const respawn = d.match.respawn;
                d.match.respawn = function(actor, ...args) {
                    const result = respawn.call(this, actor, ...args);
                    // Capture the native spawn before countdown physics adjusts the height.
                    if (d.mapRuntime.active) authoredSpawns.set(actor, {
                        map: d.mapRuntime.active.ref.id, side: actor.team, position: actor.pos.clone()
                    });
                    return result;
                };
                window.trackMap = () => {
                    const active = d.mapRuntime.active, root = active.scene.root, objects = new Set();
                    const images = new Set(), geometries = new Set(), materials = new Set(), textures = new Set();
                    root.traverse(object => {
                        if (object.geometry) geometries.add(object.geometry);
                        for (const material of [].concat(object.material ?? [])) {
                            materials.add(material);
                            for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
                        }
                    });
                    for (const texture of textures) if (texture.image?.close) images.add(texture.image);
                    for (const object of [...geometries, ...materials, ...textures]) objects.add(object);
                    let disposed = 0, closed = 0;
                    for (const object of objects) object.addEventListener("dispose", () => disposed++);
                    for (const image of images) {
                        const close = image.close.bind(image);
                        image.close = () => { closed++; close(); };
                    }
                    window.mapCheck = () => ({ detached: root.parent === null, disposed, closed,
                        expected: objects.size, expectedImages: images.size });
                    return { geometries: geometries.size, materials: materials.size, textures: textures.size,
                        images: images.size, attached: root.parent === d.gfx.scene };
                };
            }
        """)
        print("Edge", browser.version, "native hotel ready", flush=True)

        def picker():
            start.click(timeout=30000)
            page.locator('[data-training-map="shipment"]').wait_for()
            assert page.locator("#training-maps button").count() == 3

        def deploy():
            button = page.locator("#training-deploy")
            for _ in range(3):
                button.click(timeout=60000)
                page.evaluate("async () => { const gfx=GH.debug.gfx; await gfx._deploying; await gfx.whenReady(); }")
                if page.evaluate("GH.G.state === 'playing'"):
                    break
            page.wait_for_function("GH.G.state === 'playing' && GH.debug.match.state === 'countdown'", timeout=30000)

        def hotel_restored():
            return page.evaluate("""() => {
                const d = GH.debug;
                return !d.mapRuntime.active && d.world.cols === hotel.cols && d.nav.nodes === hotel.nodes &&
                    d.glass.panes === hotel.panes && d.physics.props.length === hotel.props &&
                    hotel.roots.every(root => root.parent === d.gfx.scene) &&
                    document.querySelector("#mm-map").childElementCount === 3;
            }""")

        picker()
        page.locator('[data-training-map="shipment"]').click()
        for _ in range(120):
            if held.is_set():
                break
            page.wait_for_timeout(100)
        assert held.is_set(), "Scene request was not held by loopback"
        assert page.locator("#training-deploy").is_disabled()
        with page.expect_event("requestfailed", lambda request: request.url.endswith("/shipment/3/scene.glb")):
            page.locator("#training-back").click()
        start.wait_for()
        assert hotel_restored()
        global cancel_scene
        cancel_scene = False
        release.set()
        print("Cancelled held map fetch and returned to native hotel", flush=True)

        for map_id, nodes, colliders in [("shipment", 2819, 137), ("sublevel-07", 751, 89)]:
            picker()
            page.locator(f'[data-training-map="{map_id}"]').click()
            page.wait_for_function("""() => {
                const status = document.querySelector("#training-status");
                return status.title || !document.querySelector("#training-deploy").disabled;
            }""", timeout=70000)
            assert not page.locator("#training-status").get_attribute("title"), page.locator("#training-status").get_attribute("title")
            deploy()
            data = page.evaluate("""() => {
                const d = GH.debug, a = d.mapRuntime.active;
                return { map: a.ref.id, nodes: d.nav.nodes.length, colliders: d.world.cols.length, islands: d.nav.islands,
                    actors: d.match.actors.length, panes: d.glass.panes.length,
                    spawns: d.match.actors.every(actor => {
                        const spawn = authoredSpawns.get(actor);
                        return spawn?.map === a.ref.id && a.spawns.some(
                            authored => authored.side === spawn.side && spawn.position.distanceTo(authored) < .025);
                    }),
                    path: d.nav.path(d.nav.nearest(...a.data.gameplay.spawns[0].pos, false),
                        d.nav.nearest(...a.data.gameplay.spawns[8].pos, false)).length,
                    ground: a.spawns.every(s => Math.abs(d.world.groundAt(s.x, s.z, s.y + .4) - s.y) < .2),
                    frame: d.stats().tris, resources: trackMap() };
            }""")
            assert (data["map"], data["nodes"], data["colliders"]) == (map_id, nodes, colliders), data
            assert not data["islands"] and data["actors"] == 10 and data["panes"] == 0, data
            assert data["spawns"] and data["ground"] and data["path"] > 1 and data["frame"] > 10000, data
            assert data["resources"]["attached"] and data["resources"]["images"] > 10, data
            page.evaluate("() => { window.botStarts=GH.debug.match.bots.map(bot=>bot.pos.clone()); }")
            page.wait_for_function("""() => GH.debug.match.live && GH.debug.match.bots.some(
                (bot, i) => bot.path.length > 1 && bot.pos.distanceToSquared(botStarts[i]) > .25)""", timeout=60000)
            print(json.dumps(data), flush=True)

            page.evaluate("() => GH.debug.match._end()")
            page.locator('#pg-end [data-act="again"]').click(timeout=60000)
            page.wait_for_function("GH.G.state === 'playing' && GH.debug.match.state === 'countdown'", timeout=30000)
            assert page.evaluate("mapCheck().disposed === 0 && mapCheck().closed === 0"), "Replay disposed active resources"
            assert page.evaluate("GH.debug.mapRuntime.active.ref.id") == map_id

            page.keyboard.press("Escape")
            button = page.locator('#pg-pause [data-act="quit"]')
            button.click(timeout=30000)
            button.click(timeout=30000)
            start.wait_for()
            assert hotel_restored()
            cleanup = page.evaluate("mapCheck()")
            assert cleanup["detached"] and cleanup["disposed"] == cleanup["expected"], cleanup
            assert cleanup["closed"] == cleanup["expectedImages"], cleanup
            print(map_id, "replay and cleanup", cleanup, flush=True)

        picker()
        page.locator('[data-training-map="hotel"]').click()
        deploy()
        assert hotel_restored()
        page.wait_for_function("GH.debug.match.live && GH.debug.match.bots.length === 9", timeout=60000)
        page.evaluate("() => { window.playerStart = GH.debug.player.pos.clone(); }")
        page.keyboard.down("w")
        page.wait_for_function("GH.debug.player.pos.distanceToSquared(playerStart) > .04", timeout=18000)
        page.keyboard.up("w")
        page.keyboard.press("Escape")
        button = page.locator('#pg-pause [data-act="quit"]')
        button.click(timeout=30000)
        button.click(timeout=30000)
        assert hotel_restored(), "Hotel did not return to menu cleanly"
        assert not external and not accounts and not errors and not console_errors, (external, accounts, errors, console_errors)
        print("Native hotel, movement, no account requests and no external egress passed", flush=True)
        browser.close()


if __name__ == "__main__":
    assert (GAME / "assets/maps/catalog.json").is_file(), "Import the locked map assets before running"
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(GAME))) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run(f"http://127.0.0.1:{server.server_port}")
        finally:
            server.shutdown()
