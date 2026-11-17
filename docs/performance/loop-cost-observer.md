# Catch-up loop cost observer

This default-off observer measures the existing native loop. It does not move
updates, change simulation dt/debt, skip actors, reduce quality or consume RNG.
Use its milliseconds to choose a later change; no phase is automatically
classified as removable presentation work.

The owning change is restricted to `ghPresent`, `ghSimulate` and `M0` near the
end of `game/core/game.js`, plus the explicit helper and CPU tests. Audio engine
implementation and shader preparation are unchanged.

## Enable and collect

After `GH.ready`, install in the same JavaScript task immediately after the
benchmark scenario installs. Installing before Deploy/setup would mix those
callbacks into the same aggregate buckets.

```js
const {installLoopCostObserver} = await import('/client/loop-cost-observer.js');
// await installBenchmarkScenario(...), then synchronously:
window.loopCost = installLoopCostObserver(GH, {
  uploads: false, // true also counts actual GL bufferData/SubData arguments
  capacity: 4096,
  source: {coreSHA256: 'runner-supplied hash', name: 'diagnostic run name'},
});
// Once the scenario is paused/done, outside its measurement window:
const evidence = loopCost.export();
loopCost.stop();
```

`reset()` clears all counters/ring samples between windows. `stop()` makes the
core ignore the observer and restores upload wrappers still owned by it. Neither
operation is allowed from inside an observed callback. Importing the module
does not install anything. No URL flag or default-game import is added.

The root runner can use `--loop-cost [--loop-upload-bytes]`; this helper's API is
`installLoopCostObserver(GH,{uploads})`, then `export/reset/stop`.

Keep primary FPS runs observer-off. Instrumentation adds clock reads, function
calls and numeric-array writes. Export/reset allocate outside the timed window.
The hot path preallocates numeric buffers and does not allocate a row, closure or
collection per tick or bot. Reported overhead includes clock-read and phase
transition counts, with no guessed subtraction. Optional GL wrappers add a
separate source of overhead; first use coarse timings without upload counting
if their cost matters.

## What the records mean

- Groups are planned simulation invocations 0/1/2/3 × render due, using the
  original RAF-timestamp/deadline decision. This is observation of the existing
  gate, not a different gate clock or an additional render request.
- Each group contains tick indices 0/1/2, plus a `tickIndex:null` scope for work
  outside simulation invocations, including the once-per-render presentation.
  `actualTicks` counts begun simulation invocations, not GH logical-tick IDs;
  interrupted invocations are disclosed by `incompleteTicks`. Normal native
  playing ticks coincide with logical ticks. Compatibility/menu updates differ.
- `inclusiveCallbackMS` and `inclusiveTickMS` are parent spans: **do not add
  them to their child phases**. Sequential phases do not overlap within their
  scope. Calls inside a phase, including native callbacks, remain inclusive.
  The callback span starts after original mode/debt planning; preparation early
  returns before that point are outside coverage.
- `entries` counts phase entries. `calls` has the same meaning except
  `combat.bots`, where it counts bot update/idle calls, and `world.callbacks`,
  where it counts world callbacks. Combat-budget reset is also timed inside
  `combat.bots`; that entire span is not a pure-AI measurement.
- `nativeFixedCallbacks` and `playingCallbacks` disclose ownership/state mix.
  Install after scenario setup so a bucket is not contaminated by menu/online
  compatibility callbacks; the observer does not subtract mixed calls later.
- The callback ring retains the latest 4096 records by default, with exact
  total/retained/dropped counts. All aggregate phase/callback/tick counters
  continue after ring overflow. No percentile is silently computed from a
  dropped prefix. Exceptions rethrow the original error and mark the partial
  callback; instrumentation does not turn a failed callback into a success.
- Timings are renderer JavaScript main-thread wall spans. They are not GPU
  elapsed time, driver CPU attribution, browser compositor/present time or an
  independently measured worker-thread cost. Original wall-clock cosmetics may
  observe instrumentation's added elapsed time; deterministic workload exports
  must still be checked by the runner.

## Phase ownership and dependency screening

These boundaries are deliberately coarse. Their source order is unchanged.

| Phase | Included work and dependency | Is its total removable? |
|---|---|---|
| `player.hit.arsenal` | Input enable; native player/camera movement; hit endpoints; arsenal/recoil/clips/events | No. Gameplay, hit and event/RNG ownership. |
| `combat.bots` | Per-tick combat budget reset plus every bot update/idle; native decisions, aim/movement/rig/shoot side effects | No. Inclusive mixed AI/execution; never treat as pure presentation or just AI decisions. |
| `match` | Match update, deaths/respawns, grenades/K9 and state transitions through native owners | No. Native gameplay/event boundary. |
| `physics` | All native bodies, motion, collision and contacts | No. A later change would need a separate internal presentation boundary. |
| `glass` | Existing pane/shard update | Mixed. Preserve physics/lifetime/RNG/events; do not skip the whole update. |
| `VM` | `Qw.update`: `_events`, recoil/springs, wall raycast, animation clip/pose and FOV; shake uses native random calls (33443 onward) | Mixed. Presentation-looking transforms are interleaved with persistent state, event handling and RNG. Requires an internal split after measurement, not an update-frequency switch. |
| `world.callbacks` | Every registered hotel callback | Mixed. Water/light clocks coexist with chandelier falling/explosion/glass/audio callbacks (26282), moving scene buffers (30059) and HM light-volume source/flush state (30302). Do not skip or run the whole list once. |
| `FX` | `$M.update` (21025): emitter callbacks, task queue, heat haze/flicker, native particle/distortion/decal simulation, light decay and suppression/hurt/flash state plus uniform writes | Mixed. A potential terminal uniform/buffer-write split must retain all native emitters, timers, events and RNG calls. Current aggregate is only an upper bound. |
| `camera` | Freecam application and `camera.updateMatrixWorld(true)` | Matrix application is a candidate, but FPbody/lighting/sun below consume it within the same tick. Cannot postpone it past those readers without proving another boundary. |
| `FPbody` | `X7.update` (50263): weapon/show/light, time/filter/velocity state, gait/feet/world-ground queries, springs/flinch, upper pose, IK/resolve and matrix application | Mixed. Preserve temporal state and ground/rig dependencies; only measured terminal pose/matrix application may become a later candidate. |
| `lighting.sun` | Sun-occlusion raycast; smoothed indoor/sun state; view direction; VM lighting/environment; FX tint; sun/sky update and projected sun UV/ray coefficient | Mixed. `E.sunK/E.amb` are written after VM update and persist to its next tick. Smoothing must integrate every step; only terminal uniform/projection writes could be considered separately. |
| `post.listener` | Damage/fade/health smoothing; deferred streak peak; CA/ADS; camera-up; listener/environment/low-health setters | Mixed. Persistent filters/HUD streak and audio state must be preserved; listener setters are not the already-deferred audio presentation update. |
| `audio.present` / `HUD.present` | Existing `ghPresent`; native audio update and HUD once per accepted render in native fixed mode | Already deferred outside catch-up ticks. No second saving may be credited. No audio implementation edits here. |
| `render` | Existing full `n.render`, inclusive main/reflection/shadow/post | Already once per accepted render. Do not add existing render-dev child spans to this parent. |
| `input.endFrame` | Original per-native-tick edge consumption, or compatibility frame boundary | No. Preserves one-shot input and benchmark completion semantics. |
| `loop.other` | Timing gaps, native clock/accounting and unclassified idle/menu work | Overhead/residual. Not a pure-presentation estimate. |

Only after real measurements should a large mixed phase receive more narrowly
placed counters. An upper bound on repeated work is not an assertion that its
whole duration can be removed. Preserve complete AI/hit/physics/events/RNG and
all High effects while establishing the exact terminal-write boundary.

## Buffer byte counts

With `uploads:true`, wrappers call the original GL methods with the original
receiver/arguments and preserve returns/throws. WebGL2 source offset and length
are interpreted in source elements; ArrayBuffer/DataView use bytes. The default
length-zero form counts the remaining view. Number-form `bufferData` storage
allocation is reported separately from uploaded payload bytes. Texture uploads
are not counted; no GL state/error query or GPU synchronization is introduced.

These are actual JavaScript GL-call payload sizes, not physical bus traffic.
`needsUpdate`/CPU-array writes are **not** counted as uploads: three simulation
ticks can rewrite a buffer three times yet native Three uploads only its final
contents once during `render`. Do not claim three GPU uploads were removed.
Outside-callback calls and unsupported argument sizes are counted explicitly.

## CPU validation

```
node --check game/core/game.js
node --test server/loop-cost-observer.test.mjs server/loop-phases.test.mjs server/loop-observer.test.mjs
```

21 checks passed: the existing owning-loop/input/debt/transition cases, enabled
versus disabled native calls/input/seeded state, 0–3 tick grouping, synthetic
per-stage millisecond attribution and non-overlap, exception cleanup, ring
overflow, upload units/scope, native GL returns/throws and wrapper restore.
These CPU checks do not establish hardware overhead, High visual parity,
full-AI export equality or a performance improvement. Root hardware diagnostics
and observer-off acceptance remain required.
