// GHLP v1. All numeric fields are little-endian. One unacked POSE at a time.
import assert from 'node:assert/strict';
export const HEADER=48,MAGIC=0x504c4847,VERSION=1;
export const Kind={HELLO:1,POSE:2,START:3,ACK:4,PING:5,CLOCK:6,DONE:7};
export function packet(kind,{seq=0,tick=0,monoMs=performance.now(),simSeconds=0}={},payload=Buffer.alloc(0)) {
  const out=Buffer.alloc(HEADER+payload.length);
  out.writeUInt32LE(out.length-4,0);out.writeUInt32LE(MAGIC,4);out.writeUInt16LE(VERSION,8);out.writeUInt16LE(kind,10);
  out.writeUInt32LE(seq>>>0,12);out.writeUInt32LE(tick>>>0,16);
  out.writeDoubleLE(monoMs,24);out.writeDoubleLE(performance.timeOrigin+monoMs,32);out.writeDoubleLE(simSeconds,40);
  payload.copy(out,HEADER);return out;
}
export function header(bytes) {
  assert.ok(bytes.length>=HEADER);assert.equal(bytes.readUInt32LE(0)+4,bytes.length);
  assert.equal(bytes.readUInt32LE(4),MAGIC);assert.equal(bytes.readUInt16LE(8),VERSION);
  return {kind:bytes.readUInt16LE(10),seq:bytes.readUInt32LE(12),tick:bytes.readUInt32LE(16),
    monoMs:bytes.readDoubleLE(24),epochMs:bytes.readDoubleLE(32),simSeconds:bytes.readDoubleLE(40)};
}
export function jsonPacket(kind,info,data){return packet(kind,info,Buffer.from(JSON.stringify(data)));}
export function frameReader(onPacket,{maximum=128*1024}={}) {
  let pending=Buffer.alloc(0);
  return chunk=>{
    if(pending.length+chunk.length>maximum*2)throw Error('Inbound buffer cap');
    pending=Buffer.concat([pending,chunk]);
    while(pending.length>=4) {
      const length=pending.readUInt32LE(0)+4;
      if(length<HEADER||length>maximum)throw Error('Packet length outside bounded protocol');
      if(pending.length<length)return;
      const bytes=pending.subarray(0,length);header(bytes);onPacket(bytes);pending=pending.subarray(length);
    }
  };
}
