"""CPU-only hashes and bounded evidence invariants; never launches Godot."""
from pathlib import Path
import hashlib, json

root = Path(__file__).resolve().parent
load = lambda path: json.loads((root / path).read_text(encoding="utf-8"))
manifest = load("manifest.json")
for row in manifest["files"]:
    path = root / row["path"]
    assert path.stat().st_size == row["bytes"], row["path"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"], row["path"]
marker = load("marker/planar-marker-gpu-1.json")
mips = load("rough-mips/planar-mips-gpu-1.json")
run = load("rough-mips/planar-mips-gpu-1.run.json")
assert marker["ok"] and mips["ok"] and run["launchValid"]
assert run["exitCode"] == 0 and not run["engineErrors"] and not run["sourceHashMismatches"]
for name, expected in run["sourceSHA256"].items():
    assert hashlib.sha256((root / "rough-mips" / name).read_bytes()).hexdigest() == expected, name
assert mips["actualTotalMipLevels"] == 10
assert all(row["base_compare"]["max_error"] == 0 for row in mips["cases"].values())
assert max(row["max_error"] for row in mips["lodSamplingWitness"]) < 0.03
assert max(row["max_error"] for row in mips["receiverFormulaWitness"]) < 0.03
over = mips["overhead"]
assert len([row for row in over["CPU_command_submission"] if row["phase"] == "cadence"]) == 45
assert len([row for row in over["GPU_queue_elapsed"] if row["phase"] == "cadence"]) == 15
assert over["GPU_coverage_complete"] is False and over["unobserved_GPU_serials"]
assert not mips["highParity"] and not mips["fullWorld"] and not mips["AIStarted"]
print(f'PASS: {len(manifest["files"])} file pins; bounded feature evidence valid; GPU population coverage remains15/45')
