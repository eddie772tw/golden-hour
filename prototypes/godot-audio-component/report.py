"""Join original trigger, IPC, audio dequeue and first per-voice dry contribution."""
import csv
import json
from pathlib import Path

def load(path):
    return json.loads(path.read_bytes())
def read_ints(path):
    with path.open() as file:return [list(map(int,row)) for row in csv.reader(file)]
def require(ok,msg):
    if not ok:raise ValueError(msg)

def analyze(p,driver):
    r=load(p/"source.json")
    t=load(p/"device-trace.json")
    require(t["driver"]==driver and t["rate"]==48000,"driver/rate mismatch")
    require(t["qpc_frequency"]>0 and not t["onset_overflow"] and not t["callback_overflow"],"incomplete native trace")
    require(not t["issues"] and not t["cue_overflow"],"device trace verification failed")
    contract=r["contract"]
    callbacks=t["callbacks"]
    require(callbacks and all(n>0 and a<=b for _,n,a,b in callbacks),"invalid callback bracket")
    require(all(a[0]+a[1]==b[0] for a,b in zip(callbacks,callbacks[1:])),"gap in callback sample positions")
    rate=t["rate"]
    # Difference between Node milliseconds and native monotonic milliseconds.
    nl=max(ping["sendMs"]-ping["reply"]["workerUs"]/1000 for ping in r["pings"])
    nh=min(ping["reply"]["nodeMs"]-ping["reply"]["workerUs"]/1000 for ping in r["pings"])
    require(nl<=nh,"inconsistent producer clock calibration")
    tickms=1000/t["qpc_frequency"]
    # Allow one microsecond for truncation of native microsecond stamps.
    sync=[t[k] for k in ("calibration_start","calibration_end")]
    ql=max(k["worker_us"]/1000-k["qpc_after"]*tickms-.001 for k in sync)
    qh=min(k["worker_us"]/1000-k["qpc_before"]*tickms+.001 for k in sync)
    require(ql<=qh,"inconsistent callback clock calibration")
    onsets={int(v[0]):v for v in t["voices"]}
    require(len(onsets)==len(t["voices"]),"duplicate voice onset")
    stamps=dict(read_ints(p/"cue-callback.csv"))
    admissions={s:(a,b) for s,a,b in read_ints(p/"admission.csv")}
    cues=[x for x in r["records"] if x["op"]=="cue"]
    require(len(cues)==7 and r["draws"]==124 and r["stolen"]==1,"fixture RNG or lifetime drift")
    require(len(r["records"])==14 and r["finish"]["acked"]==r["finish"]["enqueued"]==14 and r["finish"]["retries"]==0,"incomplete transport")
    require(set(onsets)=={c["voice"] for c in cues if c["ack"]["status"]==0},"accepted cue missing onset or rejected cue audible")
    require(t["cue_receipts"]==[[c["seq"],c["voice"],c["ack"]["consumed"],c["ack"]["status"]] for c in cues],"native/network receipt mismatch")
    cases=[]
    for c in cues:
        seq=c["seq"];ack=c["ack"];b=r["batches"][c["batch"]];external=b["read"]["frame"]
        start=b["invokeMs"];worker=ack["ingressUs"]/1000;dequeue=stamps[seq]/1000
        before,after=admissions[seq]
        require(ack["ingress"]<=before<=after and before<=ack["consumed"] and worker<=dequeue<=ack["emitUs"]/1000,"out of order admission")
        entry=dict(seq=seq,voice=c["voice"],victim=b["cue"]["victim"],status=ack["status"],
                   externalInvokeMs=start,producerSendMs=b["sendMs"],workerIngressUs=ack["ingressUs"],
                   callbackDequeueUs=stamps[seq],externalReadFrame=external,
                   contractTargetFrame=c["target"] if contract=="absolute" else None,
                   sourceReferenceTargetFrame=c["target"],workerIngressFrame=ack["ingress"],
                   admissionFrameBracket=[before,after],callbackFrame=ack["consumed"],
                   invokeToSendMs=b["sendMs"]-start,invokeToWorkerMs=[worker+nl-start,worker+nh-start],
                   workerToCallbackMs=dequeue-worker,invokeToCallbackMs=[dequeue+nl-start,dequeue+nh-start],
                   sourceReferenceSlackAtIngressFrames=c["target"]-ack["ingress"],
                   sourceReferenceSlackAtCallbackFrames=c["target"]-ack["consumed"])
        if ack["status"]==0:
            _,frame,lft,rgt,q0,q1=onsets[c["voice"]]
            cb=next((v for v in callbacks if v[0]<=frame<v[0]+v[1]),None)
            require(cb and cb[2]<=q0<=q1<=cb[3] and max(abs(lft),abs(rgt))>0,"invalid mixed onset")
            anchor=external if contract=="absolute" else ack["consumed"]
            onset=(anchor/rate+.003)*rate
            entry.update(mixFrame=frame,firstSamples=[lft,rgt],targetFirstStart=onset,
                         sampleOffsetFromScheduledStart=frame-onset,
                         callbackFrameCount=cb[1],callbackFirstFrame=cb[0],callbackQpc=cb[2:],
                         onsetQpc=[q0,q1],invokeToRenderedOnsetMs=[q0*tickms+ql+nl-start,q1*tickms+qh+nh-start],
                         callbackDequeueToRenderedOnsetMs=[q0*tickms+ql-dequeue,q1*tickms+qh-dequeue])
        cases.append(entry)
    report=dict(driver=driver,contract=contract,outputDevice=t["output_device"],rate=rate,
                reportedOutputLatencySeconds=t["output_latency_seconds"],callbackFrameSizes=sorted({x[1] for x in callbacks}),producerClockUncertaintyMs=nh-nl,
                qpcMappingUncertaintyMs=qh-ql,cues=cases,receipts=r["results"],
                deadlineMisses=sum(c["status"]==1 for c in cases),invalid=sum(c["status"]==2 for c in cases))
    (p/"onset-report.json").write_text(json.dumps(report,indent=2))
    return report

def summarize(cases,driver):
    groups={}
    for name in ("absolute","untimed"):
        rows=[x for c in cases if c["contract"]==name for x in c["cues"]]
        ok=[r for r in rows if r["status"]==0]
        groups[name]=dict(cues=len(rows),rendered=len(ok),late=sum(r["status"]==1 for r in rows),
            invalid=sum(r["status"]==2 for r in rows),
            maxInvokeToCallbackMsUpper=max(r["invokeToCallbackMs"][1] for r in rows),
            maxInvokeToWorkerMsUpper=max(r["invokeToWorkerMs"][1] for r in rows),
            maxInvokeToRenderedOnsetMsUpper=max((r["invokeToRenderedOnsetMs"][1] for r in ok),default=None))
    return dict(driver=driver,byContract=groups,runs=cases)
