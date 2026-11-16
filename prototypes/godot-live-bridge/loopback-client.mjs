// Transport-only CPU receiver; this never claims Godot/GPU/render validation.
import net from 'node:net';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Kind,HEADER,packet,header,frameReader} from './protocol.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
  const m=/^--(port|output|ack-delay-ms)=(.+)$/.exec(arg);if(!m)throw Error('Unknown loopback argument');return [m[1],m[2]];
}));
const port=Number(args.port??48921),delay=Number(args['ack-delay-ms']??0),output=resolve(args.output??fileURLToPath(new URL('./evidence/loopback-client.json',import.meta.url)));
if(!Number.isInteger(port)||port<1024||port>65535||!Number.isFinite(delay)||delay<0||delay>1500)throw Error('Invalid loopback bounds');
if(existsSync(output))throw Error('Refusing overwrite '+output);
const report={kind:'CPU-TCP-loopback-only',ok:false,nativeRender:false,GodotLaunched:false,renderFPS:null,
  sourcePackets:0,distinctTicks:0,sequenceGaps:0,samples:[],sampleDrops:0,ackDelayMs:delay};
const ticks=new Set();let lastSeq=0,lastTick=0,offset=null,pingAt=0,done=false;
const socket=net.connect(port,'127.0.0.1');
const timeout=setTimeout(()=>socket.destroy(Error('Loopback session timeout')),240000);
function save(error){
  if(done)return;done=true;clearTimeout(timeout);
  if(error)report.error=String(error);
  report.distinctTicks=ticks.size;report.ok=!error&&report.done?.ok===true&&report.sourcePackets>0;
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log('GH_LOOPBACK '+JSON.stringify({ok:report.ok,packets:report.sourcePackets,distinctTicks:report.distinctTicks,gaps:report.sequenceGaps,output}));
  process.exitCode=report.ok?0:2;
}
const read=frameReader(bytes=>{
  const h=header(bytes),now=performance.now();
  if(h.kind===Kind.HELLO){
    const hello=JSON.parse(bytes.subarray(HEADER));assert.equal(hello.status,'ready');assert.equal(hello.skins.length,19);
    assert.ok(hello.skins.every(s=>s.bones===34));report.hello=hello;
    pingAt=performance.now();socket.write(packet(Kind.PING,{seq:1,monoMs:pingAt}));
  } else if(h.kind===Kind.CLOCK){
    assert.equal(bytes.length,HEADER+24);const sent=bytes.readDoubleLE(HEADER),received=bytes.readDoubleLE(HEADER+8),replied=bytes.readDoubleLE(HEADER+16);
    assert.equal(sent,pingAt);const rtt=now-sent-(replied-received);
    offset=((received-sent)+(replied-now))/2;report.clock={estimatedNodeMinusClientMs:offset,RTTms:rtt,uncertaintyMs:rtt/2};
    socket.write(packet(Kind.START));
  } else if(h.kind===Kind.POSE){
    assert.ok(h.seq>lastSeq&&h.tick>lastTick,'Never report repeated pose as fresh');
    report.sequenceGaps+=Math.max(0,h.seq-lastSeq-1);lastSeq=h.seq;lastTick=h.tick;ticks.add(h.tick);report.sourcePackets++;
    let at=HEADER;const skinCount=bytes.readUInt32LE(at),bodyCount=bytes.readUInt32LE(at+4),k9Count=bytes.readUInt32LE(at+8);at+=160;
    assert.equal(skinCount,19);assert.ok(bodyCount<1024&&k9Count<16);
    for(let i=0;i<skinCount;i++){const bones=bytes.readUInt32LE(at+20);assert.equal(bones,34);at+=24;
      for(let j=0;j<16+bones*16;j++,at+=4)assert.ok(Number.isFinite(bytes.readFloatLE(at)));}
    at+=bodyCount*80+k9Count*32;assert.equal(at,bytes.length,'Exact binary layout');
    const age=offset===null?null:now+offset-h.monoMs;
    if(report.samples.length<8192)report.samples.push([h.seq,h.tick,age]);else report.sampleDrops++;
    const acknowledge=()=>socket.write(packet(Kind.ACK,{seq:h.seq}));
    if(delay)setTimeout(acknowledge,delay);else acknowledge();
  } else if(h.kind===Kind.DONE){report.done=JSON.parse(bytes.subarray(HEADER));save();socket.end();}
  else throw Error('Unexpected server packet');
});
socket.on('data',chunk=>{try{read(chunk);}catch(error){socket.destroy();save(error);}});
socket.on('error',error=>save(error));socket.on('close',()=>{if(!done)save(Error('EOF before DONE'));});
