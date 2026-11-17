// Developer-only, never imported by startup. Root runs this in the browser.
// Original WebAudio source graph is the oracle; JS self-consistency is not one.
import { CasingMixer } from "./casing-worklet.js";
import { supportsCasingSources } from "./casing-audio.js";

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw Error("Unrecognized audio owner: "+from);
  return source.replace(from,to);
}
function makeAudio(body, ctx, white, start, compact, seed) {
  const math=Object.create(Math);
  math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const api=new Function("Math","oracleStart",body+"\nreturn eZ();")(math,start), state=api._engine;
  const bus=ctx.createGain();bus.connect(ctx.destination);
  Object.assign(state,{ctx,nyq:ctx.sampleRate*.45,revIn:ctx.createGain()});
  state.buf.white=white;state.bus.sfx=bus;
  let commands,originals,stopAt;
  if(compact)state.casingAudio={lease(){return {submit(value,descriptors){commands=value;originals=descriptors;},release(){},stop(at){stopAt=at;}};}};
  return {api,state,get commands(){return commands;},get originals(){return originals;},get stopAt(){return stopAt;}};
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
  includePCM=false,coreURL=new URL("../core/game.js",import.meta.url)}={}) {
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
    const ctx=new OfflineAudioContext(1,frames,sampleRate),white=ctx.createBuffer(1,sampleRate*3,sampleRate);
    const data=white.getChannelData(0);let noiseSeed=131;
    for(let i=0;i<data.length;i++)data[i]=((noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0)/2147483648)-1;
    let original,compact,arrivalFrame=0,commands,stealAt;
    function issue() {
      original=makeAudio(body,ctx,white,requestedStart,false,seed);
      compact=makeAudio(body,ctx,white,requestedStart,true,seed);
      original.state.ts=compact.state.ts=timeScale;
      original.api.casing(null,surface,kind);compact.api.casing(null,surface,kind);
      if(original.api._errors.length||compact.api._errors.length)throw Error("Original/candidate cue error");
      commands=compact.commands;
      if(!commands?.length)throw Error("No compact sources");
      if(!supportsCasingSources(compact.originals))throw Error("Actual production descriptor guard rejects this oracle voice");
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
    const mixer=new CasingMixer(sampleRate,data);mixer.cue(commands,arrivalFrame);
    if(compact.stopAt!==undefined)mixer.stopFrame=Math.ceil(compact.stopAt*sampleRate);
    const candidate=new Float32Array(frames);mixer.render(candidate,0);
    const level=compact.state.voices.at(-1).level;
    for(let i=0;i<candidate.length;i++)candidate[i]*=level*
      (stealAt!==undefined&&i/sampleRate>=stealAt?Math.exp(-(i/sampleRate-stealAt)/.008):1);
    if(suspension)await ctx.resume();
    const originalPCM=(await rendered).getChannelData(0),comparison=metrics(originalPCM,candidate);
    const requestedFrame=Math.ceil(Math.min(...commands.map(c=>c.start))*sampleRate);
    const effectiveMainFrame=Math.ceil(Math.min(...commands.map(c=>Math.max(c.start,c.issuedAt)))*sampleRate);
    const row={surface,kind,mode,timeScale,productionDescriptorSupported:true,sourceCount:commands.length,requestedFrame,effectiveMainFrame,
      issuedFrames:commands.map(c=>Math.round(c.issuedAt*sampleRate)),arrivalFrame,
      apiPastStartSources:commands.filter(c=>c.issuedAt>c.start).length,
      deliveryMissFrames:Math.max(0,arrivalFrame-effectiveMainFrame),
      stealAt:stealAt??null,stopAt:compact.stopAt??null,...comparison};
    row.sameAsOriginalOnset=Math.abs(row.firstDeltaFrames)<=1;
    row.requestedOnsetMet=row.candidateFirstNonzeroFrame>=0&&row.candidateFirstNonzeroFrame<=requestedFrame+2;
    row.waveformGate=mode==="deliveryMiss"?"expected missed deadline; never a timeline parity pass"
      : row.sameAsOriginalOnset && row.normalizedRMSE!==null && row.normalizedRMSE<=.02?"pass":"fail";
    if(includePCM) {row.originalPCM=Array.from(originalPCM);row.candidatePCM=Array.from(candidate);}
    rows.push(row);
  }
  return {schema:1,coreSHA256,sampleRate,timeScales,rows,
    failedWaveformCases:rows.filter(row=>row.waveformGate==="fail").length,
    boundary:"Offline original WebAudio graph vs JS CasingMixer; no Worklet transport, physical device latency or browser FPS proof",
    gate:"On-time/past-API source onset within one sample and normalized RMSE <= 0.02; deliveryMiss intentionally fails original onset",
    physicalLatencyAccepted:false};
}
