# Opt-in renderer diagnostics

Implementation: `game/client/render-diagnostics.js`. Normal startup does not import it. The observer reuses the existing diagnostic phase classification, bounded rings, wrapper restoration and asynchronous GPU query design. The benchmark runner remains responsible for launch, storage isolation, fixed inputs, source hashes, CPU profiles and raw submitted-frame intervals.

Importing the module has no effects. Installation must be explicit and after `GH.ready`. No new dependencies, RAF, FPS cap, simulation/input/AI hooks, scene visibility changes or network uploads.

```js
// Browser console, once the isolated candidate contains the module:
const { installRenderDiagnostics } = await import('/client/render-diagnostics.js');
await GH.debug.gfx.whenReady?.();
window.renderDev = installRenderDiagnostics(GH, {
  source: { coreSHA256: 'runner-computed hash', revision: 'candidate label' },
  gpu: true, counters: true,
  uniformCounts: false, // enable separately for uniform-call diagnosis
  driverTimings: false, // enable separately for link/query CPU spans
  trace: false, // enable when a CDP trace is actually being recorded
});
renderDev.phaseMark('steady'); // also .mark(label)
// ...normal gameplay/benchmark, no additional render loop...
const report = renderDev.export();
renderDev.stop();
copy(JSON.stringify(report)); // DevTools-only copy utility
```

Explicit console installation satisfies the opt-in requirement without touching startup. If the owner later wires `?renderDev=1`, dynamically import only when that query is exactly `1`, after readiness. No unconditional import/install in normal gameplay. `GH.renderDiagnostics` is the same API; a second installation returns the installed instance.

The module refuses installation over `window.__diag.installed`. In `run_browser.py`, substitute this module's explicit import/install/export for the old `diagnostic.js` injection; do not enable both. Keep the runner's `__frames` primary interval recorder and the source SHA. `__perf` or other GPU timer consumers must not be added: an already active timer is skipped, but competing tools would bias both datasets.

## What the output means

- `spans`: CPU wall durations on **the page's renderer main JavaScript thread**. Each has `id`, `parent`, `start`, `frame`, `tick`, `phase`, `inclusiveMS`, and `selfMS`. Self = inclusive minus directly instrumented child durations. It includes uninstrumented work, wrapper overhead and synchronous browser/driver waits. It is not sampled CPU execution time. Never sum an inclusive parent with its children.
- `gfx.render`, `reflection.total`, `composer.<index>.<class>`, `render.world/reflection/VM/ao-normal/...`, `shadow.render`, world/VM matrix updates and native player/match/bots/physics/glass/viewmodel/FX/audio/HUD updates are separate CPU boundaries. Quality rebuilds rewrap fresh composer passes; bot recreation rewraps fresh bots and releases obsolete references.
- `frames`: **gfx.render invocations**, not compositor-presented frames and not the complete simulation tick. Simulation updates outside gfx are independent root spans associated with the next gfx frame number; multiple simulation ticks can precede one render. Use `tick`, `start`, and parent IDs. Use runner RAF/presentation data for end-to-end pacing. The render-time ring reports hidden/preparation/warming states.
- `counts`: inclusive actual GL draw/useProgram/uniform counts and renderBufferDirect submissions, material runs and distinct material/program IDs. Parent numeric counts include child passes. `materialRuns` counts changes in the material object sequence; it is not proof of shader-cache misses. `programUses` counts actual GL `useProgram` invocations after native state caching; it is not `getParameters` count. Distinct IDs are capped at 2048 per active scope and disclose truncation. Multi-draw extension entry points are not wrapped. Uniform fields are only meaningful with `uniformCounts:true`; query/link timings need `driverTimings:true`.
- `summaries`: complete CPU call counts/durations and counter totals **since reset**, including raw rows already rolled out of rings. `counterTotals.materialDistinctPerCallSum` sums per-call distinct counts; it is not a distinct count over the whole run. Labels are capped at 128; `summaryOverflow` counts calls omitted from this summary after the cap. Raw ring `coverage` gives capacity/total/retained/dropped for every stream, so a rolled-out interval cannot look like a complete run.

## GPU sampling

Uses WebGL2 `EXT_disjoint_timer_query_webgl2` if available. One query at most is submitted per sampled gfx frame. No nested TIME_ELAPSED queries, no busy wait, `gl.finish`, readPixels or blocking result read. Completion is polled at the next gfx invocation or explicit export, and the result is read only after availability. Pending queries are capped at 8; a saturated queue skips samples rather than forcing a sync. Export may still have pending samples; missing samples are not zero.

Defaults rotate scopes `gfx.render`, `render.world`, `render.reflection`, `shadow.render`, `render.VM`, `render.postprocess` at **11 ± 2 frames**. Jitter uses a fixed private xorshift stream, never `Math.random`; an even scope count therefore cannot trivially lock each scope to one 30 Hz reflection parity. `gpuState.sampleStrata` reports completed samples by scope, actual reflection execution and zero/nonzero draws. Samples are intentionally sparse and not a complete per-frame GPU breakdown. A scope that did not run is skipped. Only its first invocation in the sampled frame is selected; for multiple postprocess passes use explicit `gpuScopes:["composer.2.gg", ...]` based on observed span labels and document that configuration. `gpuEveryFrames` is configurable (1–600); at 1 frame the jitter is 0.

GPU rows join by `span` to CPU span ID and by `frame` to gfx frames. They include `counts.draws`, `frameWork.reflectionCalls`, and `contextEpoch`; empty shadow invocation samples are distinguishable from active shadow work. Parent GPU scopes include nested passes, render-target switches, clears and updates submitted inside their boundary. Sampling `render.world` includes its shadow call; sampling `shadow.render` is a separate observation on another frame. Do not subtract different-frame samples as exact GPU exclusive timing or sum inclusive values. `gfx.render` is the entire submitted graphics command interval, including shader/driver stalls visible to the GPU clock, not a presentation measurement.

Disjoint flags before availability and after reading results invalidate all pending results. Context loss invalidates pending/active queries; restoration reacquires the extension. Diagnostics never calls preventDefault or owns game resource recovery. Failed timer API calls suspend further sampling until context restoration or explicit `reset()`; CPU diagnostics continue. Report `supported`, `enabled`, scheduled/submitted/completed/skipped/invalidated/errors, pending count and context epochs. A disjoint or unavailable extension is not evidence of a fast GPU.

## Threads and traces

GPU elapsed is a GPU-clock command interval, **not the CPU time of the GPU process or hardware busy utilization**. It can include command-stream bubbles and CPU feed gaps. It does not identify GPU cores, driver, raster, compositor or worker threads. CPU wall duration of a page JS wrapper does not identify where an API wait spent CPU. Thread attribution requires a separate CDP trace with process/thread metadata and clock alignment. The parent-run thread summary is separate evidence, not a capability provided by this module.

With `trace:true`, `.phaseMark(label)` emits `performance.mark` and `console.timeStamp` under `gh-renderdev:<label>`. Instrumented CPU spans emit UserTiming measures with frame/tick/span/parent details. Entries are immediately cleared from the page Performance Timeline to keep page storage bounded; an active CDP trace can retain the events. Start a trace containing `blink.user_timing` and timeline/thread metadata **before** marking a phase. The module does not start or collect CDP traces, assign OS thread IDs, or claim exclusive task CPU time.

Worker work is recorded only if the worker actually times itself and a host explicitly forwards the sample:

```js
// Worker, around real work:
const startMS = performance.now();
const result = doWork();
postMessage({ type: 'diagnostic-timing', worker: 'navigation', label: 'path',
  startMS, durationMS: performance.now() - startMS, timeOrigin: performance.timeOrigin, tick });
// Existing host message handler, for messages from that actual worker:
renderDev.recordWorkerTiming(message.data);
```

Preserve the worker's own timeOrigin/startMS; do not substitute page send/wait round-trip duration. No worker message handler is installed automatically and no existing Worker workload is altered. Forwarded samples identify worker-internal timing supplied by the caller, not an independently verified OS thread ID. `receivedAt` is the page clock for correlation and is not the execution start.

## Limits and acceptance

Defaults retain 1200 gfx frames, 12000 CPU spans, 512 GPU results, 128 phase marks, 512 worker samples and 64 errors. All ring capacities accept `limits:{...}` overrides capped at 65536. Totals remain complete within the 128-label summary cap even when raw samples roll out; choose a shorter marked measurement or larger bounded ring when per-frame correlation over a long run is needed. Default 12000 spans can retain substantially less than a full 60-second run. `reset()` is explicit, invalidates pending GPU results, resets the sampler and summary, and must run outside an instrumented call. `stop()` restores methods only when its own wrapper still owns the method; later wrappers are left intact with inactive diagnostic wrappers beneath, and this is reported.

Instrumentation overhead is unavoidable and uncalibrated. Coarse clocks, per-draw counters, sets, query calls, deep GL timing and trace collection can change CPU submission, GC, driver and GPU timing. Compare CPU/counter profiles only under the same switches and retain source/env metadata. **Use separate uninstrumented paired runs for FPS/1% Low acceptance.** Turn on uniformCounts, driverTimings and trace independently to find overhead-sensitive paths.

Private Three closures (`QX.getParameters`, renderer `o0`, `D`, cache key decisions, traversal E0) are not exposed by public APIs. This module does not pretend useProgram/material runs answer why those functions ran. Use a CPU profile or a separately isolated source probe for cache parameters/reasons; do not expand production Three patches just to expose counters.

Offline validation:

```powershell
node --test server/render-diagnostics.test.mjs
```

13 observer tests passed, including actual bundled Three semantics, phase hierarchy/self timing, native return/exception behavior, bounded rings, asynchronous/non-nested timers, disjoint recovery, rebuild/bot lifecycle, trace/worker provenance and independent sampling RNG. Shadow-map replacement is detected after restore/rebuild and at the next graphics call, independent of native listener order. Old wrappers are released. contextEpoch increases once on loss and once on restore (one cycle = 2).

Hardware validation completed with the fixed full-AI scenario: 226 GPU results, no query/page/observer errors, unchanged eight logical exports. A real context loss/restore and setting/equipment smoke test also passed; 94 active shadow spans were observed after restoration. Source and bounded-stream coverage are in `evidence/stage1-observation.json`. The complete repository suite passed 101/101. Raw CPU spans may roll out; complete CPU summaries and explicit coverage prevent treating the retained tail as the whole run.

The timer availability/disjoint handling follows the [Khronos WebGL2 extension specification](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/).
