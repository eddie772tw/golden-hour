# Live original Node logic / Godot pose bridge prototype

This standalone package streams live state from the **original nine-bot AI/physics session** to a single local receiver. It does not replay recorded poses or per-frame vertex goldens. The frozen `godot-node-logic` sibling supplies the original factory/bootstrap/ghSimulate code, complete comparison fixtures and immutable initial world settings. No game logic is forked into this package and normal browser play does not import it.

## Node-only reproduction

Install the sibling Node logic prototype's own Canvas dependency first, then run these commands from `prototypes/godot-live-bridge/`:

```powershell
npm --prefix ../godot-node-logic ci --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm start -- --port=48921 --ticks=3600 --output=evidence/NEW-interval-source.json
```

The bridge adds no dependency. It uses Node's built-in TCP/timers and the already installed sibling. Existing Windows fonts / real Canvas backend are inherited from that sibling; no font bytes, binary runtime, game bundle or giant raw evidence is distributed here.

In another process, a **CPU transport-only** receiver can connect:

```powershell
npm run loopback -- --port=48921 --output=evidence/NEW-client.json
# Deliberately slow acknowledgments to test bounded dropping:
npm run loopback -- --port=48921 --ack-delay-ms=80 --output=evidence/NEW-slow-client.json
```

`npm run start:baseline -- ...` selects the historical work-then-setTimeout scheduler for diagnostics. `npm start` selects the interval prototype. Explicit output names must be unique; evidence is ignored and existing files cannot be overwritten. A partial `--ticks=120` is a smoke and cannot pass the full fixture. Each source/controller is single-use.

The default client/source path is portable: this package and `godot-node-logic` are siblings beneath the client's `prototypes/`. `GH_NODE_CLIENT_ROOT` can explicitly point a staging copy at an existing client. The original core SHA remains pinned to b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b. `session.mjs` reads the **published LF** sibling `authoritative-probe.mjs` with its exact byte SHA; no private work-directory import remains. `PROVENANCE.json` records original experimental source hashes and the published source contract.

## Lifecycle and real-time clock

The server binds127.0.0.1 only and prints `GH_BRIDGE listening`. Original world/rig/audio authoring is currently synchronous CPU work, often around70seconds on the measured machine; this is not an accepted responsive product startup. `GH_BRIDGE ready` means the original state is initialized but no benchmark tick has started. HELLO provides source hashes, stable owner IDs and asset metadata. The receiver sends START after loading its resources. Only then is the original controller installed/timed.

Both variants extract the actual original `ghCreateLoopClock` from pinned core: step1/60, maximum3logical ticks per callback, excess elapsed debt counted/dropped. Input.endFrame runs once per accepted tick. The interval variant asks Node to schedule the next callback independently of the current callback's work; the original accumulator remains the only authority deciding logical ticks. Zero-tick callbacks send no duplicate pose. Node renders zero GPU frames and does not increment original render-submission counters.

At most one POSE is unacknowledged plus one latest in-memory source state. A slow receiver causes counted superseded snapshots, not an unbounded FIFO or slowed/replaced AI. ACK does not refresh an old state's timestamp. The last real pose must be ACKed before DONE. Error/disconnect/SIGINT stops timers and writes partial evidence; a busy port fails rather than terminating another process. START wait is bounded (default180seconds), and unacknowledged poses fail after2seconds.

## Data and receiver

[PROTOCOL.md](PROTOCOL.md) locks the little-endian GHLPv1 header and binary payload. The stream contains the actual camera,19operator rigs (fpbody plus18bot rigs), all current nondead original/temporary box/grenade bodies, and original K9 position/phase. Skins carry rootWorld plus full affine palettes in original34-bone order, preserving shear/hidden zero-basis bones. Godot uploads palettes directly; it must not multiply inverse bind twice or decompose to TRS.

Original dynamic model sources are explicit: Ky dropped guns, spawnMag `magProp`, the exact native ceiling-tile factory and grenades. Unknown models fail closed; no generic geometry or omitted temporary body is substituted to pass. Complete initial101home metadata is sent, but original trajectories/AI decisions are never loaded from it. Separate original rest geometry/assets are required by the native receiver; this endpoint does not transfer all native materials/textures.

PING/CLOCK supplies a monotonic offset/RTT estimate. Receivers must record actual draws, distinct applied/drawn ticks, stale ratios and state age at draw with clock uncertainty. Source logicHz, source snapshotHz, CPU receive rate and renderer FPS are different. CPU loopback explicitly reports renderFPS=null.

The Windows root-owned runner and skin-only Godot receiver are included here. The Node source/test commands above never launch an engine. For an explicitly requested visible diagnostic, first generate the sibling [rest-skin data](../godot-skin-component/README.md), install Python prerequisites, then run from the repository root:

```powershell
python -m pip install -r prototypes/godot-live-bridge/requirements.txt
python prototypes/godot-live-bridge/run_live.py --engine ABSOLUTE_GODOT_CONSOLE --name NEW-live-smoke --ticks 120 --producer interval
python prototypes/godot-live-bridge/analyze_live.py prototypes/godot-live-bridge/evidence/NEW-live-smoke
```

Use `--ticks 3600` for the complete scenario; it additionally requires all eight exports to match. `--packet ABSOLUTE_JSON` selects another generated rest packet. `--producer baseline` selects the baseline scheduler. Engine, output names and producer variant are recorded. The runner owns both child trees, bounds the run at240seconds, captures local sources before launch, rejects source drift/engine errors, and records250ms whole-tree RSS/private-byte samples. Shared RSS can be counted twice. Process/cache and source-scope limits remain explicit; the independent full public CPU proof rechecked38 source/input hashes. [RUNNER-RELOCATION.md](RUNNER-RELOCATION.md) preserves the historical relocation checklist.

The published receiver passes headless import and a visible120-tick Vulkan smoke with112different state draws. This relocated functional test ran alongside other CPU work and is ineligible for performance ranking. The published interval source separately passed9×3600ticks/all8strict against a CPU loopback. The performance pair below came from the earlier frozen root experiment, not these relocation checks. All generated evidence and engine binaries remain ignored.

## Evidence and limits

The original Node CPU Gate A passed8/8strict twice. Full live CPU/TCP and root-owned skin-only Vulkan sessions also preserved all eight exports for9bots x3600ticks. The slow-ACK CPU run counted1709superseded states while completing every AI tick. All failures, including the original unregistered-magazine fail-closed run, remain in local historical evidence.

One consecutive exploratory visible baseline/interval pair observed source snapshot38.711→55.544Hz (+43.5%), logic59.760→59.994Hz, dropped debt0.24888→0seconds and stale draw35.45%→7.70%. Pose-ageP95 was36.878→29.383ms with clock uncertainty±1.056/±0.816ms. These are skin-only component observations, not a clean multi-run performance ranking or full High/game acceptance; frame-post-draw callbacks are not physical presentation timestamps. The interval result still does not show60freshposes/second.

Full High shaders/normal law/planar reflection, native prop/weapon/FPbody-subset/FX/K9-part rendering, human input, complete audio graph/DSP equivalence, responsive cold start, IPC/input-to-photon, process-tree memory and release packaging remain separate gates. Original eZ runs on recording virtual hardware;20000retained commands and more than800000dropped records are reported, not accepted full audio delivery. No browser/Godot/GPU is started by Node source/tests and no public game runtime is changed by this package.
