"""Small Dummy/headless startup control-flow checks. No GPU or world loaded."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--godot", type=Path, required=True)
ENGINE = parser.parse_args().godot.resolve()
BASE = [str(ENGINE), "--headless", "--path", str(ROOT), "--script", "res://launch-v3.gd", "--"]
rows = []
with tempfile.TemporaryDirectory(prefix="gh-observer-launcher-v3-") as folder:
    temp = Path(folder)
    cases = [
        ("missing_args", [], 2),
        ("invalid_limit", ["--observe-scene=res://launcher-fixture.tscn", f"--observe-output={temp / 'badlimit.json'}", "--observe-limit=no"], 2),
        ("missing_scene", ["--observe-scene=res://absent.tscn", f"--observe-output={temp / 'absent.json'}"], 2),
        ("valid_no_consumed_gpu_flag", ["--observe-scene=res://launcher-fixture.tscn", f"--observe-output={temp / 'valid.json'}"], 0),
        ("refuse_existing_output", ["--observe-scene=res://launcher-fixture.tscn", f"--observe-output={temp / 'valid.json'}"], 2),
    ]
    for name, args, expected in cases:
        result = subprocess.run(BASE + args, capture_output=True, text=True, encoding="utf8", errors="replace", timeout=10)
        assert result.returncode == expected, (name, result.returncode, result.stdout, result.stderr)
        assert "Assertion failed" not in result.stdout + result.stderr
        rows.append({"case": name, "exit": result.returncode, "expected": expected, "stdout": result.stdout, "stderr": result.stderr})
    startup = json.loads((temp / "valid.json.startup.json").read_text(encoding="utf8"))
    report = json.loads((temp / "valid.json").read_text(encoding="utf8"))
    assert startup["ok"] and startup["scene_added"], startup
    assert startup["gpu_profile_flag_verified"] is False
    assert report["gpu_validated"] is False
    assert report["physical_present_observed"] is False
    absent = json.loads((temp / "absent.json.startup.json").read_text(encoding="utf8"))
    assert absent["ok"] is False
    payload = {"schema": "godot-observer-launcher-v3-headless-tests", "gpu_measured": False, "world_loaded": False,
               "launcher_sha256": hashlib.sha256((ROOT / "launch-v3.gd").read_bytes()).hexdigest(),
               "cases": rows, "successful_fixture_startup": startup, "dummy_collector_report": report}
    (ROOT / "launcher-v3-headless-tests.json").write_bytes((json.dumps(payload, indent=2) + "\n").encode())
print(f"PASS {len(rows)} headless startup/lifecycle cases; GPU not measured")
