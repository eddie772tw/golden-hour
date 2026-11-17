# Browser core feedback and main integration

Current direction, 2026-11-17: develop browser core in isolated branches, promote
completed and checked changes to `main`, and continue browser work there. Keep
Godot validation on `perf/godot-validation`; no Godot component code is included
in this browser integration. Electron and Tauri are outside this round.

The earlier Stage 11 stop/pivot remains historical evidence. The user's later
instruction resumes bounded browser backports and prefers the browser while a
full equivalent Godot advantage remains unproved. No full engine rewrite is
authorized by the component results in this report.

## Conditions and evidence

1920x1080, DPR1, scale1, High effects, reflection cap30Hz; normal portable
`Play.cmd`/Deploy in hardware Edge, original nine native opponents,3600 logical
ticks, seed0x47484d31. Endfield was verified absent. Tactical AI, perception,
navigation, death/ragdoll, grenades and K9 remain native. All successful full
runs below match the eight baseline exports exactly. Fresh context/storage/HTTP
cache is used; OS/GPU-driver caches are retained. These are submitted-frame
intervals, not physical presentation measurements.

The [machine evidence](evidence/browser-feedback-2026-11-17.json) retains source
and raw hashes, all complete/warm populations, debt, startup/entry, audio counts,
oracle failures and GL recovery evidence. The diagnostic clients combine Git
archive source with identical hashed portable runtime/vendor files; they are
diagnostic compositions, not release packages. Raw local paths are recorded;
large raw runs are not bundled in Git.

## Shader preparation

The baseline already compiles and executes real main/reflection/shadow/VM/post
draws, then waits for its draw fence. The candidate adds bounded real draws for
three existing zero-instance FX pools and waits for all retained programs of a
material, including both sides of transparent materials. CPU tests preserve
arrays, RNG and transient count/visibility/cull state. See
[implementation and unresolved variants](shader-warmup-backport.md).

| Same shader-candidate source, execution order | FPS | Full 1% low | P95/P99 ms | Maximum ms | >50ms/min |
|---|---:|---:|---:|---:|---:|
| on1 |58.78|25.43|20.5/26.2|135.1|4.99|
| off1 |58.95|27.03|20.3/25.3|124.7|3.99|
| on2 |59.15|25.91|19.8/24.6|170.2|4.99|
| off2 |59.04|26.24|19.9/24.8|118.1|4.98|

There is no consistent steady-state improvement. The candidate stays default
off. One earlier clean baseline was55.89FPS/20.40 full low; it is not a causal
comparison against the later warm-driver series. Cold/entry timing is retained
without claiming a startup win from that ordering.

The actual warm coverage reports the original4096/192/44-capacity pools primed
to one and110/110 retained programs complete after the fence. This is shader
completion, not proof of every future driver specialization. A frozen final
full-scene preparation off/on/on/off comparison has identical nonblack RGBA8
hashes and GL0 in all four captures. Full native-AI exports are exact.

## Loop decoupling decision

The explicit observer is default off and not imported by normal startup.
[Full analysis](loop-cost-1-analysis.md) and
[phase dependencies](loop-cost-observer.md) distinguish inclusive parent spans
from sequential phases and actual GL buffer uploads from CPU dirty writes.

Only37 extra catch-up ticks occurred in the60.223s diagnostic. Every candidate
mixed presentation phase in their preceding ticks totals25.100ms: an upper
bound of0.781ms per two-tick callback and1.088ms per three-tick callback. Actual
removable terminal writes are a subset. The666.100ms in one-tick/no-render
callbacks largely moves to1452 zero-tick/render callbacks; it is not a net
saving. The complete population has3600 ticks versus3562 renders.

All simulation-scope buffer uploads are zero. Three uploads the resulting
buffers during render. A148.8ms submitted interval surrounds a zero-tick
callback with11.7ms total/10.4ms render and a136.1ms observed-span gap before it;
the following three-tick callback costs12.1ms. Catch-up is the consequence in
that example. This gap does not by itself identify GC, audio, driver or thread
ownership. Broadly moving VM/FX/FPbody/lighting would risk events/RNG/state for a
small measured upper bound, so it is not promoted as the next optimization.

## Context recovery correctness

The functional test found pre-existing INVALID_OPERATION on deleting old GPU
handles after context restoration, with the shader flag both off and on.
Actual GL stacks identify stale Texture/Geometry/BindingStates dispose closures
invoked by resetShadows, atlas disposal and composer rebuilding. Snapshotting
only console errors had missed these WebGL warnings.

The fix retires GPU ownership when the context is lost. Old callbacks still
remove CPU caches/listeners/counts; only handles belonging to the invalidated
generation skip native deletion. Current-context deletions continue. Actual
backend regression tests cover old/new listeners on the same Geometry and
ordinary/cube/MSAA RenderTargets. The GL audit records preceding errors and
deletion failures rather than hiding them. Source and post-fix functional
results are included in machine evidence.

Post-fix functional runs with the shader candidate off and on both report zero
GL errors, deletion failures, preceding errors and WebGL warnings. Current
generation Buffer/VAO/Texture/FBO/Renderbuffer/Program/Shader deletions still
occur. Quality, motion blur, equipment, pointer lock and restoration pass.

## Audio remains a separate experiment

`perf/browser-audio-backport` retains original T admission, gain, spatial/bus/
reverb paths and changes only casing source subgraphs. It is not merged into
browser main. In the latest480-case oracle, on-time and steal-tail JS source
cases pass the original one-sample/2% gate; delivery-miss cases remain missed
deadlines. Past-API sources fall back before publication.
Native fallback traces, voice state and RNG are exact, but36 cases per rate
still fail the stricter PCM byte check, at roughly1e-9 absolute differences.
These failures remain recorded; they are not reported as an overall pass.

One full-workload diagnostic screen creates95661 nodes with the experiment
versus112994 without it (about15.3% fewer),899 submissions/30 capacity fallbacks,
no descriptor/timing fallback or processor errors, and343 late deliveries.
The on/off FPS is58.90/59.19, full low27.33/26.87, P99 26.1/23.8ms. One pair does
not show an actionable performance win; the experiment remains on its branch.

The current interactive route reports48–72ms outputLatency estimates. These
are browser-clock estimates, not loopback recordings, and baseLatency must not
be added again to a getOutputTimestamp mapping. The20ms event-to-output target
is not established. Only a bounded numeric latencyHint A/B is justified before
further work on this output configuration; a source's first nonzero sample is
not endpoint latency. Further15–10ms work requires positive evidence and margin.

## Acceptance and next evidence

The full60FPS/1%-low gate remains unmet. Integrated observer-off runs retain
all native coverage and strict outputs, but still contain long intervals.
There is no quality reduction, AI throttling or removed first-use population.
Complete current unit tests:147 passed. Functional checks include High/scale/
motion-blur changes, reflection cap, pointer lock, equipment and context restore.
Consult machine evidence for per-run GL audit results rather than treating
successful interaction as automatically GL-clean.

The final promoted-core clean run is58.92FPS/full low25.62, P95/P9920.0/25.1ms,
maximum141.2ms,3.99 intervals over50ms per minute and237.6ms discarded debt.
All eight exports match. This single run verifies the promoted code path; it
does not establish stable60FPS or a causal speedup over another revision.

Next priority is thread/GC/native scheduling evidence for the observed long
gaps and actual render-pass CPU/GPU costs. Keep those diagnostics separate from
clean FPS runs. Native/Godot audio investigation remains bounded and separate;
neither an output estimate nor a partial engine renderer establishes a full
equivalent migration advantage.
