# Post-main: thread evidence and output-route stop gate

Browser integration was fast-forwarded to main at c041138; its hosted CI passed.
This follow-up continues on main with diagnostic tools and evidence only. The
tested game tree remains identical to f6a88e9/core dd22efd9. Godot code remains
on its validation branch and the unaccepted casing source experiment remains
on its own branch. No new engine or audio implementation is promoted here.

Compact raw hashes, thread identities, full arm ranges and native driver logs
are in [machine evidence](evidence/browser-post-main-2026-11-17.json).

## Main-thread work is directly observed

A lighter20s trace without the per-pass renderer observer identifies the page's
`CrRendererMain` by the explicit start/end UserTiming markers: PID577400,
TID546948. On that same thread, canonical `ThreadControllerImpl::RunTask`
events with `src_func=RequestToDeleteHandlersOnMainThread` total125.392ms over
5153 tasks; the largest is91.338ms wall/90.916ms thread CPU. One exact MajorGC
event is16.074ms wall/14.235ms thread CPU. Edge_RunTask mirrors, duplicate
events and partial window-boundary events are not added to these totals.

This independently confirms a substantial native audio-cleanup lead on the
renderer main thread. It is not a claim that every long frame or the separate
clean run's maximum has the same cause. Parent/child trace durations overlap;
thread wall durations can include waits. This diagnostic retains all eight
full-AI exports but is not primary FPS acceptance.

The first heavier capture used renderer UserTiming/counters and, because Edge
returned an empty category-discovery list, an empty category request selected
the default trace set. That775MB raw file is preserved. The subsequent harness
uses an explicit category fallback, and the lighter trace is156MB. Neither raw
trace is shipped in Git. The first capture also found a62.133ms native cleanup
task; its overhead prevents treating that value as an uninstrumented budget.

Sparse GPU samples from the first capture, restricted to active scripted
ticks1–3599, are:

| GPU interval | Samples | Mean ms | P95 ms | Max ms |
|---|---:|---:|---:|---:|
| Whole gfx.render |53|11.237|15.345|16.048|
| World |53|3.538|5.701|6.364|
| Reflection |21|3.342|4.984|5.021|
| Shadow |53|0.721|1.640|2.660|
| Postprocess |52|1.314|1.663|1.689|
| VM |46|0.244|0.313|0.379|

These inclusive intervals overlap. No disjoint/query errors occurred;40
completion/paused samples are excluded. Sparse timings under heavy diagnostics
are not a full population P95 or physical present measurement. Aggregate CPU
summaries include completion work and must not be used as an active-frame
budget. The measured catch-up upper bound remains25.100ms per60s, so broad
presentation decoupling remains lower priority than the observed long task.

## Numeric latencyHint does not rescue this browser configuration

The valid standalone screen is `audio-latency-hint-3`: ABBA repeated twice,
eight fresh48k contexts, six original dry metal/brass cues per arm, two seconds
of warmup and450ms cue spacing. Original S0/T source, PCM, RNG, graph shape and
sink metadata match. There are48 valid cue clock mappings, no console/network
errors or devicechange events. Every context closes before the next is created.

| Arm | Requested hint | Estimated event-to-requested-start range ms |
|---|---|---:|
|0|interactive|55.61–57.53|
|1|0.001|71.26–80.79|
|2|0.001|69.97–73.51|
|3|interactive|66.72–73.54|
|4|interactive|73.87–81.02|
|5|0.001|61.47–66.75|
|6|0.001|63.23–73.19|
|7|interactive|67.90–71.31|

All arms fail the20ms necessary-condition screen. All report baseLatency10ms;
the numeric request did not lower that observable value. The related output
timestamp mapping is used once; baseLatency/outputLatency are not added again.
This is a requested-start estimate for a dry source graph, not an acoustic or
WASAPI endpoint recording, full spatial/master graph or full-load acceptance.
Browser device IDs/labels are withheld; equal default sink metadata and no
devicechange cannot prove that Windows never rerouted the underlying endpoint.

Two earlier setup attempts remain intact and are excluded: command-line
inspection lacked the standard enable-automation flag, and the next attempt
encountered incidental favicon404s. The final probe explicitly supplies the
flag and a diagnostic favicon response while continuing to reject every actual
console/network error. No autoplay/fake/mute override is used.

Stop further DSP/pool/transport micro-optimization for this output configuration.
The20ms endpoint target remains unmet;15–10ms work has no supporting margin.
This does not establish that every browser/device route is inherently unable
to meet20ms. Use a bounded native endpoint measurement before any larger change.

## Limited native audio continuation

One frozen WASAPI period screen has three requests: default,5ms and3ms. All
actually select IAudioClient3 period480frames/10ms; the driver reports min=max=
fundamental480 at48k, eight channels, with512-frame mixer callbacks. There is
no actual period treatment contrast and no reason to repeat these settings.

Untimed cases render7/7 each with zero invalid/late reports; software maxima
are10.562/10.500/13.028ms. Absolute cases render1/7,5/7 and1/7, retaining all
late/invalid outcomes. Neither software onset nor the driver's10ms estimate is
an endpoint measurement or an advantage established over the browser. Only one
round is recorded. Astra owns the bounded loopback/clock-alignment preparation;
root serializes hardware runs. eConsole native and hidden browser default
endpoints must be identified before claiming the same endpoint.

Browser full60FPS and event-to-output20ms acceptance are still open. No full
Godot rewrite or High-equivalence claim follows from these component screens.
Local tests after the new probe:149 passed; stream parsing was also checked
with tiny input chunks, canonical/duplicate task handling and thread ownership.
