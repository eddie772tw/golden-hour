"""Reproduce the source allocation and cross-family audit from two public Gate A runs."""
from bisect import bisect_left
from collections import Counter
from hashlib import sha256
from pathlib import Path
import argparse
import json
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
from graph import compare

HERE = Path(__file__).resolve().parent
FIELDS = "call tick anchorSeconds position surface kind listener ts material shell uniform gain rate voiceStart voiceEnd whiteAsset sfx revIn".split()
EXPORTS = "manifest seed equipment decisionTrace events checkpoints state coverage".split()

def read(path):
    return json.loads(path.read_bytes())

def rows(path):
    with path.open(encoding="utf8") as stream:
        for line in stream:
            yield json.loads(line)

def audit(output):
    control, bypass = output / "control", output / "bypass"
    expected = read(HERE / "expected.json")
    excluded = {r["id"] for r in rows(control / "audio.ndjson")
                if r["op"] == "node.create" and r["call"] is not None}
    sorted_ids = sorted(excluded)
    children = {}
    cleanup = Counter()
    life = Counter()
    for x, y in zip(rows(control/"voices.ndjson"), rows(bypass/"voices.ndjson"), strict=True):
        old, new = x.pop("physicalOutId"), y.pop("physicalOutId")
        assert x == y, ("lifecycle", x, y)
        if x["cat"] == "casing":
            assert old in excluded and new is None
        else:
            assert old not in excluded and new == old - bisect_left(sorted_ids, old)
        if x["op"] == "create":
            children[x["ordinal"]] = old
        if x["op"] == "release" and x["call"] is not None:
            cleanup[x["cat"]] += 1
        life[x["op"]] += 1
    count = draws = starts = steals = 0
    digest = sha256()
    for x, y in zip(rows(control/"events.ndjson"), rows(bypass/"events.ndjson"), strict=True):
        for k in FIELDS + ["voiceOrdinal","active","stolen","victims","releaseIds","sourceCount"]:
            assert x[k] == y[k], (x["call"], k)
        assert children[x["voiceOrdinal"]] == x["voice"]
        assert len(x["sourceIds"]) == y["sourceCount"]
        assert y["voice"] is None and not y["sourceIds"] and y["nodeCreates"] == 0
        witness = {k:x[k] for k in FIELDS}
        witness.update(voice=x["voice"], sourceIds=x["sourceIds"],
                       victims=[children[i] for i in x["victims"]], releaseIds=[children[i] for i in x["releaseIds"]])
        digest.update(json.dumps(witness, sort_keys=True, separators=(",",":")).encode()+b"\n")
        count += 1
        draws += len(y["uniform"])
        starts += y["sourceCount"]
        steals += len(y["victims"])
    ga, gb = [read(p/"gate-a.json") for p in (control, bypass)]
    for g in (ga, gb):
        assert g["fullFixturePassed"] and g["allEightExportsCompared"] and g["logicalTicksExecuted"] == 3600
        assert set(g["exportsEqual"]) == set(EXPORTS) and all(g["exportsEqual"].values())
        assert not g["audio"]["errors"]
    for k in EXPORTS:
        assert ga["scenario"][k] == gb["scenario"][k], k
    graph = compare(control, bypass, excluded)
    residual = Counter(r["op"] for r in rows(bypass/"audio.ndjson") if r["call"] is not None)
    result = {"calls":count,"draws":draws,"logicalSources":starts,"stealsDuringCasing":steals,
              "originalCueTraceSha256":digest.hexdigest(),"strictExports":EXPORTS,"voiceLifecycle":dict(life),
              "releasesWithinCasing":dict(cleanup),"candidateOpsWithinCasing":dict(residual),"graph":graph}
    assert result == expected, "Independent pinned audit failed: "+str(result)
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Create a new directory and retain raw captures (about 170 MB)")
    parser.add_argument("--check-existing", type=Path, help="Verify a directory containing completed control and bypass captures")
    args = parser.parse_args()
    if not __debug__:
        parser.error("Run without Python optimization so all checks execute")
    if args.output and args.check_existing:
        parser.error("Choose one output mode")
    scratch = None
    if args.check_existing:
        output = args.check_existing.resolve()
    else:
        if args.output:
            output = args.output.resolve()
            output.mkdir(parents=True, exist_ok=False)
        else:
            scratch = tempfile.TemporaryDirectory()
            output = Path(scratch.name)
        for lane in ("control","bypass"):
            subprocess.run(["node",str(HERE/"run.mjs"),str(output/lane), *(["--bypass"] if lane=="bypass" else [])],check=True)
    report = audit(output)
    with tempfile.TemporaryDirectory() as cross:
        evidence = Path(cross)/"ownership.json"
        subprocess.run(["node",str(HERE/"cross-family.mjs"),str(evidence)],check=True)
        subprocess.run([sys.executable,str(HERE/"cross-family.py"),str(evidence)],check=True)
    print(json.dumps(report,indent=2))
    if scratch: scratch.cleanup()

if __name__=="__main__":
    main()
