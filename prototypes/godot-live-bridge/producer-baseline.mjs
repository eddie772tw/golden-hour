// Single controlled native-AI session, wall-clock source, single local TCP peer.
import net from 'node:net';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createSession,setupSHA256} from './session.mjs';
import {createClock,clockSHA256} from './clock.mjs';
import {makePoseSource} from './poses.mjs';
import {Kind,HEADER,packet,header,jsonPacket,frameReader} from './protocol.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
  const match=/^--(port|output|ticks|wait-seconds)=(.+)$/.exec(arg);if(!match)throw Error('Unknown bridge argument '+arg);
  return [match[1],match[2]];
}));
const port=Number(args.port??48921),tickLimit=Number(args.ticks??3600),waitSeconds=Number(args['wait-seconds']??180);
if(!Number.isInteger(port)||port<1024||port>65535||!Number.isInteger(tickLimit)||tickLimit<1||tickLimit>3600||!(waitSeconds>0&&waitSeconds<=600))throw Error('Invalid bounded bridge argument');
const output=resolve(args.output??fileURLToPath(new URL('./evidence/realtime-producer.json',import.meta.url)));
if(existsSync(output))throw Error('Refusing to overwrite '+output);
const report={kind:'live-original-native-AI-TCP-source-v1',ok:false,fullFixturePassed:false,stages:[],platformCalls:[],
  setupFrozenSHA256:setupSHA256,clockSourceSHA256:clockSHA256,
  limits:['Live CPU source/transport prototype; no Godot/GPU launched by producer.',
    'Node renders zero GPU frames. Source snapshotHz and logicHz are not Godot FPS.',
    'Audio remains the original producer on recording virtual hardware; bounded command drops and no DSP parity.',
    'Operator affine palettes and props/camera are live; K9 custom parts, weapons, FX and full High remain unported.']};
report.timerPolicy='Historical work-then-setTimeout absolute-deadline scheduler';
report.implementationSHA256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const stats=report.realtime={callbacks:0,zeroTickCallbacks:0,logicalTicks:0,maxTicksPerCallback:0,
  sourceSnapshots:0,posePackets:0,acknowledged:0,supersededSnapshots:0,blockedAttempts:0,staleACKs:0,
  maxWritableBytes:0,maxACKMs:0,callbackGapMaxMs:0,tickGapMaxMs:0,callbackOver33ms:0,callbackOver50ms:0,callbackOver100ms:0,
  samplesDropped:0,callbackSamples:[],tickSamples:[],ackSamples:[]};
const sample=(list,value)=>{if(list.length<8192)list.push(value);else stats.samplesDropped++;};
let session,control,clock,poses,socket,timer,waitTimer,deliveryTimer,finishing=false,started=false,startRequested=false,ready=false;
let generation=0,startedAt=0,lastCallback=0,lastTickAt=0,lastPresentAt=0,nextWake=0,latest=null,inflight=null,lastSentSeq=0,lastACK=0;
const log=(event,data={})=>console.log('GH_BRIDGE '+JSON.stringify({event,...data}));
const server=net.createServer(peer=>{
  if(socket||finishing){peer.destroy();return;}
  socket=peer;peer.setNoDelay(true);
  const read=frameReader(bytes=>{
    const h=header(bytes);if(bytes.length!==HEADER)throw Error('Control packets have no payload');
    if(h.kind===Kind.START){startRequested=true;if(ready&&!started)void start().catch(error=>finish('start-error',error));}
    else if(h.kind===Kind.ACK){
      if(h.seq<=lastACK){stats.staleACKs++;return;}
      if(!inflight||h.seq!==inflight.seq)throw Error('ACK does not own current pose');
      const ms=performance.now()-inflight.sentAt;stats.maxACKMs=Math.max(stats.maxACKMs,ms);sample(stats.ackSamples,ms);
      lastACK=h.seq;stats.acknowledged++;inflight=null;
      try{sendLatest();}catch(error){void finish('source-error',error);return;}
      if(control?.controller.done||stats.logicalTicks>=tickLimit)void finish('complete');
    } else if(h.kind===Kind.PING){
      const received=performance.now(),payload=Buffer.alloc(24);payload.writeDoubleLE(h.monoMs,0);payload.writeDoubleLE(received,8);payload.writeDoubleLE(performance.now(),16);
      if(peer.writableLength>128*1024)throw Error('Control backpressure cap');peer.write(packet(Kind.CLOCK,{seq:h.seq},payload));
    } else throw Error('Unsupported inbound control kind '+h.kind);
  },{maximum:4096});
  peer.on('data',chunk=>{try{read(chunk);}catch(error){void finish('protocol-error',error);}});
  peer.on('error',error=>{if(!finishing)void finish('socket-error',error);});
  peer.on('drain',()=>{try{sendLatest();}catch(error){void finish('source-error',error);}});
  peer.on('close',()=>{if(!finishing)void finish('peer-disconnected',Error('Live peer disconnected'));});
  if(ready)sendHello();else log('peer-waiting-for-initialization');
});
server.on('error',error=>void finish('listen-error',error));
function sendHello(){socket?.write(jsonPacket(Kind.HELLO,{}, {status:'ready',protocol:'GHLP-v1',
  coreSHA256:session.graph.sourceSHA256,setupFrozenSHA256:setupSHA256,clockSourceSHA256:clockSHA256,
  initializerSHA256:report.initialWorldConfig.sha256,step:clock.step,maximumCatchUpTicks:3,
  nodeTimeOriginEpochMs:performance.timeOrigin,...poses.manifest}));}
function sendLatest(){
  if(!latest||latest.seq<=lastSentSeq||!socket||socket.destroyed)return;
  if(inflight||socket.writableNeedDrain){stats.blockedAttempts++;return;}
  if(socket.writableLength>128*1024)throw Error('Outbound socket cap');
  const before=performance.now(),encoded=poses.encode(stats.supersededSnapshots);
  const bytes=packet(Kind.POSE,{seq:latest.seq,tick:latest.tick,monoMs:latest.at,simSeconds:session.gh.G.time},encoded.bytes);
  inflight={seq:latest.seq,sentAt:performance.now()};lastSentSeq=latest.seq;stats.posePackets++;
  socket.write(bytes);stats.maxWritableBytes=Math.max(stats.maxWritableBytes,socket.writableLength);
  latest.encodeMs=performance.now()-before;
}
async function start(){
  if(started||finishing)return;started=true;clearTimeout(waitTimer);
  session.gh.loopStats=clock.stats;control=await session.startController();
  report.clock={kind:'real wall-clock original ghCreateLoopClock',step:clock.step,maximumCatchUpTicks:3,
    boundedDebt:'Original max3ticks, elapsed excess increments dropped seconds; no unbounded backlog.',
    renderFramesMeaning:'Always0: Node submits no GPU frames. Source snapshots are separate counters.',
    audioClock:'Virtual sample time follows actual elapsed wall time, not accelerated logical ticks.'};
  startedAt=lastPresentAt=nextWake=performance.now();lastCallback=lastTickAt=0;
  log('started',{port,tickLimit});pump(++generation);
}
function pump(owner){
  if(finishing||owner!==generation)return;
  try {
    const now=performance.now(),gap=lastCallback?now-lastCallback:0;lastCallback=now;stats.callbacks++;
    stats.callbackGapMaxMs=Math.max(stats.callbackGapMaxMs,gap);
    if(gap>1000/30)stats.callbackOver33ms++;if(gap>50)stats.callbackOver50ms++;if(gap>100)stats.callbackOver100ms++;
    if(inflight&&now-inflight.sentAt>2000)throw Error('Peer pose ACK exceeded2seconds');
    const key=session.gh.G.state+':native',planned=clock.plan(now,key,true,true);let ran=0,stepCPU=0;
    for(;ran<planned;ran++) {
      if(session.gh.G.state!=='playing'||control.controller.done||stats.logicalTicks>=tickLimit)break;
      const begin=performance.now(),tickGap=lastTickAt?begin-lastTickAt:0;lastTickAt=begin;
      stats.tickGapMaxMs=Math.max(stats.tickGapMaxMs,tickGap);
      session.audioContext.advance((begin-startedAt)/1000,control.controller.tick+1);
      if(control.simulate(clock.step,true))clock.logical(clock.step);
      session.graph.input.endFrame();stats.logicalTicks++;
      const cpu=performance.now()-begin;stepCPU+=cpu;sample(stats.tickSamples,[stats.logicalTicks,begin-startedAt,tickGap,cpu]);
    }
    stats.maxTicksPerCallback=Math.max(stats.maxTicksPerCallback,ran);clock.stats.maxTicksPerCallback=Math.max(clock.stats.maxTicksPerCallback,ran);
    if(ran<planned){clock.unused(planned-ran);clock.reset();}
    if(ran) {
      const at=performance.now(),wallDelta=Math.min((at-lastPresentAt)/1000,1/18);lastPresentAt=at;
      session.graph.runtime.audio.update(wallDelta);session.graph.hud.update(wallDelta,{player:session.graph.player});
      if(session.graph.runtime.audio._errors.length)throw Error(session.graph.runtime.audio._errors.join(';'));
      const prepareAt=performance.now();poses.prepare();
      if(latest&&latest.seq>lastSentSeq)stats.supersededSnapshots++;
      latest={seq:++stats.sourceSnapshots,tick:control.controller.tick,at};
      sendLatest();sample(stats.callbackSamples,[now-startedAt,gap,ran,stepCPU,performance.now()-prepareAt]);
    } else stats.zeroTickCallbacks++;
    if(control.controller.done||stats.logicalTicks>=tickLimit){report.logicalFinishedAtMs=performance.now()-startedAt;void finish('complete');return;}
    nextWake+=1000/60;const after=performance.now();
    if(nextWake<after)nextWake+=(Math.floor((after-nextWake)/(1000/60))+1)*(1000/60);
    timer=setTimeout(()=>pump(owner),Math.max(1,Math.ceil(nextWake-after)));
  } catch(error){void finish('source-error',error);}
}
async function finish(reason,error){
  if(finishing)return;
  if(reason==='complete'&&(inflight||latest?.seq>lastSentSeq)){
    deliveryTimer??=setTimeout(()=>void finish('final-ack-timeout',Error('Last real pose was not acknowledged')),2000);
    return; // deliver/ACK the last real state first
  }
  finishing=true;generation++;clearTimeout(timer);clearTimeout(waitTimer);clearTimeout(deliveryTimer);
  if(error){report.error=String(error);report.stack=error.stack;}
  report.reason=reason;
  if(control){
    report.scenario=control.controller.export();report.clockStats=JSON.parse(JSON.stringify(clock.stats));
    const elapsed=performance.now()-startedAt;
    stats.elapsedMs=elapsed;stats.logicalHz=stats.logicalTicks*1000/(report.logicalFinishedAtMs??elapsed);
    stats.sourceSnapshotHz=stats.sourceSnapshots*1000/(report.logicalFinishedAtMs??elapsed);
    stats.actualNodeGPUFrames=0;stats.droppedDebtSeconds=clock.stats.dropped;
    report.exportsEqual=Object.fromEntries(session.fixtures.provenance.comparedFields.map(k=>[k,isDeepStrictEqual(report.scenario[k],session.fixtures.baseline[k])]));
    report.fullFixturePassed=control.controller.done&&Object.values(report.exportsEqual).every(Boolean);
    report.ok=!error&&stats.logicalTicks===tickLimit&&stats.acknowledged>0;
  }
  if(session)report.audio={...session.audioContext.snapshot(),engine:session.graph.runtime.audio._engine.stats,errors:session.graph.runtime.audio._errors};
  session?.close();
  if(socket&&!socket.destroyed)socket.end(jsonPacket(Kind.DONE,{}, {reason,ok:report.ok,ticks:stats.logicalTicks,
    fullFixturePassed:report.fullFixturePassed,sourceSnapshots:stats.sourceSnapshots,sent:stats.posePackets,
    superseded:stats.supersededSnapshots,droppedDebtSeconds:clock?.stats.dropped??null,actualNodeGPUFrames:0}));
  server.close();mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  log('finished',{reason,ok:report.ok,fullFixturePassed:report.fullFixturePassed,output});
  process.exitCode=report.ok?0:2;
}
process.once('SIGINT',()=>void finish('signal',Error('Stopped by SIGINT')));
process.once('SIGTERM',()=>void finish('signal',Error('Stopped by SIGTERM')));
try {
  await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolveListen);});log('listening',{port});
  session=await createSession(report);clock=createClock();poses=makePoseSource(session.graph);ready=true;
  log('ready',{port,skins:poses.manifest.skins.length,props:session.graph.physics.props.length,tick:0});
  if(socket)sendHello();
  waitTimer=setTimeout(()=>void finish('start-timeout',Error('No START from peer')),waitSeconds*1000);
  if(startRequested)await start();
} catch(error){await finish('initialization-error',error);}
