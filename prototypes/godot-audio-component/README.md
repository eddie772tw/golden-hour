# Stage 23 · Godot audio source and device validation

This component connects one original eZ casing factory to a native audio mixer and separately verifies a default-off source-side graph bypass. The device experiment exercises seven unpositioned casing calls per trial. The 3,600-tick experiment checks the original game and allocator on a full AI trace. They exercise different boundaries. Full-scene device playback is still open.

The current acceptance target is event-trigger to audio output within20ms. Further work toward15–10ms is justified only by evidence that the smaller range is achievable. The archived maximum20.875ms already exceeds20ms inside the software mixer; endpoint/speaker latency remains unmeasured. Preloaded PCM and an already-running stream do not establish that the callback and output deadlines are met.

## Device results

| Driver | Trigger contract | Rendered / late / invalid of 21 | Call to worker max | Call to callback max | Call to rendered onset max |
| --- | --- | ---: | ---: | ---: | ---: |
| WASAPI | Original absolute target | 12 / 8 / 1 | 6.067 ms | 18.810 ms | 18.884 ms |
| WASAPI | Untimed external trigger | 21 / 0 / 0 | 5.357 ms | 20.737 ms | 20.875 ms |
| Dummy | Original absolute target | 19 / 2 / 0 | 5.670 ms | 78.981 ms | 79.176 ms |
| Dummy | Untimed external trigger | 21 / 0 / 0 | 7.450 ms | 87.170 ms | 87.264 ms |

Values are the maximum upper endpoints of the same-host clock bounds in three short trials per contract and driver. Each trial preserved 124 original random draws, one original victim selection, seven cue receipts and seven cleanup receipts. The absolute case keeps its original anchor and reports expired targets or invalid dependencies. The untimed case establishes its anchor when the native callback accepts the trigger; it can preserve the waveform relative to that origin while moving it on the external event timeline. The WASAPI runs used the default endpoint, 48 kHz, 512-frame callbacks and a reported output-latency estimate of 10 ms. The onset measurement identifies the **first nonzero contribution of the individual voice in the mixer**, including overlapping calls. The endpoint estimate is separate from those measurements. Physical speaker onset and a general latency bound remain unmeasured.

Run `python verify-evidence.py` to recompute the table offline from the [WASAPI observations](evidence/wasapi-observations.json) and [Dummy observations](evidence/dummy-observations.json). These files include selected raw sample positions, QPC intervals, clock calibration and original run hashes. See the [source build and device runner](BUILD.md) to reproduce the two contracts with freshly generated PCM. Actual runtime, engine, native library and fixture hashes are recorded for each rebuild. The archived hardware capture predates this portable build.

## Source-side bypass

The opt-in diagnostic skips creation of the original casing AudioNode graph. The original factory still consumes the same draws and the shared allocator still selects victims across families. Over the full 3,600-tick trace, 929 casing calls preserved 14,854 draws, 7,673 logical source starts and all 11,178 mixed-family voice lifecycle records. Eight original game exports matched. Casing-created nodes fell from 24,374 to zero; its calls retained 316 disconnect operations for shared cleanup. All 683,918 retained graph operations matched after allocation-ID normalization. Forced cross-family steals cover both a casing taking a live gun tone and another family taking a casing voice. See the [source-bypass guard](source-bypass/README.md).

In the separately warmed Node virtual-endpoint experiment, median issuing-thread CPU per 929 calls was 85.97 ms with graph construction and 2.44 ms with the bypass on the public rebuild. The median paired reduction was 84.00 ms. The measured section excluded recorder writes. These timings cover source construction and the mock endpoint; game frame time and end-to-end audio CPU were not measured.

## Full timeline

The prior offline projection handled 28,045 of 29,776 named cue starts and all 45,328 projected operations at their recorded issue frames. The complete trace contained 31,711 starts. The new seven-cue WASAPI run did not exercise that full trace. Previous full-trace Dummy deadline failures remain in the [Stage 23 evidence ledger](../../docs/performance/evidence/stage23-godot-audio.json). The [full-timeline integration plan](full-timeline.md) identifies the shared source methods, mixed ownership requirements, missing sounds, spatial routes, bus automation and reverb, with a gate before each transfer.
