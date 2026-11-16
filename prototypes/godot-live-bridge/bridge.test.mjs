import assert from 'node:assert/strict';
import net from 'node:net';
import {createClock} from './clock.mjs';
import {Kind,HEADER,packet,header,frameReader} from './protocol.mjs';
import {originalBodyModel} from './poses.mjs';
import {loadRuntime} from './logic.mjs';
const clock=createClock();
assert.equal(clock.plan(0,'playing:native',true,true),1);clock.logical(1/60);
assert.equal(clock.plan(1000/60,'playing:native',true,true),1);clock.logical(1/60);
assert.equal(clock.plan(1000,'playing:native',true,true),3);
assert.ok(Math.abs(clock.stats.dropped-(59/60-.05))<1e-10);
assert.equal(clock.plan(1020,'paused:native',false,false),0);
assert.equal(clock.plan(1040,'playing:native',true,true),1);
assert.equal(clock.stats.renderFrames,0,'Source must not report GPU draws');
const pose=packet(Kind.POSE,{seq:7,tick:12,monoMs:123,simSeconds:.2},Buffer.from([1,2,3]));
assert.deepEqual({...header(pose),epochMs:0},{kind:Kind.POSE,seq:7,tick:12,monoMs:123,epochMs:0,simSeconds:.2});
let decoded=0;const read=frameReader(bytes=>{assert.equal(header(bytes).seq,7);decoded++;});
read(pose.subarray(0,3));read(pose.subarray(3,17));read(pose.subarray(17));assert.equal(decoded,1);
const bad=Buffer.from(pose);bad.writeUInt32LE(0,4);assert.throws(()=>frameReader(()=>{})(bad));
assert.throws(()=>frameReader(()=>{},{maximum:HEADER})(pose));
// True native Three geometry/_w body, matching the sole nameless original factory.
const {runtime:r}=loadRuntime({boot:{policy:{}}}),T=r.THREE;
const physics=new r.Physics(new T.Scene(),new r.World(),{});
const tile=physics.addProp(new T.Mesh(new T.BoxGeometry(.58,.02,.58)),{size:[.58,.04,.58],center:[0,0,0],mass:2,mat:'plastic'});
tile.temp=true;assert.equal(originalBodyModel(tile),'native-ceiling-tile');
tile.obj.geometry=new T.BoxGeometry(1,1,1);assert.throws(()=>originalBodyModel(tile));
tile.obj.name='magProp';assert.equal(originalBodyModel(tile),'magProp');
// Transport-only real loopback, not actors or a full-AI fixture.
const server=net.createServer(socket=>socket.on('data',frameReader(bytes=>{
  assert.equal(header(bytes).kind,Kind.ACK);socket.end(packet(Kind.DONE));
})));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const client=net.connect(server.address().port,'127.0.0.1');
await new Promise((resolve,reject)=>{client.on('error',reject);client.on('data',frameReader(bytes=>{assert.equal(header(bytes).kind,Kind.DONE);resolve();}));
  client.on('connect',()=>client.write(packet(Kind.ACK,{seq:7})));});
client.destroy();await new Promise(resolve=>server.close(resolve));
console.log('PASS original clock/max3/drop/pause + LE framing/fragmentation/bounds + TCP loopback; no AI acceptance claimed');
