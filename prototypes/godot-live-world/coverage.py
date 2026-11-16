"""Read every capture3 JSON record with bounded memory; no scene/root reconstruction."""
import argparse
import array
import collections
import hashlib
import json
import pathlib
import sys
import time


class Reader:
    def __init__(self, path):
        self.file = open(path, encoding="utf-8")
        self.buf = ""
        self.pos = 0
        self.decoder = json.JSONDecoder()

    def space(self):
        while True:
            while self.pos < len(self.buf) and self.buf[self.pos].isspace():
                self.pos += 1
            if self.pos < len(self.buf):
                return self.buf[self.pos]
            self.buf = self.file.read(1024 * 1024)
            self.pos = 0
            if not self.buf:
                return ""

    def take(self, expected):
        assert self.space() == expected, (expected, self.buf[self.pos:self.pos + 80])
        self.pos += 1

    def value(self):
        self.space()
        size = 1024 * 1024
        while True:
            try:
                value, end = self.decoder.raw_decode(self.buf, self.pos)
                self.pos = end
                return value
            except json.JSONDecodeError:
                more = self.file.read(size)
                if not more:
                    raise
                self.buf = self.buf[self.pos:] + more
                self.pos = 0
                size = min(size * 2, 32 * 1024 * 1024)

    def members(self):
        self.take("{")
        first = True
        while self.space() != "}":
            if not first:
                self.take(",")
            key = self.value()
            self.take(":")
            yield key
            first = False
        self.take("}")

    def items(self):
        self.take("[")
        first = True
        while self.space() != "]":
            if not first:
                self.take(",")
            yield self.value()
            first = False
        self.take("]")


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as file:
        for part in iter(lambda: file.read(8 * 1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def typed_sha(code, values):
    result = array.array(code, values)
    assert result.itemsize == 4
    if sys.byteorder != "little":
        result.byteswap()
    return hashlib.sha256(result.tobytes()).hexdigest()


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--capture", required=True)
    cli.add_argument("--props", required=True)
    cli.add_argument("--receiver", required=True)
    cli.add_argument("--output", required=True)
    args = cli.parse_args()
    output = pathlib.Path(args.output)
    assert not output.exists(), "Refusing to overwrite evidence"
    start = time.perf_counter()
    props = json.loads(pathlib.Path(args.props).read_text())
    hello = json.loads(pathlib.Path(args.receiver).read_text())["sourceHello"]
    actor_map = {(int(s["actor"]), int(s["rigIndex"])): s["id"] for s in hello["skins"] if not s["firstPerson"]}
    geometries = {}
    materials = {}
    objects = []
    source = {}
    reader = Reader(args.capture)
    for key in reader.members():
        if key == "geometries":
            for gid in reader.members():
                geometry = reader.value()
                count = geometry["position"]["count"]
                index = geometry["index"]
                geometries[gid] = {
                    "id": geometry["id"], "type": geometry["type"],
                    "vertexCount": count, "indexCount": len(index) if index is not None else count,
                    "positionFloat32SHA256": typed_sha("f", geometry["position"]["values"]),
                    "indexUint32SHA256": typed_sha("I", index if index is not None else range(count)),
                    "frozenPose": geometry.get("frozenPose", False),
                    "nativeInstanceCount": geometry.get("nativeInstanceCount"),
                    "extraAttributes": geometry.get("extraAttributes", []),
                }
            print("GH_COVERAGE geometries", len(geometries), flush=True)
        elif key == "materials":
            for mid in reader.members():
                material = reader.value()
                materials[mid] = {k: material.get(k) for k in ("id", "type", "name", "shaderMaterial", "customCompile", "transparent", "side")}
        elif key == "objects":
            for obj in reader.items():
                obj["surfaces"] = [{k: s.get(k) for k in ("count", "start", "material", "slot", "mode")} for s in obj["surfaces"]]
                if isinstance(obj.get("instances"), dict):
                    obj["instances"] = {"count": obj["instances"]["count"]}
                if isinstance(obj.get("skin"), dict):
                    obj["skin"] = {"frozen": obj["skin"].get("frozen", True)}
                objects.append(obj)
            print("GH_COVERAGE objects", len(objects), flush=True)
        else:
            source[key] = reader.value()
    assert reader.space() == "", "Trailing JSON bytes"
    assert source["schema"] == "gh-godot-render-snapshot-v1"
    assert source["source"]["coreSHA256"] == hello["coreSHA256"] == props["source"]["coreSHA256"]
    prop_by_index = {p["sourcePropIndex"]: p for p in props["props"]}
    categories = {}
    reasons = collections.Counter()
    mapped_children = collections.Counter()
    inventory = []
    for obj in objects:
        geometry = geometries[obj["geometry"]]
        owners = obj.get("owners", [])
        actors = {(int(o["actor"]), int(o["rig"])): o for o in owners if o.get("kind") == "actor"}
        physics = [o for o in owners if o.get("kind") == "physics"]
        k9 = [o for o in owners if o.get("kind") == "k9"]
        category = "excluded-unmapped-dynamic"
        reason = ""
        proof = None
        if actors:
            if len(actors) != 1:
                reason = "ambiguous actor ownership"
            else:
                owner_key = next(iter(actors))
                if isinstance(obj.get("skin"), dict) and owner_key in actor_map:
                    category = "replaced-live-skin"
                    proof = {"liveSkinID": actor_map[owner_key], "owner": actors[owner_key]}
                else:
                    reason = "actor attachment/FPbody lacks accepted live output mapping"
        elif physics:
            if len(physics) != 1:
                reason = "ambiguous physics ownership"
            else:
                owner = physics[0]
                index = int(owner.get("propIndex", -1))
                if index >= 0 and owner.get("type") == "box" and not owner.get("temp", False):
                    prop = prop_by_index.get(index)
                    children = [c for c in prop["children"] if c["path"] == owner["path"]] if prop else []
                    if not prop:
                        reason = "initial prop needs original Node rest asset"
                    elif len(children) != 1:
                        reason = "capture child path missing/ambiguous in true original template"
                    else:
                        child = children[0]
                        expected = props["geometries"][child["geometry"]]["captureMatch"]
                        relative = owner.get("path", "")
                        full_path = obj.get("path", "")
                        root_path = full_path[:-len(relative)] if relative and full_path.endswith(relative) else full_path if not relative else ""
                        if not root_path or not root_path.endswith(":" + prop["name"]):
                            reason = "source owner root path/name differs"
                        elif geometry["frozenPose"] or isinstance(obj.get("skin"), dict):
                            reason = "posed geometry cannot be an original prop rest match"
                        elif any(geometry[k] != expected[k] for k in ("vertexCount", "positionFloat32SHA256", "indexUint32SHA256")):
                            reason = "original geometry fingerprint mismatch"
                        else:
                            category = "replaced-prop-rest-mapped"
                            mapped_children[index] += 1
                            proof = {"sourcePropIndex": index, "childPath": child["path"], "captureRootPath": root_path,
                                     "positionFloat32SHA256": geometry["positionFloat32SHA256"], "indexUint32SHA256": geometry["indexUint32SHA256"]}
                else:
                    reason = "temporary/noninitial original physics body needs true asset"
        elif k9:
            reason = "K9 custom part deformation unported"
        elif isinstance(obj.get("skin"), dict):
            reason = "unowned frozen skin is not a proven static world object"
        else:
            category = "static-or-unowned-source"
            reason = "Preserve original capture; no owner evidence authorizes removal"
        count = {"objects": 1, "vertexReferences": geometry["vertexCount"],
                 "instances": obj["instances"]["count"] if isinstance(obj.get("instances"), dict) else geometry.get("nativeInstanceCount") or 1,
                 "surfaceIndexReferences": sum(s["count"] for s in obj["surfaces"])}
        total = categories.setdefault(category, dict.fromkeys(count, 0))
        for k, v in count.items():
            total[k] += v
        if reason:
            reasons[category + ": " + reason] += 1
        inventory.append({"sourceID": obj["id"], "nativeID": obj["nativeID"], "name": obj["name"], "path": obj["path"],
                          "owners": owners, "geometry": obj["geometry"], "materials": obj["materials"],
                          "sourceVisible": obj["visible"], "sourceSkinMarked": isinstance(obj.get("skin"), dict),
                          "decision": {"kind": category, "reason": reason, "proof": proof}, "counts": count})
    report = {"schema": "gh-real-capture3-ownership-coverage-v1", "capture": {"path": args.capture, "bytes": pathlib.Path(args.capture).stat().st_size, "sha256": sha(args.capture)},
              "source": source, "props": {"path": args.props, "sha256": sha(args.props), "binary": props["binary"], "source": props["source"]},
              "helloSource": {"path": args.receiver, "sha256": sha(args.receiver), "coreSHA256": hello["coreSHA256"]},
              "categoryCounts": categories, "reasonCounts": dict(reasons),
              "mappedProps": len(mapped_children), "mappedChildren": sum(mapped_children.values()),
              "perProp": [{"index": p["sourcePropIndex"], "name": p["name"], "originalChildren": len(p["children"]), "matchedCaptureChildren": mapped_children[p["sourcePropIndex"]]} for p in props["props"]],
              "inventory": inventory, "geometryFingerprints": geometries, "sourceMaterialInventory": materials,
              "elapsedMs": (time.perf_counter() - start) * 1000, "gpu": False,
              "fullSceneParity": False, "highParity": False,
              "limits": ["All capture bytes parsed, original position Float32/index Uint32 hashes; no captured child matrix treated as root.",
                         "Canonical geometry identity is necessary but not material/child-animation/High parity.",
                         "Excluded dynamic records retained in inventory and must not be drawn as frozen tick240 objects.",
                         "Static-or-unowned preserves source by ownership evidence; it is not proof that every unowned item is static."]}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("mappedProps", "mappedChildren", "categoryCounts", "reasonCounts", "elapsedMs")}, indent=2))


if __name__ == "__main__":
    main()
