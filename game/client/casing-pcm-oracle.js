// Developer-only, never imported by startup. Root runs this in the browser.
// Original WebAudio source graph is the oracle; JS self-consistency is not one.
import { CasingMixer } from "./casing-worklet.js";
import { supportsCasingSources, casingTimingRejection } from "./casing-audio.js";

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw Error("Unrecognized audio owner: "+from);
  return source.replace(from,to);
}
function makeAudio(body, ctx, white, start, compact, seed, destination) {
  const math=Object.create(Math),draws=[],trace=[],ids=new WeakMap();let ordinal=0;
  math.random=()=>{const value=((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);draws.push(value);return value;};
  const api=new Function("Math","oracleStart",body+"\nreturn eZ();")(math,start),state=api._engine;
  const bus=ctx.createGain(),reverb=ctx.createGain();bus.connect(destination,0,compact?1:0);
  ids.set(bus,"sfx");ids.set(reverb,"unconnected-dry-oracle-reverb");
  const record=value=>{if(trace.length>=4096)throw Error("Bounded native oracle trace overflow");trace.push(value);};
  const snapshot=node=>Object.fromEntries(["type","loop"].filter(k=>k in node).map(k=>[k,node[k]])
    .concat(["gain","frequency","Q","detune","playbackRate"].filter(k=>node[k]).map(k=>[k,node[k].value])));
  // Per-context hardware boundary only. Real native nodes/params still execute;
  // no global prototypes are patched and every native return/error is retained.
  const hardware={get currentTime(){return ctx.currentTime;},sampleRate:ctx.sampleRate};
  for(const factory of ["Gain","Oscillator","BufferSource","BiquadFilter","ChannelMerger","Delay"]) {
    hardware["create"+factory]=(...args)=>{
      const node=ctx["create"+factory](...args),id=++ordinal;ids.set(node,id);record(["create",id,factory,args]);
      for(const param of ["gain","frequency","Q","detune","playbackRate","delayTime"])if(node[param]) {
        ids.set(node[param],id+"."+param);
        for(const op of ["setValueAtTime","linearRampToValueAtTime","exponentialRampToValueAtTime","cancelScheduledValues","setTargetAtTime"]) {
          const native=node[param][op].bind(node[param]);
          node[param][op]=(...values)=>{const result=native(...values);record(["param",id,param,op,values]);return result;};
        }
      }
      const connect=node.connect.bind(node);
      node.connect=(to,...ports)=>{const result=connect(to,...ports);record(["connect",id,ids.get(to)??"external",ports,snapshot(node)]);return result;};
      for(const op of ["start","stop"])if(node[op]) {
        const native=node[op].bind(node);
        node[op]=(...values)=>{const result=native(...values);record([op,id,values,snapshot(node)]);return result;};
      }
      return node;
    };
  }
  Object.assign(state,{ctx:hardware,nyq:ctx.sampleRate*.45,revIn:reverb});
  state.buf.white=white;state.bus.sfx=bus;
  let commands,originals,stopAt,rejection=null,decisionTime;
  if(compact)state.casingAudio={lease(){return {submit(value,descriptors){
    commands=value;originals=descriptors;decisionTime=ctx.currentTime;
    rejection=!supportsCasingSources(descriptors)?"descriptor":casingTimingRejection(value,ctx.currentTime);
    return rejection===null;
  },release(){},stop(at){stopAt=at;}};}};
  return {api,state,draws,trace,get rejection(){return rejection;},get commands(){return commands;},
    get originals(){return originals;},get decisionTime(){return decisionTime;},get stopAt(){return stopAt;}};
}
function metrics(original,candidate) {
  let error=0, energy=0, candidateEnergy=0, dot=0, maxError=0;
  const first=a=>a.findIndex(value=>Math.abs(value)>1e-8);
  for(let i=0;i<original.length;i++) {
    const a=original[i],b=candidate[i],d=a-b;
    error+=d*d;energy+=a*a;candidateEnergy+=b*b;dot+=a*b;
    maxError=Math.max(maxError,Math.abs(d));
  }
  const originalFirst=first(original),candidateFirst=first(candidate);
  return {originalFirstNonzeroFrame:originalFirst,candidateFirstNonzeroFrame:candidateFirst,
    firstDeltaFrames:candidateFirst-originalFirst,maxError,
    normalizedRMSE:energy?Math.sqrt(error/energy):null,
    rmsRatio:energy?Math.sqrt(candidateEnergy/energy):null,
    correlation:energy&&candidateEnergy?dot/Math.sqrt(energy*candidateEnergy):null};
}

export async function runCasingPCMOracle({sampleRate=48000,
  surfaces=["water","carpet","fabric","foliage","wood","metal","marble","tile","glass","concrete"],kinds=["brass","shell"],
  modes=["onTime","pastApi","deliveryMiss","stealTail"],timeScale,
  timeScales=timeScale===undefined?[.35,1,1.5]:[timeScale],seed=8171,
  includePCM=false,includeTrace=false,coreURL=new URL("../core/game.js",import.meta.url)}={}) {
  const source=await (await fetch(coreURL)).text();
  let body=source.slice(source.indexOf("  var qc = Math.PI"),source.indexOf("  var fo = eZ();"));
  if(!body.includes("function eZ()"))throw Error("Missing audio owner");
  // Only the diagnostic clock injection changes; S0/T/tone/noise stay actual.
  body=replaceOnce(body,"let mt = A0.currentTime + 3e-3","let mt = oracleStart");
  body=replaceOnce(body,"    return zt;","    zt.oracleSteal = M; return zt;");
  const coreSHA256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(source))))
    .map(v=>v.toString(16).padStart(2,"0")).join("");
  const rows=[],frames=Math.ceil(sampleRate*.6),requestedStart=.003;
  const suspendFrame=1024,arrivalSeconds=suspendFrame/sampleRate;
  for(const timeScale of timeScales)for(const surface of surfaces)for(const kind of kinds)for(const mode of modes) {
    if(!Number.isFinite(timeScale)||timeScale<=0)throw Error("Invalid diagnostic time scale");
    if(!["onTime","pastApi","deliveryMiss","stealTail"].includes(mode))throw Error("Unknown mode: "+mode);
    const ctx=new OfflineAudioContext(2,frames,sampleRate),white=ctx.createBuffer(1,sampleRate*3,sampleRate);
    const data=white.getChannelData(0);let noiseSeed=131;
    for(let i=0;i<data.length;i++)data[i]=((noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0)/2147483648)-1;
    const destination=ctx.createChannelMerger(2);destination.connect(ctx.destination);
    let original,compact,arrivalFrame=0,commands,stealAt;
    function issue() {
      original=makeAudio(body,ctx,white,requestedStart,false,seed,destination);
      compact=makeAudio(body,ctx,white,requestedStart,true,seed,destination);
      original.state.ts=compact.state.ts=timeScale;
      original.api.casing(null,surface,kind);compact.api.casing(null,surface,kind);
      if(original.api._errors.length||compact.api._errors.length)throw Error("Original/candidate cue error");
      commands=compact.commands;
      if(!commands?.length)throw Error("No compact sources");
      if(JSON.stringify(original.draws)!==JSON.stringify(compact.draws))throw Error("Original/fallback casing RNG stream differs");
    }
    const suspension=mode==="onTime"?null:ctx.suspend(arrivalSeconds);
    if(mode!=="pastApi")issue();
    const rendered=ctx.startRendering();
    if(suspension) {
      await suspension;
      if(mode!=="stealTail")arrivalFrame=Math.round(ctx.currentTime*sampleRate);
      if(mode==="pastApi")issue();
      if(mode==="stealTail") {
        stealAt=ctx.currentTime;
        original.api.oracleSteal(original.state.voices.at(-1));
        compact.api.oracleSteal(compact.state.voices.at(-1));
      }
    }
    const nativeFallback=compact.rejection!==null;
    let candidate=new Float32Array(frames);
    if(!nativeFallback) {
      const mixer=new CasingMixer(sampleRate,data);mixer.cue(commands,arrivalFrame);
      if(compact.stopAt!==undefined)mixer.stopFrame=Math.ceil(compact.stopAt*sampleRate);
      mixer.render(candidate,0);
      const level=compact.state.voices.at(-1).level;
      for(let i=0;i<candidate.length;i++)candidate[i]*=level*
        (stealAt!==undefined&&i/sampleRate>=stealAt?Math.exp(-(i/sampleRate-stealAt)/.008):1);
    }
    if(suspension)await ctx.resume();
    const nativePCM=await rendered,originalPCM=nativePCM.getChannelData(0);
    if(nativeFallback)candidate=nativePCM.getChannelData(1);
    const comparison=metrics(originalPCM,candidate);
    const nativeTraceEqual=JSON.stringify(original.trace)===JSON.stringify(compact.trace);
    const voice=v=>Object.fromEntries(["cat","prio","own","dying","rate","st","level","t","end"].map(k=>[k,v[k]]));
    const voiceEqual=JSON.stringify(voice(original.state.voices.at(-1)))===JSON.stringify(voice(compact.state.voices.at(-1)));
    const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)))))
      .map(v=>v.toString(16).padStart(2,"0")).join("");
    const requestedFrame=Math.ceil(Math.min(...commands.map(c=>c.start))*sampleRate);
    const effectiveMainFrame=Math.ceil(Math.min(...commands.map(c=>Math.max(c.start,c.issuedAt)))*sampleRate);
    const row={surface,kind,mode,timeScale,productionDescriptorSupported:supportsCasingSources(compact.originals),
      productionTimingSupported:compact.rejection==="descriptor"?null:!nativeFallback,guardDecisionFrame:Math.round(compact.decisionTime*sampleRate),candidateLane:nativeFallback?"native-whole-voice-fallback":"js-worklet-source",
      fallbackReason:compact.rejection,nativeFallbackPCMExact:nativeFallback?comparison.maxError===0:null,
      nativeFallbackTraceEqual:nativeFallback?nativeTraceEqual:null,nativeFallbackVoiceEqual:nativeFallback?voiceEqual:null,
      nativeFallbackTraceSHA256:nativeFallback?[await hash(original.trace),await hash(compact.trace)]:null,
      nativeTraceScope:"Real source create/connect snapshot/AudioParam automation/start/stop; excludes context infrastructure/cleanup",
      nativeTraceEvents:[original.trace.length,compact.trace.length],rngStreamEqual:true,rngSHA256:await hash(original.draws),sourceCount:commands.length,requestedFrame,effectiveMainFrame,
      issuedFrames:commands.map(c=>Math.round(c.issuedAt*sampleRate)),arrivalFrame,
      apiPastStartSources:commands.filter(c=>c.issuedAt>c.start).length,
      deliveryMissFrames:Math.max(0,arrivalFrame-effectiveMainFrame),
      stealAt:stealAt??null,stopAt:compact.stopAt??null,...comparison};
    row.sameAsOriginalOnset=Math.abs(row.firstDeltaFrames)<=1;
    row.requestedOnsetMet=row.candidateFirstNonzeroFrame>=0&&row.candidateFirstNonzeroFrame<=requestedFrame+2;
    row.deadlineGate=mode==="deliveryMiss" && row.deliveryMissFrames>0?"fail":"not a Worklet delivery test";
    row.waveformGate=mode==="deliveryMiss"?"expected missed deadline; never a timeline parity pass"
      : row.sameAsOriginalOnset && row.normalizedRMSE!==null && row.normalizedRMSE<=.02
        && (!nativeFallback || row.nativeFallbackPCMExact && nativeTraceEqual && voiceEqual)?"pass":"fail";
    if(includeTrace){row.originalTrace=original.trace;row.candidateTrace=compact.trace;}
    if(includePCM) {row.originalPCM=Array.from(originalPCM);row.candidatePCM=Array.from(candidate);}
    rows.push(row);
  }
  return {schema:1,coreSHA256,sampleRate,timeScales,rows,
    nativeFallbackCases:rows.filter(row=>row.candidateLane==="native-whole-voice-fallback").length,
    failedDeliveryDeadlineCases:rows.filter(row=>row.deadlineGate==="fail").length,
    failedWaveformCases:rows.filter(row=>row.waveformGate==="fail").length,
    boundary:"Offline native original vs accepted JS source or actual whole-voice native fallback in separate mono channels; no Worklet transport/device/FPS proof",
    gate:"On-time/past-API source onset within one sample and normalized RMSE <= 0.02; deliveryMiss intentionally fails original onset",
    physicalLatencyAccepted:false};
}
