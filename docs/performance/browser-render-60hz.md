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
