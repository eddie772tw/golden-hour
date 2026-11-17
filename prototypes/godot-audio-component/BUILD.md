# Rebuild and run the seven-casing probe

Use Windows x86-64, Node 24, CPython 3.11 or newer, CMake, Ninja, a C++20 LLVM-MinGW toolchain and a Godot Windows console executable. The verified build used Node 24.13.0, CPython 3.13.13, clang 22.1.5, CMake 4.3.2 and the Godot 4.7.2 console executable. Run these commands from this component's directory. Set `GODOT_CONSOLE` to the path of your console executable. The node probe reads `../../game/core/game.js` from the repository and checks its SHA-256 before evaluation.

```powershell
git clone https://github.com/godotengine/godot-cpp.git build/sdk
git -C build/sdk checkout --detach 27d9dd23c83871e0619fca5dc2cddfbfd69e926a
cmake -S extension -B build/native -G Ninja -DCMAKE_BUILD_TYPE=Release -DGODOTCPP_TARGET=template_release -DCMAKE_CXX_COMPILER=clang++ "-DGODOT_CPP_DIR=$((Resolve-Path build/sdk).Path)"
cmake --build build/native --parallel 8
node fixture.test.mjs
python run.py --godot "$env:GODOT_CONSOLE" --project build/native/project --driver Dummy --pairs 1 --out runs/dummy-1
```

CMake copies the project descriptors and scripts into `build/native/project` and links the GDExtension into its `bin` directory. The runner generates three-second white and four-second brown noise using the hash-checked game's own deterministic generator and verifies each plane against the archived SHA-256. It creates an empty one-shot registry since these seven casing calls use only noise and oscillators. The original broader asset bank included other effects' registered one-shots. The producer test hashes all 1,088 original Web Audio commands from nine calls at fixed logical times; the live trials read their own audio clocks. The callback-local mode here still builds an original JS graph for the probe. The separate source-bypass experiment measures bypassing graph construction.

For a device trial on the active Windows output, choose `--driver WASAPI` and a fresh output directory. `--pairs 3` alternates ordering over three pairs. The wrapper owns its Node and Godot child processes inside a Windows job, captures both clocks, and writes a fresh summary for the selected driver. The hardware and Dummy summaries each carry their own calibration and can be compared directly. `--core` selects the same hash-pinned game file from another checkout. For the standalone Node fixture check, `GH_GAME_CORE` selects its path.

The runner writes `runtime-hashes.json` for the actual game, Node, engine, rebuilt extension, project scripts and generated assets. Each mode produces its own `godot.log`, cue/worker traces, stereo Float32 PCM and `onset-report.json`. The summary counts applied, late and invalid records by mode. Output timing and the generated DLL hash can differ by toolchain and machine. The clean staged rebuild rendered 7/7 callback-local cues; the strict mode rendered 1/7, with five late and one invalid in that run. These observed counts are recorded separately from the archived device results.

Probe source files under `extension/` and `native/` come from the instrumented measurement build. Its recorded DLL SHA-256 was `9138dd6bf0cfa5dd9c5c1bd7e627b5b6cc44015e946a8a6c0631f2937cf75f05`. The clean relocated rebuild produced `eb282131a4ca1581e66a5047cafe8f746e75f2484279bf9b26e85a77e5f774a8`. CMake project/output path handling, input regeneration and executable discovery are adapted to a fresh checkout. The renderer records the first real nonzero prebus contribution separately per voice, outer callback QPC brackets and worker calibration. This captures software render timing.
