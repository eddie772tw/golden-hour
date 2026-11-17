import {openSync,writeSync,closeSync,mkdirSync} from "node:fs";
import {registerHooks} from "node:module";
import {resolve} from "node:path";
import assert from "node:assert/strict";
import {patchCore} from "./patch.mjs";
import {VirtualAudioContext} from "../../godot-node-logic/virtual-audio.mjs";
const args=process.argv.slice(2),enabled=args.includes("--bypass"),out=resolve(args[0]);
mkdirSync(out);
const root=new URL("../../godot-node-logic/",import.meta.url);
function writer(file){
    const fd=openSync(resolve(out,file),"wx");let buffer="";
    function flush(){if(buffer)writeSync(fd,buffer);buffer="";}
    return {add(row){buffer+=JSON.stringify(row)+"\n";if(buffer.length>=512*1024)flush();},close(){flush();closeSync(fd);}};
}
const audio=writer("audio.ndjson"),voices=writer("voices.ndjson"),events=writer("events.ndjson");
let current=null,ordinal=0,call=0;

const record=VirtualAudioContext.prototype.record;
VirtualAudioContext.prototype.record=function(op,data={}){
    audio.add({call:current?.call??null,tick:this.tick,clock:this.currentTime,op,...data});
    if(current){current.graphOps++;if(op==="node.create")current.nodeCreates++;}
    return record.call(this,op,data);
};
globalThis.__casingPatch=patchCore;
globalThis.__casingProbe={
    enabled,
    observe(op,v,state,extra={}){
        if(op==="create"){v.allocOrdinal=++ordinal;}
        const rec={op,ordinal:v.allocOrdinal,cat:v.cat,physicalOutId:v.out?.id??null,call:current?.call??null,
            tick:state.ctx.tick,time:state.ctx.currentTime,start:v.t,end:v.end,level:v.level,dying:v.dying,...extra};
        voices.add(rec);
        if(current && op==="steal")current.victims.push(v.allocOrdinal);
        if(current && op==="release")current.releaseIds.push(v.allocOrdinal);
    }
};
globalThis.__bindCasing=api=>{
    const casing=api.casing,state=api._engine;
    api.casing=function(position,surface,kind){
        const ctx=state.ctx;
        current={call:++call,tick:ctx.tick,anchorSeconds:ctx.currentTime,position:position?{x:position.x,y:position.y,z:position.z}:null,
            surface,kind,listener:{position:[state.lx,state.ly,state.lz],forward:[state.fx,state.fy,state.fz],right:[state.rx,state.ry,state.rz]},
            ts:state.ts,material:surface==="wood"?1:["marble","tile","glass"].includes(surface)?2:surface==="metal"?3:["carpet","fabric","foliage"].includes(surface)?4:surface==="water"?5:0,
            shell:kind==="shell",uniform:[],victims:[],releaseIds:[],nodeCreates:0,graphOps:0};
        const random=Math.random;
        Math.random=()=>{const value=random();current.uniform.push(value);return value;};
        try{casing.call(this,position,surface,kind);}finally{Math.random=random;}
        const v=state.voices.at(-1);assert.ok(v && v.cat==="casing");
        const sourceIds=v.srcs.map(s=>s.id);
        Object.assign(current,{voiceOrdinal:v.allocOrdinal,voice:v.out?.id??null,gain:v.level,rate:v.rate,voiceStart:v.t,
            voiceEnd:v.end,sourceIds,sourceCount:v.sourceCount??sourceIds.length,whiteAsset:state.buf.white.id,sfx:state.bus.sfx.id,
            revIn:state.revIn.id,active:state.active,stolen:state.stats.stolen});
        events.add(current);
        current=null;
    };
};
const loader=new URL("load-runtime.mjs",root).href;
const gate=new URL("authoritative-probe.mjs",root).href;
function replaceOnce(source,from,to){
    assert.equal(source.split(from).length,2,"Public Gate A entry point changed: "+from);
    return source.replace(from,()=>to);
}
registerHooks({load(url,ctx,next){
    const result=next(url,ctx);
    if(url!==loader && url!==gate)return result;
    let source=Buffer.from(result.source).toString();
    if(url===loader){
        source=replaceOnce(source,"vm.runInNewContext(source.slice(0,cutoff)",
            "context.__casing=globalThis.__casingProbe; vm.runInNewContext(globalThis.__casingPatch(source.slice(0,cutoff))");
    }else{
        source=replaceOnce(source,"r.audio.setVolumes({master:","globalThis.__bindCasing(r.audio);r.audio.setVolumes({master:");
        source=replaceOnce(source,"mkdirSync(new URL('./evidence/',import.meta.url),{recursive:true});","");
        source=replaceOnce(source,"new URL('./evidence/'+name+'.json',import.meta.url)",JSON.stringify(resolve(out,"gate-a.json")));
    }
    return {...result,source};
}});
try{await import(gate);}
finally{for(const stream of [audio,voices,events])stream.close();}
