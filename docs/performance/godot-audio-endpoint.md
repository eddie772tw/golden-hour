# Provisional native audio endpoint screen

This evidence stays on `perf/godot-validation`. Browser core continues on main;
no native engine/audio component is promoted into that branch. This is one
isolated original marble casing, not a full High scene, spatial/master graph,
speaker recording or engine-migration acceptance.

After the browser numeric-hint screen failed its20ms estimated-start condition,
root ran the frozen native WASAPI period screen. Default/5ms/3ms requests all
selected the same480-frame/10ms driver period and512-frame mixer. Untimed7/7
samples per request reach software onset within10.562/10.500/13.028ms; absolute
cases retain all deadline failures. These are not endpoint timing results and
do not establish a period treatment effect.

Astra then prepared a separate eight-channel WASAPI loopback capture, and root
executed it once at the default period. The analyzer finds a candidate matching
the original dry reference at correlation0.999999684 (alternative0.8071), with
Node-factory-invoke→loopback-onset bounds99.4948–99.6299ms. It reports
`upperAtMost20Ms:false`. Packet/time-window checks complete, but this is not yet
an accepted timing comparison or evidence that Godot solves20ms.

An ownership gap must be resolved before accepting the route: the owned-process
record names console launcher PID579072 while the audio-session snapshot names
Godot executable PID560284. They may be parent/child, but matching names alone
do not prove that. The native console/multimedia default IDs match the capture
endpoint; the previous browser default endpoint was undisclosed, so neither
fact proves a cross-host same-endpoint comparison. Astra is auditing the
ancestry, clock mapping and the gap between software callback and endpoint.

The [compact evidence and immutable raw hashes](evidence/godot-audio-endpoint-screen.json)
retain the provisional result, owned PIDs, session snapshot, PCM/capture hashes,
configuration and raw local path. The new capture tooling and larger raw files
remain in the external workspace; this is not a portable source-package claim.
No global device/audio setting was changed. No full rewrite or additional
quality/latency claim follows from this screen.
