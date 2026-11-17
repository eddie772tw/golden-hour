"""Run one to three paired seven-casing trials. Windows, Python 3.11+."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

from owned_job import launch
from report import analyze, summarize


def sha(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--godot", type=Path, required=True)
    parser.add_argument("--project", type=Path, default=here / "build/project")
    parser.add_argument("--core", type=Path, default=here.parents[1] / "game/core/game.js")
    parser.add_argument("--driver", choices=("Dummy", "WASAPI"), default="Dummy")
    parser.add_argument("--pairs", type=int, choices=(1, 2, 3), default=1)
    parser.add_argument("--out", required=True, type=Path)
    opt = parser.parse_args()
    exe = opt.godot.resolve(strict=True)
    project = opt.project.resolve(strict=True)
    core = opt.core.resolve(strict=True)
    dll = project / "bin/gh_audio.dll"
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node executable unavailable")
    out = opt.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    assets = out / "assets"
    os.environ["GH_GAME_CORE"] = str(core)
    subprocess.run([node, str(here / "fixtures.mjs"), str(assets)], check=True)
    inputs = {"game.js": core, "godot": exe, "node": Path(node), "gh_audio.dll": dll}
    inputs.update({name: assets / name for name in ("white.f32", "brown.f32", "buffers.json")})
    inputs.update({name: project / name for name in ("project.godot", "scene_audio.gd", "ipc.gd", "audio.gdextension")})
    (out / "runtime-hashes.json").write_text(json.dumps({k: sha(v) for k, v in inputs.items()}, indent=2))
    cases = []
    for index in range(opt.pairs):
        order = ("absolute", "untimed") if index % 2 == 0 else ("untimed", "absolute")
        for mode in order:
            case = out / f"{index + 1}-{mode}"
            launch([node, str(here / "run.mjs"), str(case), mode, opt.driver,
                    str(exe), str(assets), str(project)], here)
            cases.append(analyze(case, opt.driver))
    summary = summarize(cases, opt.driver)
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary["byContract"], indent=2))


if __name__ == "__main__":
    main()
