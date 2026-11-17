# Catch-up presentation screening: loop-cost-1

**The measured catch-up ceiling is 25.100 ms across 60.223 seconds. Defer a broad
presentation/logic split.** This is the sum of seven mixed phases on the earlier
ticks of multi-tick callbacks. Their truly removable terminal presentation work
is smaller, and no optimization was implemented.

The evidence is `work/browser-feedback/evidence/loop-cost-1.json`, SHA256
`e51eb6074d44b43a060c17d39650ff438c7ea2412bda90ba2f85a172907c2f00`.
It is one instrumented full-AI High diagnostic with shader warmup enabled,
casing worklet disabled, upload counting enabled, and core SHA256
`68f80228e8df0f8d43417d48646bd16bbad5ab62bede3200c6eba2ec78d75805`.
Root reported all eight strict full-AI comparisons true; the raw source also
records the shader pixel oracle `equal:true`. This run is **not primary FPS,
physical present, GPU timing or a paired performance result**.

Reproduce the calculations with
`scripts/performance/analyze_loop_cost.py --input <raw.json> --output <analysis.json>`.
The compact [machine result](evidence/loop-cost-1-analysis.json) includes raw/core
hashes, cohort checks, exact aggregate values, frame filters and limitations.
It does not copy the raw capture or change the frozen core/helper.

## Repeated catch-up work

Only groups with `nativeFixedCallbacks == playingCallbacks == callbacks` are
used below. Two- and three-tick groups are clean, with no aborted or incomplete
ticks. Candidate phase intervals are sequential; inclusive callback/tick parents
are not added to them.

| Callback group | Callbacks | Earlier ticks | Mixed-stage ceiling | Mean ceiling/callback |
|---|---:|---:|---:|---:|
| Two ticks, render due | 21 | 21 | 16.400 ms | 0.781 ms |
| Three ticks, render due | 8 | 16 | 8.700 ms | 1.088 ms |
| Total | 29 | 37 | **25.100 ms** | — |

| Candidate phase | Earlier-tick total |
|---|---:|
| VM | 9.600 ms |
| FX | 8.700 ms |
| FPbody | 3.500 ms |
| World callbacks | 1.500 ms |
| Lighting/sun | 1.400 ms |
| Post/listener setters | 0.400 ms |
| Camera matrix | 0.000 ms at this timer resolution |

This ceiling is 0.0417% of scenario wall time, or 0.00697 ms per logical tick.
It is also only 0.0835% of the observed 30,072.4 ms total render CPU span. These
ratios describe the diagnostic's time quantities, not a projected FPS gain.
Zero measured camera milliseconds does not prove zero instructions or a free
dependency boundary.

VM/FX/FPbody/world callbacks preserve native events, RNG, timers, springs,
physics/world queries and persistent filters. Lighting writes state consumed by
the next VM update; the post phase preserves damage/fade/streak/listener state.
The [phase dependency table](loop-cost-observer.md) remains applicable. Removing
all seven phases from earlier ticks would violate the preserved-work contract.

The two-tick group has a 42.3 ms maximum callback, but its per-callback phase
durations were not retained. **Do not subtract the 0.781 ms mean ceiling from
that maximum or from P99.** The same limitation applies to the three-tick group.

## One tick without a render: relocation, not another 666 ms saving

This cohort is clean: **1,453 callbacks**, 2,716.0 ms inclusive simulation time,
2,735.2 ms inclusive callback time. The same seven mixed phases total
**666.100 ms**, averaging **0.458 ms/callback**.

However, there are **1,452 clean zero-tick callbacks with a render due**. Those
renders need the latest presentation state. Moving writes from the prior
non-render callback to those render callbacks mostly transfers their work; it
does not eliminate 1,453 invocations. It could also put more work immediately
ahead of rendering and increase that callback's deadline pressure.

Across the native observed cohorts there are 3,600 simulation invocations and
3,562 render-due callbacks: only **38 invocations** separate per-tick and
per-render call counts (37 earlier catch-up ticks plus a one-invocation boundary
imbalance). The benchmark's logical-tick end records 3,561 renders because its
final native callback may submit after that logical boundary. This count screen
does not promise exact equivalence or turn 38 invocations into known saved time.

Therefore do not add 666.100 ms to the 25.100 ms catch-up ceiling. A future
selective cached-write optimization would require a new proof of state readers,
temporal integration and presentation placement, plus its own measurement.

## Long-frame scale and observed gaps

Filter: scripted, playing, visible, logical ticks 1–3599; exclude the first
submitted interval that crosses from pre-scripted activity. There are 3,561
render CPU samples and 3,560 within-phase submitted intervals.

| Diagnostic quantity | Mean | P95 | P99 | Maximum |
|---|---:|---:|---:|---:|
| Submitted interval | 16.908 ms | 19.900 ms | 24.641 ms | 148.800 ms |
| Render CPU span | 8.445 ms | 12.300 ms | 14.640 ms | 23.600 ms |

68 intervals exceed 22.222 ms, 27 exceed 25 ms, 13 exceed 33.333 ms and six
exceed 50 ms. Those are diagnostic counts, not a primary 1% Low result. The sum
of interval excess above 22.222 ms is 637.489 ms; it is not automatically
recoverable CPU work and cannot be assigned to these candidate phases.

Two longest events retain enough callback records for direct screening:

| Submitted interval | Associated callback | Render CPU | Gap before observed callback span |
|---|---|---:|---:|
| 148.800 ms at tick 2508 | **Zero ticks**, render due; 11.700 ms inclusive | 10.400 ms | 136.100 ms |
| 90.700 ms at tick 3444 | One tick, render due; 8.900 ms inclusive | 7.100 ms | 76.700 ms |

The 148.8 ms event's following callback then performs three ticks in 12.1 ms.
In that retained event, catch-up follows the stall; repeated presentation in the
stalled callback cannot explain it because that callback has zero ticks.

The gap is between observer spans, **not proven RAF-dispatch delay or attribution
to a browser/audio/driver/GPU thread**. Observer coverage begins after loop
mode/debt planning; unobserved planning, other JavaScript, native work, GC and
scheduling remain possible. The other four >50 ms events fall in the dropped
callback prefix, so this analysis does not generalize those two gap witnesses
to every stall.

## Upload evidence and measurement limits

All simulation scopes have **zero actual GL buffer upload calls and zero bytes**.
Render scopes account for all 33,061 buffer calls / 932,529,192 payload bytes;
no number-form buffer allocation bytes were observed. This full aggregate
includes the seven post-benchmark paused callbacks. Rewriting/marking a buffer
dirty in several simulation ticks did not produce several observed GL uploads;
no upload reduction can be credited to a proposed tick split from these data.

The raw callback ring retained 4,096 of 7,385 callbacks and dropped 3,289 from
the prefix; phase aggregates retain all samples. The helper recorded 86,709 clock
reads and 64,725 phase transitions, plus optional upload-wrapper overhead. It
does not estimate/subtract its own overhead. Groups 0/no-render and 1/render
contain a few paused callbacks, disclosed by the native/playing counters; their
phase totals are not exactly demixed. The clean cohorts used above avoid that
contamination.

## Next steps ranked by measured scale

1. Finish the already running shader/PSO warmup validation and observer-off
   paired acceptance. This diagnostic has warmup enabled, so it cannot establish
   its causal benefit or rank it against the clean baseline.
2. Investigate the large **observed-span gaps** using the existing RAF/request
   observer and one bounded scheduler/GC/audio/main-thread trace window. Link a
   long interval to actual tasks before proposing a fix. These 76–136 ms gaps
   dwarf the 0.8–1.1 ms mixed-stage average ceiling of catch-up callbacks. Do not
   re-open the rejected absolute-phase/gate-clock strategies from this evidence.
3. If that trace instead identifies render work on the critical path, use the
   existing pass diagnostics on the current version to separate main/reflection/
   shadow and CPU/GPU execution. Render is recurrent work: approximately 8.445 ms
   mean on every submitted frame here. The loop observer alone cannot choose
   which pass or thread to optimize.
4. Defer a broad VM/FX/FPbody/world presentation split. Only pursue a small
   terminal-write cache/boundary after its removable cost is demonstrated;
   preserve all intermediate logic, RNG/event ordering, queries, filters and
   High effects. The present data do not justify moving whole functions.

No new product optimization, timing policy, callback scheduler or hardware run
was created for this analysis.
