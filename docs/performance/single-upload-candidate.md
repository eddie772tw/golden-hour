# Casing/debris upload candidate, 2026-11-18

Status: **isolated candidate, disabled by default; not promoted**. Baseline is
`c767e8f`. No change to High quality, geometry, audio routing, AI or physics is
intended. Do not interpret reduced buffer payload as a frame-rate improvement.

## Investigation

The latest previous browser round already adopted glass-shard dirty spans;
its independent ABBA did not establish a sustained FPS gain. This candidate
examines a different owner: `_w`'s 90-slot casing and 320-slot debris pools.
Each moving/fading/retiring slot previously marked the complete matrix buffer
for upload. Each spawn also marked the complete instance-color buffer.
Settled slots with more than one second remaining already skip matrix writes;
that behavior is retained. This is not the primary remaining bottleneck proven
by a new profile, just a bounded avoidable-upload candidate.

With `globalThis.__GH_SINGLE_UPLOAD_RANGES = true` **before core startup**, each
owned attribute retains one reusable dirty span. Writes union with all pending
spans until the actual Three uploader callback, including first allocation.
Simulation ticks do not clear spans. Reset marks the entire matrix buffer;
ring wrap may conservatively upload a large span. At most one sub-upload per
changed attribute is used. Replaced attributes without the owner's marker
fall back to full uploads. The candidate does not change renderer draw counts,
instance counts, collision, RNG, lifetimes or silhouette.

## Verified here

- Baseline complete Node suite: **176/176 passed**.
- Candidate complete Node suite: **182/182 passed**.
- Six new actual-source tests execute the real `_w` and bundled Three
  `WebGLAttributes`; only the GL transport is fake. These compare complete CPU
  arrays, emulated GPU bytes, pool occupancy/cursors and RNG against full-upload
  controls. Cases include first allocation, deferred ticks, retirement,
  wrap/overwrite, settled/fade/expiry, below-world cleanup, reset, callback
  preservation, backend recreation, foreign pending spans and default-off.
- One active casing: matrix+color payload **6,840 → 76 bytes**.
- One active debris slot: **24,320 → 76 bytes**.
- Both comparisons retain two upload calls; these are controlled mechanism
  results, not full-match traffic estimates or GPU-time measurements.

Reproduce the unit suite with `node --test server/*test.mjs`.

## Blocked and remaining gates

`python scripts/performance/check_single_uploads.py --browser /usr/bin/chromium`
contains a native WebGL2 whole-buffer readback oracle against the pinned original
baseline. The script checks CPU/GPU equality, physics/RNG/audio-side-effect hashes
at 14 checkpoints, including bounce audio and repeated no-op upload. **It has not
completed here**: Chromium cannot launch in this cloud execution environment,
reporting `process_singleton_posix.cc: socket() failed: Operation not permitted`.
The authorized out-of-sandbox retry reached the same failure. Python syntax was
checked, but this is not a native pass result. No workaround changed security
settings or browser sandbox policy. Backend recreation is not context loss.

Before promotion, run the native oracle, real gameplay/context-loss/quality-toggle
checks, and unchanged 1080p DPR1 High / reflection ≤30 Hz / nine native AI /
3,600-tick workload. Compare all eight logical exports and clean repeated baseline
and candidate runs, preserving first-use and long frames. Report mean FPS,
P95/P99, slowest-one-percent mean inverse and long-frame counts. A Linux software
renderer cannot substitute for the original Windows Edge / physical-GPU target.
No new FPS, 1% low or physical-audio-latency acceptance is claimed.
