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
