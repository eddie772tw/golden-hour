# GHLP v1 live original-state stream (layout locked)

One Node TCP server at `127.0.0.1:48921` by default, one receiver. This is the initial render-only integration. Full High/material/FX/K9-part/audio/IPC acceptance remains open. The source runs original native AI; it never sends prerecorded actor poses or per-frame vertex goldens.

All numeric fields are **little-endian**, Three matrices retain column-major 4x4 order. Right-handed Y-up/-Z-forward; no axis flip. Every packet has this 48-byte header:

| Offset | Type | Meaning |
|---:|---|---|
| 0 | uint32 | Total packet bytes minus4 (including remaining header) |
| 4 | uint32 | Magic `0x504c4847`, bytes `GHLP` |
| 8 | uint16 | Version1 |
| 10 | uint16 | Kind |
| 12 | uint32 | Source snapshot sequence, or echoed control sequence |
| 16 | uint32 | Actual accepted logical tick |
| 20 | uint32 | Reserved0 |
| 24 | float64 | Source state timestamp in Node `performance.now()` milliseconds |
| 32 | float64 | `performance.timeOrigin + sourceTimestamp`, epoch milliseconds |
| 40 | float64 | Original authoritative `GH.G.time`, seconds |

POSE timestamps refer to completed logical state, before audio/pose preparation and TCP encoding. ACK wait does not refresh the state timestamp. Epoch subtraction is only an uncalibrated same-host estimate; use PING/CLOCK for monotonic clock alignment and report RTT/uncertainty. Neither clock proves input-to-photon latency.

Kinds: HELLO=1, POSE=2, START=3, ACK=4, PING=5, CLOCK=6, DONE=7. HELLO and DONE payloads are UTF-8 JSON. START/ACK/PING are exactly48bytes, no payload. START is single-use and begins the original full-AI controller only after the receiver is ready. ACK echoes the POSE sequence, after applying that pose. Old duplicate ACK is counted; future/unowned ACK rejects. A peer must ACK within2seconds.

PING uses its header monoMs for the client's monotonic send time. CLOCK echoes its sequence and has24payload bytes: float64 echoedClientMonoMs at0, NodeReceiveMonoMs at8, NodeReplyMonoMs at16. No simulation input is carried by PING.

HELLO fields include source core/setup/clock SHA, immutable initializer SHA, original step1/60 and max3catchup, `nodeTimeOriginEpochMs`, `skins`, original `operatorAssets` position/skinIndex/skinWeight hashes, `bodyModels`, `initialBodies` (stable IDs/index/name/model/homeP/homeQ), `k9Phases`, and explicit unported gaps. It does not carry the static geometry/texture binary; use the separately proved original rest packet. Source IDs are logical owner IDs, not Three UUIDs.

## POSE payload

Offsets here start after the48-byte header:

| Offset | Type | Meaning |
|---:|---|---|
| 0 | uint32 | skinCount |
| 4 | uint32 | bodyCount |
| 8 | uint32 | k9Count |
| 12 | uint32 | Superseded source snapshots to date |
| 16 | 16float32 | Original camera.matrixWorld |
| 80 | 16float32 | Original camera.projectionMatrix |
| 144 | 4float32 | Original camera fov(degrees), aspect, near, far |
| 160 | records | skins, then bodies, then K9 records |

Each skin record has six uint32: id, flags, actorID, rigIndex, team, boneCount; then16float32 rootWorld; then `boneCount *16float32` precomposed affine palettes. Size `88 + boneCount*64` bytes (2,264 for34bones). Stable skin IDs:0=player fpbody,1..18=bot actors1..9 each rigs0/1. `flags`: bit0 effective visibility, bit1 actor alive, bit2 fpbody, bit3 current actor.char rig. Corpse visibility comes from bit0; alive=false does not automatically hide it.

Palette_i = inverse(rootWorld) * originalBoneWorld_i * originalInverseBind_i, in exact original `body.skeleton.bones` order. Godot uploads this full affine matrix directly to the RenderingServer skeleton, then applies rootWorld once to the instance. **Do not multiply inverse bind a second time; do not decompose to TRS.** Zero-basis hidden bones and real shear are retained. FPbody's separate subset/material mapping is not accepted full visual parity.

Each body record is80bytes: four uint32 id, bodyModelIndex, flags, sourcePropIndex; then16float32 original obj.matrixWorld. `sourcePropIndex` is0..100 for immutable original props, or `0xffffffff` for dynamic temporary bodies. IDs persist for each original body object even if native arrays are filtered. Flags: bit0 effective visibility, bit1 sleeping, bit2 temporary, bit3 grenade. Each snapshot contains all current nondead box/nade bodies; previously seen IDs absent from a new snapshot should be hidden/removed. Model indices refer to HELLO bodyModels; initial home settings are metadata, not per-frame replay.

Each K9 record is32bytes: four uint32 id, team, alive, phaseIndex; then four float32 original position x/y/z and yaw(radians). Phase indices refer to HELLO k9Phases. The original K9 AI runs, but this record does not transfer its custom part deformation; it is an explicit visual gap.

## Bounded delivery and measurement

At most one POSE is unacknowledged, plus one latest in-memory source snapshot. Newer source states supersede unsent snapshots with a counted sequence gap. AI ticks continue independently of a slow peer. No extra pose is created for a0tick callback; ACK retry never invents a logical tick. Packets with repeated source tick must not be counted as fresh-pose FPS.

The original60Hz/max3/debt-drop accumulator is extracted from pinned core. Node timers follow real performance.now. Original input.endFrame runs once per logical tick; expensive presentation/state preparation occurs once per callback with accepted ticks. Node never calls the render-submission stats method: actualNodeGPUFrames and original renderFrames stay0. `logicHz`, source snapshotHz, dropped debt, tick/callback gaps, ACK RTT, bounded sample drops and superseded packets are separate fields. Godot must measure actual draws, distinct applied ticks and pose age at draw independently.

DONE is sent only after the last actual source pose is acknowledged. It reports transport completion/full-fixture comparison separately. Partial `--ticks=N` is a smoke and cannot pass the3600tick full fixture. SIGINT/error/disconnect stops the source and writes a partial report; initialization is currently synchronous CPU authoring and is not an accepted responsive product startup.
