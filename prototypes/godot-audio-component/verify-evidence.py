"""Recompute Stage 23 device results from published observations without running an audio driver."""
import hashlib
import json
import math
from pathlib import Path

if not __debug__:
    raise SystemExit("Run without Python optimization to execute the evidence checks.")
here=Path(__file__).resolve().parent
ledger=json.loads((here.parents[1]/"docs/performance/evidence/stage23-godot-audio.json").read_bytes())
for file,expected in ledger["selectedEvidenceSHA256"].items():
    assert hashlib.sha256((here/"evidence"/file).read_bytes()).hexdigest()==expected,file
def close(a,b):return math.isclose(a,b,abs_tol=.00001,rel_tol=0)
for driver,expected in ledger["device"].items():
    trials=json.loads((here/"evidence"/(driver.lower()+"-observations.json")).read_bytes())
    for contract,summary in expected["contracts"].items():
        selected=[t for t in trials if t["contract"]==contract]
        assert len(selected)==3
        statuses=[];worker=[];callback=[];onset=[]
        for t in selected:
            assert t["driver"]==driver and t["mixRate"]==48000 and t["callbackFrameSizes"]==[512]
            assert len(t["cues"])==7 and t["rngDraws"]==124 and t["originalSteals"]==1 and sum(t["all14ReceiptStatuses"])==14
            upper=min(p["receivedMs"]-p["workerUs"]/1000 for p in t["pings"])
            tick_ms=1000/t["qpcFrequency"]
            qpc_upper=min(q["worker_us"]/1000-q["qpc_before"]*tick_ms+.001 for q in t["calibration"])
            for c in t["cues"]:
                statuses.append(c["status"])
                start=c["externalInvokeMs"]
                worker.append(c["workerIngressUs"]/1000+upper-start)
                callback.append(c["callbackDequeueUs"]/1000+upper-start)
                assert close(worker[-1],c["invokeToWorkerMs"][1])
                assert close(callback[-1],c["invokeToCallbackMs"][1])
                if c["status"]!=0:
                    assert "onsetQpc" not in c
                    continue
                first,last=c["onsetQpc"]
                assert c["callbackQpc"][0]<=first<=last<=c["callbackQpc"][1]
                assert c["callbackFirstFrame"]<=c["mixFrame"]<c["callbackFirstFrame"]+c["callbackFrameCount"]
                assert any(v!=0 for v in c["firstSamples"])
                onset.append(last*tick_ms+qpc_upper+upper-start)
                assert close(onset[-1],c["invokeToRenderedOnsetMs"][1])
        assert len(statuses)==summary["cues"]==21
        assert [statuses.count(k) for k in range(4)]==[summary["rendered"],summary["late"],summary["invalid"],0]
        for key,measured in [("Worker",worker),("Callback",callback),("RenderedOnset",onset)]:
            assert close(max(measured),summary["maxInvokeTo"+key+"MsUpper"])
        print(driver,contract,"rendered/late/invalid",statuses.count(0),statuses.count(1),statuses.count(2),
              "max callback/onset ms",round(max(callback),3),round(max(onset),3))
