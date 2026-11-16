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
