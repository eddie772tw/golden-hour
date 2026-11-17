import assert from "node:assert/strict";
import {coreSHA256,raw} from "./core.mjs";
import {endpoint} from "./endpoint.mjs";
export {coreSHA256};
assert.equal(raw.split("    return zt;").length,2);
const factory=new Function("Math",raw.replace("    return zt;","    zt.sweep = v; return zt;")+"\nreturn eZ();");
export function materialCode(surface){
    if(surface==="wood")return 1;
    if(["marble","tile","glass"].includes(surface))return 2;
    if(surface==="metal")return 3;
    if(["carpet","foliage","fabric"].includes(surface))return 4;
    return surface==="water"?5:0;
}
export function createCasingProducer({random=Math.random}={}){
    const front=endpoint(),math=Object.create(Math);
    let tape=null;
    math.random=()=>{
        const value=random();
        assert.ok(Number.isFinite(value) && value>=0 && value<1);
        if(tape)tape.push(value);
        return value;
    };
    const api=factory(math),state=api._engine;
    front.ctx.sampleRate=48000;
    Object.assign(state,{ctx:front.ctx,revIn:front.rev,nyq:front.ctx.sampleRate*.45});
    state.buf.white=front.white;state.bus.sfx=front.bus;
    const id=n=>front.ids.get(n);
    const snapshot=()=>state.voices.map(v=>({id:id(v.out),dying:v.dying,start:v.t,end:v.end}));
    return {invoke({op="casing",time,position=null,surface="marble",kind="brass",ts,listener}){
        assert.ok(Number.isFinite(time)&&time>=front.ctx.currentTime,"non-monotonic issue");
        front.ctx.currentTime=time;
        if(ts!==undefined)api.setTimeScale(ts);
        if(listener)api.setListener(...listener);
        const before=snapshot(),offset=front.commands.length;
        tape=[];
        if(op==="sweep")api.sweep();
        else if(op==="casing")api.casing(position,surface,kind);
        else throw Error("Unknown operation "+op);
        const uniform=tape;tape=null;
        assert.deepEqual(api._errors,[]);
        const after=snapshot(),beforeIds=new Set(before.map(v=>v.id)),afterIds=new Set(after.map(v=>v.id));
        const added=state.voices.filter(v=>!beforeIds.has(id(v.out)));
        assert.equal(added.length,op==="casing"?1:0);
        const v=added[0],voice=v?id(v.out):null,sourceIds=v?v.srcs.map(id):[];
        assert.ok(sourceIds.length<=16);
        const victims=before.filter(v=>!v.dying&&after.some(a=>a.id===v.id&&a.dying)).map(v=>v.id);
        const commands=front.commands.slice(offset);
        return {op,anchorSeconds:time,position,surface,kind,ts:state.ts,sampleRate:front.ctx.sampleRate,nyqHz:state.nyq,material:materialCode(surface),shell:kind==="shell",
            uniform,voice,gain:v?.level??null,sourceIds,nativeSourceIds:sourceIds.map((_,i)=>voice*16+i+1),
            victim:victims[0]??null,victims,releaseIds:before.filter(v=>!afterIds.has(v.id)).map(v=>v.id),
            before,after,active:state.active,stolen:state.stats.stolen,commands};
    }};
}
export function capture({steps,random}){
    const producer=createCasingProducer({random});
    return {coreSHA256,events:steps.map(s=>producer.invoke(s))};
}
