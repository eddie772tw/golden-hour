import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createCasingAudio, supportsCasingSources, casingSourceRejection } from "../game/client/casing-audio.js";
import { CasingMixer } from "../game/client/casing-worklet.js";

// CPU hardware boundary, not a browser AudioNode benchmark or a PCM oracle.
function context() {
  let ordinal = 0;
  const ctx = { currentTime: 0, sampleRate: 48000, commands: [],
    createBuffer(channels, length, rate) {
      const data = new Float32Array(length);
      return { duration: length/rate, getChannelData: () => data };
    },
    node(kind) {
      const node = { id: ++ordinal, kind, connect() {}, disconnect() { ctx.commands.push([this.id,"disconnect"]); } };
      for (const name of ["gain", "frequency", "Q", "detune", "playbackRate", "delayTime"]) {
        node[name] = { value: 1 };
        for (const method of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime",
          "cancelScheduledValues", "setTargetAtTime"])
          node[name][method] = (...args) => ctx.commands.push([node.id, name, method, ...args]);
      }
      node.start = (...args) => ctx.commands.push([node.id, "start", ...args]);
      node.stop = at => ctx.commands.push([node.id, "stop", at]);
      return node;
    },
  };
  for (const name of ["Gain", "Oscillator", "BufferSource", "BiquadFilter", "ChannelMerger", "Delay"])
    ctx["create"+name] = () => ctx.node(name);
  return ctx;
}

const core = readFileSync(new URL("../game/core/game.js", import.meta.url), "utf8");
const audio = core.slice(core.indexOf("  var qc = Math.PI"), core.indexOf("  var fo = eZ();"));
assert.ok(audio.includes("function eZ()"));
function run(enabled, { fallback = false, reject = false, interaction, timeScale = 1 } = {}) {
  const actions = [], cues = [], cueOriginals = [], draws = [], descriptors = [];
  let voiceOrdinal = 0, randomState = 8171, voice;
  const math = Object.create(Math);
  math.random = () => {
    randomState = (Math.imul(randomState, 1664525)+1013904223) >>> 0;
    const value = randomState/4294967296; draws.push(value); return value;
  };
  let source = audio;
  const swap = (a, b) => { assert.equal(source.split(a).length, 2, a); source = source.replace(a, b); };
  swap("    function b(J) {", '    function b(J) { observe("release",J,o);');
  swap("      let A0 = o.ctx.currentTime, N0 = J.out.gain;", '      observe("target",J,o,{constant:Q,target:J.level*i0}); let A0 = o.ctx.currentTime, N0 = J.out.gain;');
  swap("J.dying = true, o.active--, o.cats[J.cat]--;", 'J.dying = true, o.active--, o.cats[J.cat]--; observe("steal",J,o,{constant:Q});');
  swap("this.sum = Mt, o.voices.push(this)", 'this.sum = Mt, observe("create",this,o), o.voices.push(this)');
  swap("    return zt;", `    const tone=T.prototype.tone, noise=T.prototype.noise;
    for(const [kind,original] of [["tone",tone],["noise",noise]]) T.prototype[kind]=function(Q){
      if(this.cat==="casing") capture(kind,Q,this);
      return original.call(this,Q);
    };
    zt.open=options=>new T(null,options); zt.sweep=v; zt.fade=y;
    return zt;`);
  const ctx = context();
  const globals = { Math: math, console, performance, observe(op,v,o,extra={}) {
    if (op === "create") { v.ordinal = ++voiceOrdinal; voice = v; }
    actions.push({ op, ordinal:v.ordinal, cat:v.cat, t:v.t, end:v.end, level:v.level,
      dying:v.dying, active:o.active, ...extra });
  }, capture(kind,Q,v) { descriptors.push({kind,Q:{...Q},start:v.t,rate:v.rate,st:v.st}); } };
  const api = vm.runInNewContext(source+"\neZ();", globals), state = api._engine;
  state.ctx = ctx; state.ts = timeScale; state.nyq = 21600;
  state.buf.white = ctx.createBuffer(1,144000,48000);
  state.bus.sfx = ctx.createGain(); state.revIn = ctx.createGain();
  const leases = [];
  if (enabled) state.casingAudio = { lease(destination) {
    if (fallback) return null;
    assert.equal(destination,voice.sum);
    const lease = { stopAt: [], releases: 0, submit(commands,originals) { if(reject)return false; cues.push(commands);cueOriginals.push(originals); },
      stop(at) { this.stopAt.push(at); }, release() { this.releases++; } };
    leases.push(lease); return lease;
  } };
  const summaries = [], sharedDisconnects = [];
  function casing(surface,kind,position) {
    api.casing(position,surface,kind);
    const v=state.voices.at(-1);
    summaries.push({t:v.t,end:v.end,level:v.level,dist:v.dist,rate:v.rate,
      sources:v.casingCommands?.length ?? v.srcs.length, nodes:v.nodes.length});
  }
  if (interaction) {
    if (interaction === "otherStealsCasing") casing("marble","brass");
    let left=56-state.active;
    for (const [cat,cap] of [["gun",18],["impact",10],["step",8],["foley",8],["misc",12]])
      for(let j=0;j<cap&&left;j++,left--) {
        const v=api.open({cat,prio:5});
        if(cat==="gun"&&j===0)v.tone({f:440,d:.2,g:.3});
      }
    assert.equal(state.active,56);
    if (interaction === "casingSweepsOthers") {
      ctx.currentTime=1;
      const before=ctx.commands.length;
      casing("metal","shell");
      sharedDisconnects.push(...ctx.commands.slice(before).filter(c=>c[1]==="disconnect"));
      assert.ok(sharedDisconnects.length>=56,"original full-array sweep still disconnects expired other families");
      assert.equal(state.active,1); assert.equal(state.stats.stolen,0);
    } else {
    if (interaction === "otherStealsCasing") api.open({cat:"ui",prio:5}); else casing("metal","shell");
    assert.equal(state.active,56);
    assert.equal(state.stats.stolen,1);
    const victim=state.voices.find(v=>v.dying);
    assert.equal(victim.ordinal,1);
    if(victim.casingLease) assert.deepEqual(victim.casingLease.stopAt,[.008*7]);
    else assert.ok(ctx.commands.some(c=>c[0]===victim.srcs[0].id&&c[1]==="stop"&&c[2]===.008*7));
    }
  } else {
    for(const surface of ["water","carpet","fabric","foliage","wood","metal","marble","tile","glass","concrete"])
      for(const kind of ["brass","shell"]) {
        casing(surface,kind,{x:2,y:.1,z:1});
        ctx.currentTime+=.025;
        if(state.voices.length%3===0)api.sweep();
      }
  }
  ctx.currentTime=10; api.sweep();
  assert.equal(state.active,0); assert.equal(state.voices.length,0);
  assert.equal(api._errors.length,0);
  for(const lease of leases)assert.equal(lease.releases,1);
  // Check real own keys BEFORE JSON erases dest:undefined from T.partials.
  assert.ok(cueOriginals.every(supportsCasingSources),"raw actual source descriptors must pass the production guard");
  assert.ok(!cueOriginals.length || cueOriginals.flat().some(s=>s.kind==="tone" && Object.hasOwn(s.options,"dest")) || interaction,"normal brass exercised own dest key");
  return JSON.parse(JSON.stringify({ actions, draws, cues, cueOriginals, descriptors, summaries, sharedDisconnects, graph:ctx.commands }));
}

test("actual casing preserves RNG, logical starts/end, spatial level and mixed-family allocation/release", () => {
  for(const timeScale of [.35,1,1.5]) {
    const base=run(false,{timeScale}), candidate=run(true,{timeScale});
    assert.deepEqual(candidate.actions,base.actions);
    assert.deepEqual(candidate.draws,base.draws);
    assert.deepEqual(candidate.descriptors,base.descriptors);
    assert.ok(candidate.cueOriginals.every(supportsCasingSources),"all current casing branches are admitted by the actual guard");
    assert.deepEqual(candidate.summaries.map(({nodes,...v})=>v),base.summaries.map(({nodes,...v})=>v));
    assert.ok(candidate.summaries.reduce((n,v)=>n+v.nodes,0)<base.summaries.reduce((n,v)=>n+v.nodes,0));
    const commands=candidate.cues.flat();
    assert.equal(commands.length,base.summaries.reduce((n,v)=>n+v.sources,0));
    for(const c of commands) {
      assert.ok(c.kind==="tone" || ["lowpass","highpass","bandpass"].includes(c.type));
      assert.ok(c.frequency>0&&c.frequency<=21600);
      assert.ok(Number.isFinite(c.start+c.attack+c.hold+c.decay+c.gain));
    }
    assert.deepEqual(run(true,{fallback:true,timeScale}),base,"unavailable pool uses original graph, including RNG");
    const rejected=run(true,{reject:true,timeScale});
    assert.deepEqual(rejected.graph,base.graph,"whole-voice rejection replays original graph with original offsets");
    assert.deepEqual(rejected.draws,base.draws);
    assert.deepEqual(rejected.actions,base.actions);
  }
  for(const interaction of ["otherStealsCasing","casingStealsOther"]) {
    const base=run(false,{interaction}), candidate=run(true,{interaction});
    assert.deepEqual(candidate.actions,base.actions);
    assert.deepEqual(candidate.draws,base.draws);
  }
  const swept=run(false,{interaction:"casingSweepsOthers"}), compactSwept=run(true,{interaction:"casingSweepsOthers"});
  assert.deepEqual(compactSwept.actions,swept.actions);
  assert.deepEqual(compactSwept.sharedDisconnects,swept.sharedDisconnects);
});

test("bounded pool warms before lease; exhaustion, timeout, unsupported and processor error use fallback", async () => {
  const nodes=[];
  class Node {
    constructor(ctx,name,options) {
      assert.equal(name,"gh-casing-source"); assert.equal(options.outputChannelCount[0],1);
      this.messages=[]; this.port={postMessage:data=>this.messages.push(data)};
      this.disconnects=0; nodes.push(this);
      queueMicrotask(()=>this.port.onmessage({data:{type:"ready"}}));
    }
    connect(to) { this.destination=to; }
    disconnect() { this.disconnects++; }
  }
  const white={sampleRate:48000,getChannelData:()=>new Float32Array([1,0])};
  const pool=createCasingAudio({sampleRate:48000,audioWorklet:{async addModule(url){assert.ok(url.pathname.endsWith("casing-worklet.js"));}}},white,{Node,slots:2});
  assert.equal(pool.lease({}),null);
  await pool.ready; assert.equal(pool.stats.status,"ready");
  const a=pool.lease("first"), b=pool.lease("second");
  assert.equal(pool.lease({}),null); assert.equal(pool.stats.peak,2);
  const commands=[{kind:"tone",start:.003,issuedAt:0}],originals=[{kind:"tone",options:{f:440}}];
  a.submit(commands,originals); a.stop(.056); a.release(); a.release();
  const c=pool.lease("third"); c.submit(commands,originals); b.release(); c.release();
  assert.equal(pool.stats.leased,0);
  assert.deepEqual(nodes[0].messages.map(m=>m.type),["cue","stop","release","cue","release"]);
  assert.deepEqual(nodes[0].messages.map(m=>m.token),[1,1,1,2,2]);
  nodes[0].port.onmessage({data:{type:"accepted",leadFrames:-19}});
  assert.equal(pool.stats.lateCues,1); assert.equal(pool.stats.maxLateFrames,19);
  nodes[0].onprocessorerror(); assert.equal(pool.stats.processorErrors,1); assert.equal(pool.lease({}),null);
  const unsupported=createCasingAudio({},white,{Node}); await unsupported.ready;
  assert.equal(unsupported.stats.status,"unsupported"); assert.equal(unsupported.lease({}),null);
  const timeout=createCasingAudio({sampleRate:48000,audioWorklet:{addModule:()=>new Promise(()=>{})}},white,{Node,timeoutMs:5});
  await timeout.ready; assert.equal(timeout.stats.status,"failed"); assert.equal(timeout.lease({}),null);
  const partialNodes=[];
  class Broken extends Node { constructor(...args) { if(partialNodes.length)throw Error("no slot"); super(...args);partialNodes.push(this); } }
  const partial=createCasingAudio({sampleRate:48000,audioWorklet:{async addModule(){}}},white,{Node:Broken,slots:2});
  await partial.ready; assert.equal(partial.stats.status,"failed"); assert.equal(partialNodes[0].disconnects,1);
  for(const options of [{f:440,type:"triangle"},{f:440,detune:12},{f:440,dest:{}},{f:440,loop:true}])
    assert.equal(supportsCasingSources([{kind:"tone",options}]),false);
  assert.equal(supportsCasingSources([{kind:"noise",options:{f:440,type:"bandpass",buf:"brown"}}]),false);
  const unsupportedRate=createCasingAudio({sampleRate:96000,audioWorklet:{}},white,{Node});
  await unsupportedRate.ready;assert.equal(unsupportedRate.stats.status,"unsupported");
});

test("casing DSP has chunk-invariant on-time onset/stop; late sources start with fresh phase/filter state", () => {
  for(const rate of [44100,48000]) {
    const white=Float32Array.from({length:rate*3},(_,i)=>Math.sin(i*13.712)*.4);
    for(const kind of ["tone","noise"])for(const type of ["bandpass","highpass","lowpass"]) {
      const commands=[{kind,type,start:.013,attack:.001,hold:.002,decay:.04,gain:.4,
        frequency:1700,frequency1:kind==="tone"?500:0,frequencyTime:.02,q:1.3,
        offset:.037,noiseRate:1.12}];
      const whole=new CasingMixer(rate,white); whole.cue(commands,0);
      const reference=new Float32Array(8192); whole.render(reference,0);
      assert.ok(reference.every(Number.isFinite));
      const first=reference.findIndex(v=>v!==0);
      assert.ok(first>=Math.ceil(.013*rate)&&first<=Math.ceil(.013*rate)+2);
      assert.ok(reference.some(v=>Math.abs(v)>.001));
      const chunked=new CasingMixer(rate,white); chunked.cue(commands,0);
      const output=new Float32Array(8192);
      for(let frame=0;frame<8192;frame+=128)chunked.render(output.subarray(frame,frame+128),frame);
      assert.deepEqual(output,reference);
      const lateFrame=2048, late=new CasingMixer(rate,white); late.cue(commands,lateFrame);
      const tail=new Float32Array(8192-lateFrame); late.render(tail,lateFrame);
      assert.notDeepEqual(tail,reference.subarray(lateFrame),"late source did not render its earlier history");
      assert.equal(late.sources[0].frame,late.sources[0].stop);
      const stopped=new CasingMixer(rate,white); stopped.cue(commands,0); stopped.stopFrame=Math.ceil(.025*rate);
      const stopOutput=new Float32Array(8192); stopped.render(stopOutput,0);
      assert.deepEqual(stopOutput.subarray(0,stopped.stopFrame),reference.subarray(0,stopped.stopFrame));
      assert.ok(stopOutput.subarray(stopped.stopFrame).every(v=>v===0));
    }
  }
});

test("actual processor warms DSP before ready, reports onset and ignores stale token stops/releases", () => {
  let Processor;
  const scope={sampleRate:48000,currentFrame:0,Float32Array,Math,
    AudioWorkletProcessor: class { constructor() { this.port={messages:[],postMessage(data){this.messages.push(data);}}; } },
    registerProcessor(name,klass) { assert.equal(name,"gh-casing-source"); Processor=klass; }};
  const source=readFileSync(new URL("../game/client/casing-worklet.js",import.meta.url),"utf8").replace("export class CasingMixer","class CasingMixer");
  vm.runInNewContext(source,scope);
  const node=new Processor({processorOptions:{white:Float32Array.from({length:144000},(_,i)=>Math.sin(i))}});
  assert.equal(node.mixer.sources.length,0,"warm sources are cleared before ready");
  assert.equal(node.port.messages[0].type,"ready");
  const receive=data=>node.port.onmessage({data});
  const command={kind:"tone",start:.003,attack:.001,hold:0,decay:.02,gain:.5,
    frequency:1000,frequency1:0,frequencyTime:.01};
  receive({type:"cue",token:2,commands:[command]});
  assert.equal(node.port.messages.at(-1).leadFrames,144);
  receive({type:"stop",token:1,at:0});
  receive({type:"release",token:1});
  const output=new Float32Array(128);
  node.process([],[[output]]); assert.ok(output.every(v=>v===0));
  scope.currentFrame=128; node.process([],[[output]]);
  const first=node.port.messages.at(-1);
  assert.equal(first.type,"firstSample"); assert.equal(first.frame,145); assert.equal(first.scheduledFrame,144);
  receive({type:"stop",token:2,at:256/48000});
  scope.currentFrame=256; node.process([],[[output]]); assert.ok(output.every(v=>v===0));
  scope.currentFrame=1024; receive({type:"cue",token:3,commands:[command]});
  assert.equal(node.port.messages.at(-1).leadFrames,-880);
  receive({type:"release",token:3}); assert.equal(node.mixer.sources.length,0);
});


test("production casing admission accepts omitted partials dest but rejects a real route and diagnoses rejection", async () => {
  const partial={kind:"tone",options:{f:440,d:.03,g:.5,dest:undefined}};
  assert.ok(Object.hasOwn(partial.options,"dest"));
  assert.equal(casingSourceRejection([partial]),null);
  assert.equal(casingSourceRejection([{kind:"tone",options:{...partial.options,dest:null}}]),null);
  assert.equal(casingSourceRejection([{kind:"tone",options:{...partial.options,dest:{connect(){}}}}]),"custom-routing");
  assert.equal(casingSourceRejection([{kind:"noise",options:{f:440,type:"bandpass",dest:{}}}]),"custom-routing");
  assert.equal(casingSourceRejection([{kind:"unknown",options:{f:440}}]),"source-kind");
  assert.equal(casingSourceRejection([{kind:"tone",options:{f:440,hp:100}}]),"unknown-property");
  const nodes=[];
  class Node {
    constructor() {nodes.push(this);this.port={postMessage(){}};queueMicrotask(()=>this.port.onmessage({data:{type:"ready"}}));}
    connect(){} disconnect(){}
  }
  const pool=createCasingAudio({sampleRate:48000,currentTime:0,audioWorklet:{async addModule(){}}},{sampleRate:48000,getChannelData:()=>new Float32Array(144000)},{Node,slots:1});
  await pool.ready;
  const lease=pool.lease({});
  assert.equal(lease.submit([{start:.003,issuedAt:0}],[partial]),true);
  assert.equal(lease.submit([{start:.003,issuedAt:0}],[{kind:"tone",options:{f:440,dest:{}}}]),false);
  assert.deepEqual(pool.stats.descriptorReasons,{"custom-routing":1});
  assert.equal(pool.stats.submitted,1);assert.equal(pool.stats.descriptorFallback,1);
  lease.release();
});

test("Blink automated oscillator starts at zero phase and first partial quantum reads frequency buffer index zero", () => {
  for(const rate of [44100,48000]) {
    const command={kind:"tone",start:.003,issuedAt:0,attack:.001,hold:0,decay:.1,gain:1,
      frequency:600.123456,frequency1:240.123456,frequencyTime:.05};
    const mixer=new CasingMixer(rate,new Float32Array(rate*3));mixer.cue([command],0);
    const source=mixer.sources[0],first=Math.ceil(command.start*rate),end=Math.floor(first/128)*128+128;
    assert.equal(source.phase,0,"frequency automation leaves Blink fractional-start frequency local at zero");
    assert.equal(source.frequency,Math.fround(command.frequency));
    assert.equal(source.frequencyOffset,first%128);
    const output=new Float32Array(end+2);mixer.render(output,0);
    assert.equal(output[first],0,"first oscillator sample starts at phase0 even with fractional API start");
    let phase=0;
    for(let frame=first;frame<output.length;frame++) {
      const time=frame/rate,clock=(frame<end?frame-first%128:frame)/rate;
      const frequency=Math.fround(Math.fround(command.frequency)*Math.pow(Math.fround(command.frequency1)/Math.fround(command.frequency),Math.max(0,clock-command.start)/command.frequencyTime));
      const envelope=time<command.start+command.attack?(time-command.start)/command.attack:Math.pow(.001,(time-command.start-command.attack)/command.decay);
      assert.ok(Math.abs(output[frame]-Math.fround(Math.sin(phase)*envelope))<1e-7,`actual sample ${frame}`);
      phase=(phase+2*Math.PI*frequency/rate)%(2*Math.PI);
    }
    assert.equal(source.phase,phase);
  }
  const mixer=new CasingMixer(48000,new Float32Array(144000));
  mixer.cue([{kind:"noise",type:"lowpass",start:.003,issuedAt:0,attack:.001,hold:0,decay:.02,gain:.1,frequency:900,q:.7,offset:.03700001,noiseRate:1+1e-9}],0);
  assert.equal(mixer.sources[0].noiseRate,1,"AudioParam float conversion precedes unity offset rounding");
  assert.equal(mixer.sources[0].noise,Math.round(.03700001*48000));
});
