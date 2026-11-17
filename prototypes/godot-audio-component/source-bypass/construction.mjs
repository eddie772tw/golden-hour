import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {patchCore} from "./patch.mjs";
import {VirtualAudioContext} from "../../godot-node-logic/virtual-audio.mjs";

const corpus=readFileSync(process.argv[2],"utf8")
    .trim().split("\n").map(line=>{
        const e=JSON.parse(line);
        return {t:e.anchorSeconds,pos:e.position,surface:e.surface,kind:e.kind,listener:e.listener,ts:e.ts,
            draws:e.uniform,end:e.voiceEnd,level:e.gain,start:e.voiceStart,n:e.sourceIds.length};
    });
const body=readFileSync(new URL("../../../game/core/game.js",import.meta.url),"utf8");
assert.equal(createHash("sha256").update(body).digest("hex"),"b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b");
const patched=patchCore(body);
const src=patched.slice(patched.indexOf("  var qc = Math.PI"),patched.indexOf("  var fo = eZ();"))
    .replace("    return zt;","    zt.sweep=v; return zt;");
const create=new Function("Math","__casing",src+"\nreturn eZ();");
const blank=()=>{};
const signature=v=>v.compactCasing?v.sourceCount:v.srcs.length;
function pass(enabled){
    let tape,index,ordinal=0,victims=0,releases=0,ownership=0;
    const math=Object.create(Math);
    math.random=()=>tape[index++];
    const api=create(math,{enabled,observe(op,v){
        if(op==="create")v.ordinal=++ordinal;
        if(op==="steal"){victims++;ownership=(ownership*31+v.ordinal)>>>0;}
        if(op==="release"){releases++;ownership=(ownership*31-v.ordinal)>>>0;}
    }});
    const ctx=new VirtualAudioContext();
    ctx.record=blank;
    const st=api._engine;
    Object.assign(st,{ctx,nyq:21600,revIn:ctx.createGain()});
    st.buf.white=ctx.createBuffer(1,3*48000,48000);
    st.bus.sfx=ctx.createGain();
    let exact=0,wallCueMs=0;
    const start=performance.now();
    for(const e of corpus){
        ctx.currentTime=e.t;
        [st.lx,st.ly,st.lz]=e.listener.position;
        [st.fx,st.fy,st.fz]=e.listener.forward;
        [st.rx,st.ry,st.rz]=e.listener.right;
        st.ts=e.ts;
        // The source tracker belongs to the mock endpoint; no audio renders in this probe.
        ctx.sources.clear();
        api.sweep();
        tape=e.draws;index=0;
        const before=performance.now();
        api.casing(e.pos,e.surface,e.kind);
        wallCueMs+=performance.now()-before;
        const v=st.voices.at(-1);
        if(index===tape.length && v.level===e.level && v.end===e.end && v.t===e.start && signature(v)===e.n)exact++;
    }
    const elapsed=performance.now()-start;
    assert.equal(exact,corpus.length);
    assert.equal(api._errors.length,0);
    return {loopWallMs:elapsed,wallCueMs,exact,ordinal,victims,releases,ownership};
}
function median(xs){
    const s=xs.slice().sort((a,b)=>a-b);
    return (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2;
}
function checkedPair(order,replays){
    const pair={};
    for(const mode of order){
        global.gc?.();
        const cpu=process.threadCpuUsage();
        let totalLoop=0,totalCue=0,run;
        for(let n=0;n<replays;n++){
            run=pass(mode==="bypass");
            totalLoop+=run.loopWallMs;totalCue+=run.wallCueMs;
        }
        const u=process.threadCpuUsage(cpu);
        pair[mode]={...run,loopWallMs:totalLoop/replays,wallCueMs:totalCue/replays,
            threadCpuMs:(u.user+u.system)/1000/replays};
    }
    for(const key of ["exact","ordinal","victims","releases","ownership"])
        assert.equal(pair.control[key],pair.bypass[key]);
    return pair;
}
for(let i=0;i<2;i++)checkedPair(i%2?["bypass","control"]:["control","bypass"],2);
const pairs=[];
for(let i=0;i<8;i++)
    pairs.push(checkedPair(i%2?["bypass","control"]:["control","bypass"],16));
const medianMetrics={};
for(const metric of ["threadCpuMs","loopWallMs","wallCueMs"]){
    const control=pairs.map(x=>x.control[metric]),bypass=pairs.map(x=>x.bypass[metric]);
    medianMetrics[metric]={control:median(control),bypass:median(bypass),
        pairedDelta:median(control.map((v,i)=>v-bypass[i])),controlRange:[Math.min(...control),Math.max(...control)],
        bypassRange:[Math.min(...bypass),Math.max(...bypass)]};
}
const result={runtime:process.version,platform:process.platform,corpus:corpus.length,warmupPairs:2,measuredPairs:pairs.length,
    replaysPerMeasuredLane:16,metricsUnit:"milliseconds per 929 cues",alternateOrder:true,forcedGCBeforeTrial:typeof global.gc==="function",recordingDisabled:true,medianMetrics,pairs};
writeFileSync(process.argv[3],JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(medianMetrics,null,2));
