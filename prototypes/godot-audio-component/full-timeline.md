# Proposed full-timeline audio connection

The current executable covers the casing factory. The wider dry projection comes from a separate offline graph capture. The first integration step is a default-off observer that joins the original shared source methods to that capture. No new source family needs a factory rewrite for this step.

1. Observe the existing voice constructor and the final calls in `T.tone`, `T.noise` and `T.play`. `T.partials` calls `T.tone` and must not emit an extra record. Carry the logical voice allocation ordinal, per-voice source index, producer sample clock, target frames, gain/filter/frequency envelopes, actual random result or resolved offset, and routing destination. Audit later use of returned nodes before bypassing any allocation. Resolve immutable PCM at the original asset cache `p(J,Q)` and send its ID once registered. Preserve mono/stereo layout and separate audible exhaustion from voice lifetime: for a one-shot with an offset, the original lifetime calculation still uses the full buffer duration. [Owning voice and source methods](../../game/core/game.js#L31031)
2. Run the observer alongside the original nine-bot, 3,600-tick fixture. Match 4,521 original opens, 28,045 projected starts, 1,000 fades, 113 nonzero gain targets, 7,145 subsequent stops and 4,504 releases in exact source emission order. At 60 seconds, 17 owners and 90 layer IDs still exist. Compare the ordered stream and dry PCM, all eight gameplay exports, the random tape and shared lifecycle. Report each unmatched source. Start the join with all 966 gunshot one-shots, then mixed footsteps and impacts; keep the existing casing oracle as a regression test. The published 94.19% figure describes eligible graph shapes. It does not establish that these three hooks capture every one of them.
3. Give each layer one renderer while keeping one logical voice under the original allocator. Preserve `w/M/y/v/b` victim selection, gain changes, stops and sweep/disconnect order, including operations during another family’s invocation. Unsupported layers and node consumers keep their original graph path. A gain target or release on a mixed voice must reach the right layers on both sides. Validate a casing stealing a gun with a live tone and the reverse case before enabling mixed ownership. [Lifecycle implementation](../../game/core/game.js#L30992)
4. Send one ordered logical batch per original issue point. Expand layer descriptors inside native audio, retaining exact original onset, stop, gain targets and per-record receipts. Keep natural stop descriptors distinct from later explicit stops. Preserve admission-before-release or steal-before-open order as observed. Native-timed triggers remain a separate contract. For source-timed batches, record ingress, consumption and first audible sample and report early/late/invalid/missing outcomes. Sub-block application can handle a future target already in hand; it cannot recover audio already rendered. Keep the original latency policy explicit. The measured maximum is 423 records at one issue point and 516 in one rolling 4,096-frame interval. Test backpressure without loss or silent retiming.

## Coverage and unresolved work

| Source starts in the captured 60 seconds | Count |
| --- | ---: |
| All observed starts | 31,711 |
| Inside 9,191 named cue calls | 29,776 |
| Eligible dry starts | 28,045 (94.19% of named, 88.44% of all) |
| Original filters/noise/static oscillators in that projection | 23,844 |
| Single supported exponential sine sweep | 2,748 |
| Non-looping mono/stereo PCM | 1,453 |
| Named starts outside the projection | 1,731 |
| Outside named cue calls | 1,935 (1,903 update, 28 init, 4 other) |

The 1,731 named exclusions have one recorded first blocker each: 1,056 non-sine oscillators, 216 frequency modulation, 216 additional layer routes, 205 frequency automation, eight other oscillator-frequency automations, 16 other gain envelopes, ten starts outside voice ownership and four other looped PCM. The per-cue counts and exact categories are retained in [coverage evidence](evidence/dry-coverage.json). Calls without starts remain part of the game trace and allocator/RNG audit.

Of 28,045 projected starts, 27,176 have classified static/direct routes and 869 require dynamic panning. Classification does not render their output. The two-second prototype for the dominant delayed-ear family covered 840 of 896 starts in that slice. Remaining work includes position/listener updates, channel orientation and delay, dynamic Panner, shared bus gains/ducking, wet sends, convolution, master effects and final output. The offline dry mix exceeded unity on both channels; post-master waveform and device output require a separate comparison. Ambient/init/update sources and all excluded named layers must stay audible through their original renderer until supported. This plan leaves full-scene audio and real-time performance acceptance open.
