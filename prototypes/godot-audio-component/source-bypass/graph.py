"""Compare the complete retained graph at the mock context boundary, in order."""
from collections import Counter
from hashlib import sha256
from itertools import zip_longest
from pathlib import Path
import json

def root(value):
    if isinstance(value,str):
        prefix=value.split(".",1)[0]
        return int(prefix) if prefix.isdecimal() else None
    return value

def stream(path,drop,summary):
    ids={}
    digest=sha256()
    for line in path.open():
        r=json.loads(line)
        op=r["op"]
        obj=root(r["id"])
        if obj in drop:
            summary["removedOperations"][op]+=1
            if op=="node.create": summary["removedNodeKinds"][r["kind"]]+=1
            continue
        if op in ("node.create","buffer.create"):
            assert obj not in ids
            ids[obj]=len(ids)+1
        def norm(v):
            n=root(v)
            if n is None: return v
            return str(ids[n])+v[v.index("."):] if isinstance(v,str) else ids[n]
        r["id"]=norm(r["id"])
        if op=="connect": r["to"]=norm(r["to"])
        if op=="node.set" and r["key"]=="buffer" and isinstance(r.get("value"),int):
            r["value"]=norm(r["value"])
        summary["keptOperations"][op]+=1
        digest.update(json.dumps(r,separators=(",",":"),sort_keys=True).encode()+b"\n")
        yield r
    summary["canonicalSha256"]=digest.hexdigest()
    summary["keptObjects"]=len(ids)

def compare(control,candidate,excluded):
    def counters():
        return {k:Counter() for k in ["keptOperations","removedOperations","removedNodeKinds"]}
    a,b=counters(),counters()
    it=zip_longest(stream(control/"audio.ndjson",excluded,a),stream(candidate/"audio.ndjson",set(),b))
    for i,(x,y) in enumerate(it,1):
        if x!=y: raise ValueError(f"Retained graph diverged at {i}: {x!r} != {y!r}")
    assert a["canonicalSha256"]==b["canonicalSha256"] and a["keptOperations"]==b["keptOperations"]
    assert sum(a["removedNodeKinds"].values())==len(excluded)
    return {"keptRecords":i,"keptObjects":a["keptObjects"],"canonicalSha256":a["canonicalSha256"],"retainedByOperation":a["keptOperations"],"removedByOperation":a["removedOperations"],"removedNodeKinds":a["removedNodeKinds"]}
