// Actual singles physics + Three WebGLAttributes. Fake GL transport, not FPS evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function load(enabled=true){
  const bytes=readFileSync(new URL('../game/core/game.js',import.meta.url));
  const source=bytes.toString('utf8'),cut=source.lastIndexOf('\n  As0().catch(');assert.ok(cut>0);
  let seed=8171,draws=0;
  const math=Object.create(Math);math.random=()=>{draws++;return ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);};
  const forbidden=()=>{throw Error('No DOM/GPU/timer/audio in offline test');};
  const c={__GH_SINGLE_UPLOAD_RANGES:enabled,Math:math,console,URLSearchParams,URL,AbortController,DOMException,TextEncoder,TextDecoder,
    performance:{now:()=>0},location:{search:'?solo'},navigator:{userAgent:'offline-glass-ranges'},addEventListener(){},
    localStorage:{getItem(){return null;},setItem(){}},document:{addEventListener(){},createElement:forbidden},
    setTimeout:forbidden,clearTimeout(){},requestAnimationFrame:forbidden,AudioContext:forbidden};
  c.window=c;c.self=c;
  vm.runInNewContext(source.slice(0,cut)+'\nglobalThis.__glass={Physics:_w,Attributes:KG,THREE:Ct};\n})();',c,{timeout:10000});
  return {...c.__glass,rng:()=>[seed,draws]};
}
function fakeGL(){
  const calls=[];let bound;
  return {calls,ARRAY_BUFFER:34962,FLOAT:5126,isContextLost:()=>false,
    createBuffer:()=>({data:null}),bindBuffer(target,b){bound=b;},deleteBuffer(){},
    bufferData(target,array,usage){bound.data=Buffer.from(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));calls.push({kind:'data',bytes:array.byteLength,offset:0});},
    bufferSubData(target,offset,array,start=0,count=array.length-start){
      const bytes=Buffer.from(new Uint8Array(array.buffer,array.byteOffset+start*array.BYTES_PER_ELEMENT,count*array.BYTES_PER_ELEMENT));
      bytes.copy(bound.data,offset);calls.push({kind:'sub',bytes:bytes.length,offset,start,count});
    }};
}
function fixture(ranges=true, callbacks=false) {
  const b=load(ranges), T=b.THREE, events=[], uploaded=[];
  if(callbacks) T.BufferAttribute.prototype.onUploadCallback=function(){uploaded.push(this);};
  const physics=new b.Physics(new T.Scene(),{overlap:()=>false},{audio:{casing:(...args)=>events.push(args)}});
  if(!ranges) physics._markSingleRange=attribute=>{attribute.needsUpdate=true;};
  const gl=fakeGL(); let up=b.Attributes(gl);
  const attributes=()=>[physics.chunkMesh.instanceMatrix,physics.chunkMesh.instanceColor,physics.caseMesh.instanceMatrix,physics.caseMesh.instanceColor];
  return {...b,physics,events,uploaded,gl,attributes,
    upload(){for(const a of attributes())up.update(a,gl.ARRAY_BUFFER);},
    gpu(a){return up.get(a)?.buffer.data;},
    recreate(){up=b.Attributes(gl);},
  };
}
const bytes=a=>Buffer.from(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
const payload=f=>f.gl.calls.reduce((n,c)=>n+c.bytes,0);
const pair=()=>[fixture(false),fixture()];
const both=(p,fn)=>p.forEach(fn);
function same(a,b,gpu=true){
  for(const pool of ['chunks','cases']) {
    for(const key of ['x','v','s','ax','ang','w','life','st','b','kind'])assert.deepEqual(bytes(a.physics[pool][key]),bytes(b.physics[pool][key]),pool+'.'+key);
    for(const key of ['live','i'])assert.equal(a.physics[pool][key],b.physics[pool][key]);
  }
  a.attributes().forEach((x,i)=>{const y=b.attributes()[i];assert.deepEqual(bytes(x.array),bytes(y.array));if(gpu){assert.deepEqual(a.gpu(x),b.gpu(y));assert.deepEqual(b.gpu(y),bytes(y.array));}});
  assert.deepEqual(a.rng(),b.rng());assert.deepEqual(a.events,b.events);
}
function spawn(f,kind='cases',slot=null){
  const p=f.physics;if(slot!==null)p[kind].i=slot;
  if(kind==='cases')p.casing({x:1,y:3,z:2},{x:.2,y:.4,z:.6},slot===null?0:slot%3);
  else p.debris(1,3,2,.2,.4,.6,.2,0x123456,5);
}
const tick=(f,dt=1/60)=>{for(const [pool,mesh] of [['chunks','chunkMesh'],['cases','caseMesh']])f.physics._simSingles(f.physics[pool],f.physics[mesh],dt,pool==='cases');};

test('one active slot uploads 76 bytes instead of full 90/320-slot matrix/color pools',()=>{
  for(const kind of ['cases','chunks']){
    const p=pair();both(p,f=>f.upload());both(p,f=>f.gl.calls.length=0);
    both(p,f=>spawn(f,kind));both(p,f=>tick(f));both(p,f=>f.upload());same(...p);
    assert.equal(payload(p[1]),76);assert.equal(payload(p[0]),(kind==='cases'?90:320)*76);
    assert.equal(p[1].gl.calls.length,2);
    both(p,f=>f.gl.calls.length=0);both(p,f=>f.upload());assert.equal(payload(p[1]),0);
  }
});
test('pending spans survive deferred rendering, catch-up, retirement and ring wrap without allocation',()=>{
  const p=pair();both(p,f=>f.upload());both(p,f=>spawn(f,'cases',85));both(p,f=>tick(f));
  const attribute=p[1].physics.caseMesh.instanceMatrix,range=attribute.updateRanges[0];
  both(p,f=>spawn(f,'cases',2));both(p,f=>tick(f));same(...p,false);
  assert.equal(attribute.updateRanges[0],range);assert.equal(range.start,2*16);assert.equal(range.count,84*16);
  both(p,f=>{f.physics.cases.life[85]=0;tick(f);});
  assert.equal(attribute.updateRanges[0],range);both(p,f=>f.upload());same(...p);
  for(let n=0;n<190;n++){both(p,f=>spawn(f,'cases'));both(p,f=>tick(f));if(n%13===0){both(p,f=>f.upload());same(...p);}}
  both(p,f=>f.upload());same(...p);
});
test('first allocation, reset-before-upload and recreated backend retain complete buffers',()=>{
  const p=pair();both(p,f=>spawn(f,'chunks',7));both(p,f=>tick(f));both(p,f=>f.upload());same(...p);
  assert.ok(p[1].attributes().every(a=>a.updateRanges.length===0));
  both(p,f=>spawn(f,'cases',4));both(p,f=>tick(f));both(p,f=>f.physics.reset());both(p,f=>spawn(f,'chunks',2));both(p,f=>tick(f));both(p,f=>f.upload());same(...p);
  both(p,f=>spawn(f,'cases',60));both(p,f=>tick(f));both(p,f=>f.recreate());both(p,f=>f.upload());same(...p);
});
test('settled pools stop matrix uploads until fade, then expiry and below-world paths upload zero matrices',()=>{
  const p=pair();both(p,f=>spawn(f));both(p,f=>tick(f));both(p,f=>f.upload());
  both(p,f=>{f.physics.cases.st[0]=2;f.physics.cases.life[0]=3;f.gl.calls.length=0;tick(f);f.upload();});same(...p);assert.equal(payload(p[1]),0);
  both(p,f=>{f.physics.cases.life[0]=.8;tick(f);f.upload();});same(...p);assert.equal(payload(p[1]),64);
  both(p,f=>{tick(f,2);f.upload();});same(...p);
  both(p,f=>{spawn(f);f.physics.cases.x[4]=-41;tick(f);f.upload();});same(...p);
});
test('upload callbacks and external pending ranges are preserved; replaced attributes use full updates',()=>{
  const f=fixture(true,true);f.upload();assert.equal(f.uploaded.length,4);
  const a=f.physics.caseMesh.instanceMatrix;
  a.addUpdateRange(48,16);f.physics._markSingleRange(a,16,32);
  assert.equal(a.updateRanges[0].start,16);assert.equal(a.updateRanges[0].count,48);
  f.upload();assert.equal(f.uploaded.length,5);assert.equal(a.updateRanges.length,0);
  const replacement=new f.THREE.InstancedBufferAttribute(new Float32Array(90*16),16);
  f.physics._markSingleRange(replacement,16,32);assert.equal(replacement.version,1);assert.equal(replacement.updateRanges.length,0);
});

test('ordinary startup keeps the unpromoted candidate disabled',()=>{
 const f=fixture(false);assert.ok(f.attributes().every(a=>!a._ghSingleRange));
});
