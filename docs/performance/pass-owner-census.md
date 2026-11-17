# Pass × owner census and candidate implementation

2026-11-17. Implementation follows [optimization-routes](optimization-routes.md).
The active acceptance target remains original Edge, 1920×1080 High, reflections
at most 30 Hz, nine complete native AI bots and 3,600 fixed logical ticks.
Native audio endpoint ≤20 ms remains independent and unaccepted.

`game/client/pass-owner-census.js` is an explicit diagnostic module. Normal
startup does not import it. It counts actual GL draws, submitted triangles,
renderer parameter/uniform-list rebuilds and known-source upload payloads by
pass and owner. Timing uses bounded private sampling and never consumes game
RNG. CPU spans are inclusive main-JavaScript-thread wall times, not isolated
CPU execution or per-owner GPU cost. Existing render diagnostics supply
separate sparse, overlapping per-pass GPU command intervals.

An isolated client receives D/o0/h0 hooks with
`scripts/performance/prepare_owner_census.py --client <isolated-client>`.
The preparation tool refuses the owning checkout and records source hashes.
Run `run_browser.py --owner-census --render-dev --native-loop --quality high`
against that client, then use `analyze_owner_census.py` with a frozen baseline.
Only active, playing, visible ticks 1–3599 count. These runs never establish
clean FPS acceptance. Stop wrappers in reverse installation order.

V2 explicitly tags standalone instance attributes and reports shared arrays
separately. Private xorshift high-bit sampling avoids locking onto alternating
position/normal uploads. Unknown arrays remain disclosed. Buffer allocations
are separate from payloads; typed-array texture argument sizes are upper
bounds, not exact rectangle/offset consumption. Context loss or quality rebuild
requires a fresh diagnostic. Empty shadow invocations are not active shadow work.

## Recorded implementation checkpoint

Raw files and frozen candidate sources are under
`D:/Golden-Hour/outputs/browser-candidates-20261117/`.
`stage-checkpoint.json` records raw hashes and native GL results; `STATE.md`
records the pending work. The main runtime is still the previously reviewed
core at this checkpoint; candidate game changes are isolated.

| Diagnostic | Baseline | Isolated body + glass candidate |
|---|---:|---:|
| Active gfx frames | 3,216 | 3,190 |
| Glass-shard buffer payload | 627,379,200 bytes | 128,444,796 bytes |
| Full-AI logical outputs | 8/8 equal | 8/8 equal |
| Console / render observer errors | 0 | 0 |

The baseline uses census V1; its instance uploads could be unclassified and
shared arrays used the last registered owner. Those issues do not affect the
independently owned glass arrays. Its strided upload timing sample is not an
unbiased mean. The candidate uses V2. Frames differ slightly; the large payload
reduction is a mechanism result, not an isolated FPS or GPU-bandwidth result.

Baseline actor bodies submitted about 1.212 million triangles per gfx frame
across passes. The first candidate actually rejects body entries, preserving
child traversal and native shadow work. It passes the complete logical-output
comparison. Its bound-update CPU work is measurable and must be weighed against
saved submission/GPU work. Native admission, edge/pixel controls and clean
observer-off repeated comparisons remain required before promotion.

The glass candidate passed seven actual-source CPU/fake-backend tests and an
additional eleven-case **native WebGL2 buffer** oracle. Actual Ew simulation
and KG uploads produce identical whole-buffer readbacks, CPU data, RNG and
side effects across deferred updates, retirement, wrap, reset and toggles.
Backend recreation uses the same real context; it is not a context-loss test.
Buffer equivalence does not by itself establish full-scene pixel or FPS acceptance.

The isolated casing gain pool passed six native single-leaf byte comparisons.
All twelve dry/wet full-mix held-out baseline controls fail the preregistered
repeatability calibration, so that native gate is **blocked for promotion**.
Candidate and baseline both show tiny native mixing differences; this is not
evidence of candidate distortion and is not permission to silently widen a
tolerance. The audio candidate stays isolated and disabled.

## Pending gates

Finish native body position/pixel and visible-contribution/edge controls, then
run clean observer-off repeated baseline/candidate comparisons. Preserve all
first-use and long frames, report full-window FPS, P95/P99, 1% low and long-frame
frequency. Adopt only supported changes and verify the final main startup
configuration actually enables adopted work. Neither 60 FPS nor ≤20 ms audio
acceptance is claimed at this checkpoint.
