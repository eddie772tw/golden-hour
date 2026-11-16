# Browser render performance: staged work

## Scope and acceptance

1920x1080 drawing buffer, DPR 1, render scale 100%, High effects retained,
reflections capped at 30 Hz. Original hardware-accelerated Edge browser only.
Full native tactical AI, perception, navigation, death/ragdoll, grenade and K9
paths remain enabled under the fixed full-AI player/opponent scenario.

Target: stable 60 rendered FPS or 1% low above 45 FPS. For the alternative gate,
1% low is 1000 divided by the arithmetic mean of the slowest ceil(N * 0.01)
submitted-frame intervals, measured across the complete active fixed scenario.
Report reciprocal P99 separately; do not call it the same metric. Also retain
warm-window statistics, every long frame, render vs logical rate and dropped
simulation time. A target claim requires three clean complete runs, correct
native-AI coverage and logical outputs, without profiler/timer/OS-sampler load.
Frame intervals measure browser render submissions, not physical display presents.

## Stage 0: checked-in baseline

The prior local iteration is now preserved on this work branch before new
experiments. It includes bounded solo fixed-60 logical simulation separated
from a capped render gate, raycast broadphase and boolean queries, particle
upload accounting, one scene matrix snapshot per rendered frame, correct
preparation fences, body-fade material preparation, full-AI benchmark modes,
and an optional operator-decoding Worker. PvP retains Engine prediction.

The existing runtime was revalidated: npm test, 88/88 passed on 2026-11-16.
Earlier hardware evidence (external workspace outputs/browser-next/report.html)
showed 59.48-59.49 logical Hz and 42.43-43.35 rendered FPS in native-loop mode.
The target is not achieved. The isolated fade correction removed a first-fade
stall (412.5 -> 16.5 ms median at tick 658) but did not eliminate long frames.
Worker startup had no consistent total-ready improvement and remains opt-in.

Remote main had only an additional README commit, which this branch retains.
No desktop packaging or release is part of this work.

## Next investigation

Separate agents own scene submission, shadows and reflections. Astra owns
threading feasibility and independent review. Root serializes hardware GPU
work, integrates only evidenced candidates, verifies fixed-AI equivalence and
pushes one commit for every completed stage. Existing static batching and the
scene matrix snapshot must be accounted for. The rejected matrix-cache guard
is not part of this baseline.

## Stage 1: observe before changing render work

The explicit developer observer is documented in [render-diagnostics.md](render-diagnostics.md).
It separates CPU inclusive/self spans, sparse per-pass GPU-clock intervals,
submission counters, worker-internal samples and trace thread evidence. Normal
startup does not load it. Actual hardware full-AI replay and context restoration
passed; the integrated suite passed 101/101. Frozen summary evidence is in
[stage1-observation.json](evidence/stage1-observation.json).

A fresh uninstrumented full-native-AI baseline measured 43.54 FPS, P95/P99
35.8/45.2 ms and 1% low 15.44 FPS. All eight logical exports matched the prior
native baseline. The goal is not achieved. Separate diagnostic profiling found
QX.getParameters and program selection to be large CPU costs. A marked 20.017 s
trace pinned the game CrRendererMain by PID/TID and recorded 19.206 s of thread
CPU clock. This trace has overhead; it is not an uninstrumented utilization
benchmark. Its longest two main-thread tasks were WebAudio deferred cleanup,
58.25/54.43 ms, which warrants a separate audio-lifecycle investigation.

FX light-layout isolation and shadow material variants remain isolated candidates
at this stage. Counter A/B preserved logical exports and reduced light-triggered
parameter rebuilds from 133.20 to 0.81 per rendered frame. Neither this counter
result nor a single FPS pilot establishes target acceptance.

Reproduction uses the existing portable client build (Play.cmd) and installed
Python Playwright + Edge. No new runtime dependencies were introduced:

```powershell
$env:GH_BENCH_OUT = 'D:/Golden-Hour/work/browser-render-next/reproduction'
# Only if Playwright is supplied outside Python site-packages:
$env:GH_BENCH_DEPS = 'D:/Golden-Hour/work/testdeps'
python scripts/performance/run_browser.py --client D:/Golden-Hour/work/browser-next/candidate-combined --name unique-primary --quality high --native-loop
python scripts/performance/analyze_browser.py $env:GH_BENCH_OUT/unique-primary.json
# Copy current game/ into a portable candidate before testing new code.
# Add --render-dev for developer observation, --trace-threads for a separate
# 20-second thread trace. Those runs never count toward the FPS acceptance gate.
```

The raw evidence name must be unique; the runner refuses overwrites. A trace
can be hundreds of MB. Keep raw profiles/trace/isolated stores outside Git.

## Stage 2: remove repeated light layouts and shadow variants

World, reflection and FX continue their full light collection and view updates.
Only the main world's FX layer masks 4/8 use a separate light-layout bank, so
an empty FX pass no longer invalidates the world's lit-material parameters.
Real light additions/removals still change versions; same-count position/color
changes still update uniforms. Scene/depth ownership and transmission targets
remain with the existing render state.

Default shadow depth/distance materials now keep bounded slots for live geometry
feature combinations. Morph, cutout, clipping, displacement, batched and custom
material paths retain legacy behavior. Seeing any custom before/after shadow
callback permanently disables both slot banks for that shadow-map instance,
preserving mutations of legacy shared depth materials for subsequent casters.
Disposal releases slots before renderer properties/programs; context restoration
creates a new instance. High size, filtering, refresh, casters and order remain.

The actual owning renderer tests and complete suite passed **114/114**. Independent
review checked shared uniform references, dynamic lights, nested ownership and
the callback side effect (found, reproduced, then fixed). Eight logical exports
remain exactly equal to the baseline under full native AI.

A fresh uninstrumented AB pair at the frozen source measured:

| Complete active scenario | Baseline | Stage 2 |
| --- | ---: | ---: |
| Rendered FPS | 38.18 | 46.05 |
| 1% low FPS (slowest-tail mean) | 12.92 | 15.61 |
| P95 / P99 ms | 40.4 / 50.8 | 34.0 / 42.3 |
| >50 ms intervals / minute | 23.59 | 9.91 |
| Maximum interval ms | 353.5 | 277.1 |

An earlier baseline/pilot measured 43.54/49.16 FPS. This variation is retained;
one fresh AB pair plus pilots does not establish statistical target acceptance.
All long frames remain in the complete window. The 60 FPS / 1% low >45 goal is
**still unmet**. Detailed source hashes and measurements are in
[stage2-render.json](evidence/stage2-render.json).

The next isolated candidates are proven-planar individual fractured panes,
conservative reflected-batch culling and private audio-node reuse. They are not
included in this stage's runtime change. Geometry proof alone does not establish
equivalent DoubleSide/FlipSide lighting; use a frozen two-sided GPU pixel oracle
before accepting single-pass panes. Audio PCM equivalence and cleanup/tail-frame
measurements are separate gates. Empty-pool draw shortcuts were rejected as a
low-priority opportunity with callback/ring semantics costs and no measured gain.

## Stage 3: single-pass proven-planar fractured panes

Only an individual fractured pane whose finite nondegenerate triangles are
exactly coplanar with consistent winding uses the cached single-pass material.
Deleting cells cannot invalidate that proof. Intact glass instances, shards,
thick glass and rejected panes retain their original two-pass behavior. The
clone shares shader hooks, follows environment rebuilds, and is prepared with
a temporary non-instanced quad behind the existing readiness/draw fence.

Actual hotel geometry passed the predicate for 113/124 panes; the other 11 keep
their previous rendering. This is geometry eligibility, not a claim that all
those panes are fractured or visible in a frame.

The full native-AI scenario retained all eight logical exports. Three standing
eligible panes were tested from both faces, frontal and oblique: **12 real GPU
views, exact AA/BB/AB pixel equality**, nonblack images, positive hidden-pane ROI
contribution, and native selected-pane submissions reduced from two to one.
The oracle runs synchronously after gameplay and has no FPS claim. Earlier QA
versions incorrectly replayed raw GL draw-buffer state; those failures were
retained. The current controlled QA uses native renderer.resetState(), restores
game/renderer controls and exposure history, and requires a normal subsequent
render with zero GL errors. It does not claim arbitrary third-party GL bindings
are restored byte-for-byte. See `scripts/performance/fracture_oracle.js`.

An uninstrumented full run measured **50.72 FPS**, 1% low **17.01 FPS**, P95/P99
**30.4/38.6 ms**, >50ms **6.95/min**, maximum **261.3 ms**. The complete window
retains first use and every long interval. Warm-only results are supplemental.
The prior stage-2 fresh candidate was 46.05 FPS; these are isolated runs with
known machine/run variation, not a statistical target claim. The **target is
still unmet**. Functional High quality/scale changes, real context recovery,
resume and equipment switching passed. Source and raw-derived summaries:
[stage3-glass.json](evidence/stage3-glass.json).

Reproduce the visual oracle separately from acceptance runs:

```powershell
python scripts/performance/run_browser.py --client PATH_TO_CURRENT_PORTABLE_CLIENT --name unique-glass-oracle --quality high --native-loop --fracture-oracle
node --test server/fracture-oracle.test.mjs
```

Further evidence narrowed priorities: repeated identical skeleton palette work
was about 0.139 ms/frame; baked geometry has 100 meshes and 87 truly different
materials, with zero exact duplicate candidates; reflection tightening removed
only five submissions with no consistent CPU gain. Those changes were rejected.
Audio-node reuse passed PCM oracles but has no consistent tail-frame benefit in
the first primary run and remains isolated. A new candidate investigates only
opaque physics chairs with shared geometry/materials; it is not in this stage.

## Stage 4: screen chair submissions and audio first use

The startup-only chair instance prototype retained the 42 native physics bodies,
colliders and interaction objects. Hardware eligibility was 118 source meshes
into 12 groups; 106 fewer submissions/pass is a structural ceiling. One clean
complete native-AI pilot measured 48.91 FPS, 1% low 15.30 FPS, P95/P99
32.8/41.6 ms and 12.87 intervals >50 ms/min. All eight logical exports matched
stage 3. This isolated run does not establish a statistical regression, and it
provides no evidence of a net performance improvement. The prototype remains
isolated and is not enabled in the product.

A separate observer/profile run measured chair maintenance at 0.312 ms/render
(2,648 calls). Its first fixed-camera oracle had exact AA/BB/AB pixels and
28 native versus 6 instance submissions, but hiding chairs changed zero pixels:
they were occluded, so the oracle correctly skipped acceptance. A subsequent
focused dining-chair view proved 415,396 pixels of chair contribution. AA and BB
were stable; AB differed at 1,039/2,073,600 pixels: 1,024 had maximum channel delta
1, and the remaining 15 reached delta14. No GL errors occurred, including the
normal subsequent render. The strict comparison did not pass; no tolerance was
relaxed. Floating-point transform grouping/rasterization is a possible cause,
not an established diagnosis. No broad visual-equivalence claim is made.

Bounded audio cue diagnostics recorded 36 first-buffer events with zero overflow
in the complete full-AI window. Fifteen were true PCM misses: 132.3 ms total
lookup/generation, while all first AudioBuffer creation/copies totalled 3.9 ms.
K9's first howl alone took 44.5 ms lookup/generation and 44.7 ms including copy,
inside a 77.3 ms interval. However, the largest three intervals (221.9/203.3/
157.6 ms) had no such cache work. Subtracting measured cache-work intersections
and re-sorting all intervals changes this diagnostic run's hypothetical 1% low
from 16.26 to 16.89 FPS. This is a counterfactual estimate, not a measured Worker
or warmup benefit. Script outputs still matched all eight baseline exports.

Audio created increased by 112,529 in the diagnostic window. Footstep, impact
and casing cue increments account for 86,902 of those nodes. These procedural
paths have no existing PCM cache key; emptying bakeQ cannot eliminate them.
The next isolated candidate will await only the measured K9 howl PCM before
entry, while checking key selection/RNG/audio equivalence and readiness cost.
Node creation/cleanup remains a separate main-thread investigation.

The analyzer now explicitly rejects cue-audit and chair-update-observer runs
from performance acceptance. Current product core remains stage 3, High1080p,
reflection maximum30Hz. The 60FPS/1%low>45 target is still unmet. Raw-source
hashes, diagnostic boundaries and derived values are recorded in
[stage4-screening.json](evidence/stage4-screening.json).

## Stage 5: prioritize native audio churn

Same-run tracing pinned a 281.6 ms submitted-render interval to the renderer
main thread: a 31.992 ms MajorGC followed by a Web Audio deletion task posted
from RequestToDeleteHandlersOnMainThread. The latter consumed212.020 ms wall
and209.164 ms thread CPU. This identifies one long frame's owner; another
225.1 ms interval outside the short trace window remains unattributed.

Four complete native-AI diagnostics used the same instrumented core, with
normal dry sound versus omitting footstep/impact/casing dry-layer construction.
Spatial routing, RNG consumption, voice lifetime and stealing remained active;
all eight logical exports matched. Omitted layers are audibly muted, so this
is causal screening and cannot be a production performance optimization.

| Trace window / execution order | Nodes created in full scenario | Largest handler deletion | MajorGC total in trace |
|---|---:|---:|---:|
| Early, normal first |113,003|224.791 ms|38.898 ms|
| Early, omitted second |47,934|55.744 ms|13.041 ms|
| Late, omitted first |49,338|73.350 ms|17.027 ms|
| Late, normal second |114,232|133.079 ms|27.803 ms|

The second pair reversed ordering and observed ticks2400-3550 rather than
900-2100. Both support prioritizing transient-node churn. They do not isolate
node deletion from dry DSP, graph construction or allocation/GC changes, and
large complete-scenario intervals still occurred outside each trace window.
The next real candidate must preserve sound content, timing, RNG, spatial
routing and voice stealing while reducing that work.

An independent audio-host sandbox confirmed separate renderer PID/TID with
127.0.0.1 versus localhost in this Edge build. Parent-click autoplay worked.
In its tiny idle workload, all80 commands scheduled and the ten3ms onsets had
zero misses. A synthetic200ms child busy loop protected parent issue timing
relative to the same-renderer control, but25 commands became overdue; first
onset misses were3/10 at3ms lead and4/10 at32ms. This artificial test does not
measure actual game cleanup or speaker latency. Moving ownership alone can
trade game stalls for delayed audio and is not sufficient for adoption.

A separate product-core experiment requested CDP collectGarbage every120
logical ticks:29 requests, with every GC and subsequent delay retained. It
measured52.87FPS but1%low12.87FPS, P9959.4ms, maximum114.2ms and35.38
intervals>50ms/min. The previous product single run was50.72FPS/low17.01,
P9938.6ms and6.95 intervals>50ms/min. This cadence is rejected: a smaller
maximum and higher mean do not compensate for more slow frames. CDP round
trip includes transport/scheduling and is not pure GC CPU time.

Rendering screening also narrowed priorities. Twelve passive main/reflection
command samples could reduce only5-7 program transitions/view under the
conservative reorder barriers. Receiver geometry proved zero potential
reflection receivers for95/1409 eligible calls(6.742%), all in the final96
calls; one CPU-budget unknown failed open. Neither observer changed drawing.
These directions remain lower priority; no net sorting/gating gain is claimed.
A separate investigation now measures actual High MSAA resolve ownership,
while preserving4x main/FX/VM edges. Desktop Electron/Tauri reassessment is
research only and must compare actual versions and measured behavior.

Product runtime remains stage3. All new observer, dry-layer and forced-GC
flags are excluded from acceptance. The target remains unmet. Source hashes,
full diagnostic distributions, host scheduling evidence and limitations are
recorded in [stage5-audio-churn.json](evidence/stage5-audio-churn.json).

The renewed desktop-host feasibility review is recorded in
[Electron/Tauri reassessment](desktop-reassessment.md). It separates actual
runtime version differences from ownership/DSP changes, preserves full process
and shipping-package comparison requirements, and reports the failed controlled
GC/isolated-owner shortcuts. No desktop migration is enabled by that review.

## Stage 6: redundant MSAA resolves, correct pixels but no consistent FPS win

Passive native High observation counted29,073 explicit composer resolves over
3,277 gfx calls(8.872/call). All were1920x1080,4x MSAA-to-single color+depth;
no cross-target/unmapped/probe errors or aggregate summary drops occurred.
The default-off isolated candidate deferred only the AO copy before AO blend
and FX composite before layer2 geometry. Both final draws still resolved,
with unchanged allocations,4x samples, depth textures, shaders and draw order.

FX particles do consume world depth. Safety depends on the intermediate quad
not writing/clearing depth; that world depth was already resolved. The sampler
need not belong to a different target. The proof is limited to owned native
paths and their guarded callbacks, not arbitrary added layer2 objects/shaders.

Hardware ABBA passed exact AA/BB/AB pixels in the final scenario view and three
alive-player views. Draws stayed1339 in the first view and1368/944/1370 in the
alive views; explicit resolves fell8-to-6 and9-to-7 respectively. All captures
and the normal restoration render had GL0. Complete native AI retained all
eight logical exports. Functional High/scale/motion settings, real context
loss/restore, readiness, pointer lock and weapon switching passed. These prove
the controlled correctness/count cases, not a net performance improvement.

Two complete clean pairs then gave inconsistent performance directions:

| Pair / order | Original FPS /1%low | Candidate FPS /1%low | Original P95/P99 | Candidate P95/P99 |
|---|---:|---:|---:|---:|
| Original then candidate |54.11 /18.31|54.64 /19.22|29.8 /37.0ms|26.8 /35.4ms|
| Candidate then original |54.91 /18.30|54.16 /17.65|27.4 /37.9ms|28.4 /36.6ms|

All four runs retained the full3600-tick workload and eight logical exports.
The candidate reduces explicit operations, but neither full FPS nor full1%low
has an established consistent advantage. It remains isolated/default-off;
product code is not promoted. Small parameter-cache, sort and receiver-gate
changes also remain deferred while the main effort follows audio churn and
actual native loop request/callback timing.

This matched series disabled the common passive longtask/long-animation-frame
PerformanceObservers as well as per-pass profilers/timers. The portable runner
now follows that policy: performance-event observers are opt-in through its
diagnostic modes, and the raw result records the choice. Earlier isolated
readings may include the common observers, so their numerical differences are
not assigned to MSAA. All four runs used identical legacy RAF completion
polling; a separate diagnostic is checking actual request chains with interval
polling, to avoid adding an automation RAF chain. Submission capture still
requires the existing lightweight render wrapper; no physical-present claim
is made. See [stage6-msaa-screening.json](evidence/stage6-msaa-screening.json).
