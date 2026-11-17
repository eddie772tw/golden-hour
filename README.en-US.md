# Golden Hour community fork

[繁體中文（台灣）](README.md)

Play a 5v5 team deathmatch in the Solstice Hotel or train against nine bots. This independent community fork recovers the browser client from a playable distribution and pairs it with a reconstructed local match server. The historical upstream is [LankiYang/golden-hour](https://github.com/LankiYang/golden-hour). On November 17, 2026, the [original website](https://www.bilibili.com/toy/golden-hour/index.html) was accessible again; the public GitHub repository API still returned 404. The fork retains its independent Git history. [Fresh resource archive and verification record](docs/upstream/2026-11-17/README.md)

## Play

On Windows x64, extract the client ZIP and open `Play.cmd` for Solo, Host or Join. For a headless host, use the separate dedicated-server ZIP and `Start-Server.cmd`. Both include their runtime. See the [portable build and upgrade guide (Traditional Chinese)](docs/client-distribution.md).

To run from source, install Node.js 22.13 or later and a WebGL 2 and WebRTC capable browser. Run these commands from the project root or use `Start.cmd` on Windows.

```sh
npm ci
npm start
```

Open the [local game](http://127.0.0.1:48722/). Select **Solo training** to play alone. For multiplayer, create a room and join from a second browser profile on the same machine. Browser profiles have separate competitive identities. The menu language selector supports Simplified Chinese, US English, Traditional Chinese (Taiwan), Japanese and Kyoto Japanese. Your selection persists in the browser.

The local Node server owns room simulation, equipment checks, scoring and per-recipient snapshots. It listens on IPv4 loopback, simulates at 60 Hz and sends snapshots at 30 Hz over WebRTC. Use the KR-7 to eliminate opposing human players 10 times to unlock the VESPER. Get 10 more human kills with the VESPER to unlock the M12. Training and bot kills do not advance competitive unlocks or rankings. Export an encrypted account backup before clearing browser storage.

## Play on a local network

Install dependencies on each computer before going offline. On the host run `node server/dedicated/launch.mjs host 192.168.50.10` with its LAN address. On the other computer run `node server/dedicated/launch.mjs join "INVITATION"` with the full printed invitation. Each player opens their own loopback game URL and selects **Multiplayer → Local account** to create, unlock or import an account. The host creates a room and shares its eight-character code. Use `serve` in place of `host` for a headless dedicated server. Allow TCP 48723 and UDP 49100–49200 on its LAN interface. First-time host setup requires OpenSSL. The account menu exports passphrase-encrypted saves and shows signed career totals. [Launcher scripts and operating instructions](server/dedicated/README.md)

## Mind the Shop weapons

In Gunsmith, open the pistol, SMG or shotgun tab and choose a weapon model. G-Bull trades fire rate for a 20-round magazine. Chin-Gi fires at 667 RPM with lower recoil and retains more damage at range than the VESPER. Lin-Bei fires six pellets per shell in a tighter pattern than the M12. A full close-range hit deals 72 damage before hit-location modifiers. Each model uses Golden Hour's hands and handling animations. Other players see the matching world model. The original competitive unlock requirements apply to each family, and only VESPER eliminations count towards unlocking the M12.

## Development

Edit the recovered game in `game/core/game.js`, the browser modules in `game/client/` and local authoritative logic in `server/`. Run `npm test` for protocol, progression, visibility and localization checks. For browser tests, run a fresh server with default round duration, install Python Playwright, then run `python server/check_browser.py` and `python server/check_languages.py`. Tests use Edge by default or a Chromium executable specified by `GH_BROWSER`. Use `GH_DEV_PORT` to change the port and `GH_CAREER_DB` to select the SQLite file or an in-memory test database.

Development focuses on stronger anti-cheat, connection stability and new game content. [Roadmap](docs/roadmap.md) · [Networking research](docs/network-research.md) · [Anti-cheat research](docs/anti-cheat.md) · [Adding a locale](docs/localization.md)

## Credits and distribution

Developer **蒙哥汗马利@LankiYang** has consented to this fork and its development, as confirmed by the maintainer and the archived conversation image. Formal open-source license terms remain unspecified. [Source inventory, permission record and third-party notices](docs/provenance.md)
