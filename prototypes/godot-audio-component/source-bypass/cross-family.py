from collections import Counter
from pathlib import Path
import json
import sys

rows=json.loads(Path(sys.argv[1]).read_bytes())
report={}
for name in ["otherStealsCasing","casingStealsOther"]:
    a,b=sorted([r for r in rows if r["interaction"]==name],key=lambda r:r["enabled"])
    assert not a["enabled"] and b["enabled"]
    assert a["actions"]==b["actions"] and a["draws"]==b["draws"]
    counts=Counter(r["op"] for r in a["actions"])
    assert counts=={"create":57,"target":1,"steal":1,"release":57}
    assert a["victimEnd"]==b["victimEnd"]==.086
    assert a["victimCat"]==b["victimCat"]==("gun" if name=="casingStealsOther" else "casing")
    owners=[]
    for lane in [a,b]:
        sources=set(lane["victimPhysicalSources"])
        retained=lane["creationAndSteal"]
        stops=[r for r in retained if r["op"]=="stop" and r["id"] in sources]
        assert [(r["id"],r["at"]) for r in stops]==[(v,.056) for v in lane["victimPhysicalSources"]]
        owners.append(len(sources))
    if name=="otherStealsCasing": assert owners[0]>0 and owners[1]==0
    else: assert owners[0]==owners[1]>0
    report[name]={"lifecycle":dict(counts),"victim":a["victimCat"],"originalVictimSources":owners[0],"candidateVictimSources":owners[1],"stopSeconds":.056,"endSeconds":.086}
print(json.dumps(report,indent=2))
if len(sys.argv)>2: Path(sys.argv[2]).write_text(json.dumps(report,indent=2)+"\n")
