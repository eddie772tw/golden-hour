# Bounded casing source graph experiment

This branch adds an opt-in browser experiment at `?solo&casingAudio=worklet`.
Omitting `casingAudio=worklet` retains the original audio graph and does not fetch
the experiment modules. This is a candidate for measurement, not an enabled
performance fix. No Electron, Tauri, Godot code or native binary is involved.

The original `eZ` / `T` allocator still admits casing voices, chooses category
and global victims, applies gains and fade targets, and releases them. Its
distance, head shadow, stereo delay/filter/merger, sfx bus, reverb send and
downstream master processing are retained. The original `S0` runs its existing
surface, shell, bounce and partials branches and consumes the same random draws.
Only the casing oscillator/noise/filter/envelope source subgraph is represented
by commands and rendered into one mono source for that voice.

Twelve persistent AudioWorklet source nodes are created before entry. Each gets
the existing white-noise PCM buffer, exercises all supported DSP branches, and
acknowledges readiness. `prepareCurrent` waits for that acknowledgement or a
bounded failure. The pool never displaces another voice. When it is unavailable,
exhausted, or rejects a descriptor, the entire voice uses the original source
graph immediately. Rejected descriptors replay the already consumed noise
offsets. They do not draw random values a second time. Unknown routing, waveform,
buffer, loop or extra descriptor properties use this fallback. Sample rates
other than 44.1 or 48 kHz also retain the original graph.

The finite pool copies the three-second mono white buffer twelve times (about
6.59 MiB at 48 kHz), plus processor state and browser overhead. The original
spatial graphs are still created per cue. DSP on the audio thread, command
allocation and MessagePort scheduling are additional costs. A lower source-node
count does not establish better browser frame times or audio latency. This is a
different experiment from the previous shared noise/SAB graph changes, and must
earn its own measured gain.

## Checks run without a browser or audio device

From this worktree:

```powershell
node --test server/casing-audio.test.mjs
npm test
git -c core.whitespace=cr-at-eol diff --check
```

The focused tests execute the actual owning audio code with a CPU hardware
boundary. They cover all ten current surface branches and both casing kinds at
time scales 0.35, 1 and 1.5; ordered RNG and descriptors; voice start/end, level,
admission and release; both directions of cross-family stealing at 56 voices;
original-graph equality when a lease or descriptor is rejected; pool exhaustion,
initialization failure and stale token handling. A full-array sweep triggered
inside a casing call retains ordered disconnects for expired other families.
DSP tests cover block partition,
source onset, stops, and fresh source state when receipt is late. They establish
logic and protocol properties, not browser DSP equivalence, 8-export full-game
acceptance, browser FPS or physical output latency.

## Root-only browser PCM oracle

No browser, GPU or audio device was started by this implementation task. On a
page served from this candidate, root can run:

```js
const { runCasingPCMOracle } = await import('/client/casing-pcm-oracle.js');
const result = await runCasingPCMOracle();
// Repeat with {sampleRate:44100} and relevant {timeScale:.35} / {timeScale:1.5}.
```

This developer module is never imported by normal startup. It fetches the
actual core, extracts `S0` and `T`, and changes only the diagnostic requested
start clock. Actual original WebAudio source nodes render in an
`OfflineAudioContext`. Their PCM is compared with the JS `CasingMixer` fed by the
same actual casing branches, random stream and white PCM. The output is a dry
source component comparison. It does not test Worklet transport, downstream
spatial/reverb output, or a physical audio device.

The four modes have separate meanings:

- `onTime`: both are issued before the requested start.
- `pastApi`: the context suspends at frame 1024, then both APIs are called with
  the old requested start. The original browser determines its past-start and
  automation semantics.
- `deliveryMiss`: the original graph is already scheduled on time. Only the
  candidate commands arrive at frame 1024. The original onset is unreachable;
  this is explicitly a missed-deadline case, never a timeline equivalence pass.
- `stealTail`: both sources start on time. At the suspended context's frame 1024,
  the actual original `M` steal path applies its 8 ms gain target and stops all
  sources 56 ms later. The candidate is checked against that tail and cutoff.

The oracle records requested/effective main start, every main issue time, arrival,
first nonzero samples, stop/steal time, onset difference, waveform error and correlation. The
initial on-time/past-API gate is an onset difference of at most one sample and
normalized RMSE at most 0.02. It remains pending until root actually runs it.
The custom oscillator and resampling/filter implementation are not presumed
bit-exact to a browser. Failed cases require correction or a narrower fallback;
they cannot be dismissed as an acceptable timbre change.

## Timing semantics and primary evidence

Past API calls and delayed Worklet delivery must remain distinct. W3C says a
past source start begins immediately. Chromium clamps API start time to the
current context time, computes source-frame rounding and fractional offsets,
and starts new source/filter state rather than reconstructing every missed
sample. The candidate consequently does not pre-render lost source history or
claim that a missed onset was preserved. Main-thread automation times are
carried separately from processor arrival. Low/high-pass Q uses dB; band-pass Q
is linear. These are hypotheses to verify against actual browser PCM as well
as source, especially across browser versions.

Primary references:

- [W3C Web Audio: scheduled source start](https://www.w3.org/TR/webaudio/#dom-audioscheduledsourcenode-start)
- [W3C Web Audio: BiquadFilter Q](https://www.w3.org/TR/webaudio/#dom-biquadfilternode-q)
- [Chromium scheduled source handler](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/webaudio/audio_scheduled_source_handler.cc)
- [Chromium buffer source handler](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/webaudio/audio_buffer_source_handler.cc)
- [Chromium oscillator handler](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/webaudio/oscillator_handler.cc)

## Remaining root acceptance gates

Inspect `GH.debug.ctx.audio._engine.casingAudio.stats`. A successfully exercised
lane needs `status === "ready"`, `warmed === 12`, submitted cues, and zero
processor errors. Record fallbacks, expired sources, API-past sources and
delivery misses. `timings` retains up to 2048 cue records with requested/effective
main frame, actual processor arrival and first nonzero source frame;
`timingDropped` must be reported if that bound is exceeded. These first samples
are before original gain/spatial/bus/reverb/master and are not device samples.

Root must run the PCM oracle and then paired full browser runs with 1080p High,
reflections at most 30 Hz, all nine full AI opponents, the same seed and 3600
ticks. Require all eight strict gameplay exports, unchanged audio/routing and
steal/release behavior, actual source/graph counts, process-tree memory, cold
start/entry, P95/P99 frame times and long-frame frequency. Compare against the
unmodified/default lane with profiling separated from primary timing runs.
Adopt only a distinct repeatable benefit without audible or scheduling
regressions. Measure event-to-physical-output latency separately against 20 ms;
only pursue 15–10 ms with evidence of headroom. A passing CPU test or offline
waveform comparison cannot satisfy that endpoint target.
