# Casing source allocation guard

This CPU experiment runs the repository's pinned game bundle through the public Gate A logic harness. The candidate uses the original casing function, random draw sequence and shared voice allocator. It builds a compact description of casing source count and lifetime in place of creating Web Audio nodes. The experiment runs the transform in memory. The game launches through its existing entry point.

## Run the guard

Use Python 3.10 or newer and Node 24.13 or newer. The public logic harness uses its pinned Canvas package and system fonts. Its installation and font requirements are described in [the logic prototype](../../godot-node-logic/README.md). From the repository root run:

```powershell
npm ci --prefix prototypes/godot-node-logic --ignore-scripts --no-audit --no-fund
python prototypes/godot-audio-component/source-bypass/verify.py
```

The guard loads the existing game source and public initial-world and browser-baseline fixtures. It runs two independent 3,600-tick scenarios, compares all eight gameplay exports and verifies the ordered virtual audio graph. By default it stores its captures in a temporary directory. To retain the captures and reproduce the construction benchmark, choose a fresh output directory outside the checkout:

```powershell
$out = Join-Path $env:TEMP ("gh-casing-" + [guid]::NewGuid())
$p = "prototypes/godot-audio-component/source-bypass"
python "$p/verify.py" --output $out
node --expose-gc "$p/construction.mjs" "$out/control/events.ndjson" "$out/construction.json"
```

Retaining the two captures requires approximately 170 MB. The benchmark reads the newly regenerated control corpus. Historical raw captures, audio buffers and compilers are unnecessary for this source guard.

## What is compared

The baseline created 24,374 casing nodes. The candidate created zero. After excluding the original casing-owned node IDs and normalizing subsequent allocations by creation order, all 683,918 remaining virtual graph operations match in sequence, target, values, listener timing and originating casing call. The candidate retained 316 disconnect operations for other-family cleanup inside casing calls.

All 929 casing calls preserve their original parameters, positions, listener basis, 14,854 ordered random draws and 7,673 logical source starts. The guard compares levels and lifetimes, all 11,178 mixed-family voice lifecycle records and the reference decisions of the shared allocator. One compact digest in expected.json pins these cue fields, original source IDs and victim/release IDs to an earlier full run of the unmodified bundle. The current replay regenerates the inputs. A second digest pins the ordered retained graph. The forced-capacity check verifies both directions of cross-family stealing at 56 active voices, including stopping a live gun tone at 56 ms when a casing steals its voice.

The source probe observes logical ownership and the virtual Web Audio boundary. Downstream native rendering, hardware scheduling and game-frame performance require separate measurements.

## Construction timing

In eight paired, alternating trials on Node v24.13.0 for Windows, each measured mode replayed the same 929-cue corpus 16 times. Each cue retained its original draw count, gain, onset, end and source count. The median issuing-thread CPU time per corpus was 85.97 ms for original construction and 2.44 ms for the compact path. The median paired decrease was 84.00 ms. Each control cue still allocated virtual nodes and scheduled their automation. Recording was disabled for both modes. The timed replay includes initialization, case-only voice sweeps and validation. It excludes log writes, transport, native mixing, browser Web Audio and the rest of the game. [Paired measurements](construction-result.json)
