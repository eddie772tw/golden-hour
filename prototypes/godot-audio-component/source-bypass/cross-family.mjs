import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {VirtualAudioContext} from "../../godot-node-logic/virtual-audio.mjs";
import {patchCore} from "./patch.mjs";
const core=readFileSync(new URL("../../../game/core/game.js",import.meta.url),"utf8");
assert.equal(createHash("sha256").update(core).digest("hex"),"b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b");
const transformed=patchCore(core);
const raw=transformed.slice(transformed.indexOf("  var qc = Math.PI"),transformed.indexOf("  var fo = eZ();"));
const make=new Function("Math","__casing",raw.replace("    return zt;","    zt.openTestVoice=options=>new T(null,options); zt.sweep=v; return zt;")+"\nreturn eZ();");
function run(enabled,interaction){
    const graph=[],actions=[],draws=[];
    const ctx=new VirtualAudioContext();
    const record=ctx.record;
    ctx.record=function(op,data={}){graph.push({op,...data});record.call(this,op,data);};
    let ordinal=0;
    const math=Object.create(Math);
    math.random=()=>{draws.push(.4);return .4;};
    const api=make(math,{enabled,observe(op,v,o,extra={}){
        if(op==="create")v.allocOrdinal=++ordinal;
        actions.push({op,ordinal:v.allocOrdinal,cat:v.cat,start:v.t,end:v.end,dying:v.dying,time:o.ctx.currentTime,...extra});
    }}),state=api._engine;
    state.ctx=ctx;state.buf.white=ctx.createBuffer(1,144000,48000);state.bus.sfx=ctx.createGain();state.revIn=ctx.createGain();
    const casing=()=>api.casing(null,"marble","brass");
    if(interaction==="otherStealsCasing")casing();
    const capacities=[["gun",18],["impact",10],["step",8],["foley",8],["misc",12]];
    let left=56-state.active;
    for(const [cat,cap] of capacities)for(let i=0;i<cap&&left;i++,left--){
        const v=api.openTestVoice({cat,prio:5});
        if(cat==="gun" && i===0)v.tone({f:440,d:.2,g:.3});
    }
    assert.equal(state.active,56);
    const split=graph.length;
    if(interaction==="otherStealsCasing")api.openTestVoice({cat:"ui",prio:5});else casing();
    const creationAndSteal=graph.slice(split);
    assert.equal(state.active,56);
    assert.equal(state.stats.stolen,1);
    const victim=state.voices.find(v=>v.dying);
    assert.equal(victim.allocOrdinal,1);
    assert.equal(victim.cat,interaction==="otherStealsCasing"?"casing":"gun");
    const victimPhysicalSources=victim.srcs.map(s=>s.id);
    const stoppedAtVictimDeadline=creationAndSteal.filter(e=>e.op==="stop" && e.at===.008*7).map(e=>e.id);
    assert.deepEqual(stoppedAtVictimDeadline,victimPhysicalSources);
    if(interaction==="casingStealsOther")assert.equal(victimPhysicalSources.length,1);
    const victimEnd=victim.end;
    ctx.advance(1,60);api.sweep();
    assert.equal(state.active,0);assert.equal(state.voices.length,0);assert.deepEqual(api._errors,[]);
    return {interaction,enabled,actions,draws,victimCat:victim.cat,victimEnd,
        victimPhysicalSources,creationAndSteal,originalAndCompactVoicesReleased:actions.filter(a=>a.op==="release").length};
}
const all=[];
for(const interaction of ["otherStealsCasing","casingStealsOther"]){
    const lanes=[run(false,interaction),run(true,interaction)];
    assert.deepEqual(lanes[0].actions,lanes[1].actions);
    assert.deepEqual(lanes[0].draws,lanes[1].draws);
    assert.equal(lanes[0].victimEnd,lanes[1].victimEnd);
    all.push(...lanes);
}
writeFileSync(process.argv[2],JSON.stringify(all,null,2),{flag:"wx"});
console.log(all.map(x=>[x.interaction,x.enabled,x.victimCat,x.actions.length,x.originalAndCompactVoicesReleased]));
