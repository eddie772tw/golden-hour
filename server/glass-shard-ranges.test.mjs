// Actual Ew + actual Three KG/WebGLAttributes, CPU fakeGL transport only.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function load(){
  const bytes=readFileSync(new URL('../game/core/game.js',import.meta.url));
  const source=bytes.toString('utf8'),cut=source.lastIndexOf('\n  As0().catch(');assert.ok(cut>0);
  let seed=8171,draws=0;
  const math=Object.create(Math);math.random=()=>{draws++;return ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);};
  const forbidden=()=>{throw Error('No DOM/GPU/timer/audio in offline test');};
  const c={Math:math,console,URLSearchParams,URL,AbortController,DOMException,TextEncoder,TextDecoder,
    performance:{now:()=>0},location:{search:'?solo'},navigator:{userAgent:'offline-glass-ranges'},addEventListener(){},
    localStorage:{getItem(){return null;},setItem(){}},document:{addEventListener(){},createElement:forbidden},
    setTimeout:forbidden,clearTimeout(){},requestAnimationFrame:forbidden,AudioContext:forbidden};
  c.window=c;c.self=c;
  vm.runInNewContext(source.slice(0,cut)+'\nglobalThis.__glass={Glass:Ew,Attributes:KG,THREE:Ct,capacity:ww};\n})();',c,{timeout:10000});
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
function fixture(enabled,watchUploads=false){
  const b=load(),T=b.THREE,scene=new T.Scene(),events=[];
  const uploadCallbacks=[];
  if(watchUploads)T.BufferAttribute.prototype.onUploadCallback=function(){uploadCallbacks.push(this);};
  const world={groundAt:()=>0,addCollider:()=>({off:false})};
  const hooks={audio:{glassDebris:v=>events.push(['debris',v.x,v.y,v.z]),glassCrack:v=>events.push(['crack',v.x,v.y,v.z]),glassShatter:()=>events.push(['shatter'])},
    fx:{chips(){},glassBurst(){}}};
  const glass=new b.Glass(scene,world,hooks);
  glass.addPane({axis:'z',pos:2,a0:-1,a1:1,y0:.5,y1:2.5,cell:.4});glass.build();
  const gl=fakeGL(),up=b.Attributes(gl);
  if(enabled!==undefined)glass.ghShardDirtyRanges=enabled;
  const f={...b,glass,scene,events,gl,up,uploadCallbacks};
  f.upload=()=>{up.update(glass.spos,gl.ARRAY_BUFFER);up.update(glass.snrm,gl.ARRAY_BUFFER);};
  f.gpu=a=>up.get(a)?.buffer.data;
  return f;
}
const bytes=a=>Buffer.from(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
const arrays=['sp','sv','sl','sax','sang','sw','slife','sfloor','sstate','sb'];
function same(a,b,gpu=true){
  for(const key of arrays)assert.deepEqual(bytes(a.glass[key]),bytes(b.glass[key]),key);
  for(const key of ['spos','snrm']){
    assert.deepEqual(bytes(a.glass[key].array),bytes(b.glass[key].array),key);
    if(gpu){assert.deepEqual(a.gpu(a.glass[key]),b.gpu(b.glass[key]),key+' GPU');assert.deepEqual(b.gpu(b.glass[key]),bytes(b.glass[key].array),key+' uploaded current CPU bytes');}
  }
  for(const key of ['cursor','active','time','_lastDebris','_lastCrack'])assert.equal(a.glass[key],b.glass[key],key);
  assert.deepEqual(a.rng(),b.rng(),'global RNG');assert.deepEqual(a.events,b.events,'native side effects');
  for(let i=0;i<a.glass.panes.length;i++)for(const key of ['alive','crack','verts','diag']){
    const x=a.glass.panes[i][key],y=b.glass.panes[i][key];assert.equal(!!x,!!y);if(x)assert.deepEqual(bytes(x),bytes(y),'pane '+key);
  }
}
function spawn(f,slot=null){
  if(slot!==null)f.glass.cursor=slot;
  f.glass._spawnShard(f.glass.panes[0],-.2,1,.1,1,-.2,1.3,1,2,-.5,.7);
}
function pair(enabled=true){return [fixture(false),fixture(enabled)];}
function both(pair,fn){for(const f of pair)fn(f);}
function count(f){return {calls:f.gl.calls.length,payloadBytes:f.gl.calls.reduce((n,x)=>n+x.bytes,0)};}

test('first allocation and repeated uploader visits use actual Three semantics; source callbacks survive',()=>{
  const p=pair();both(p,f=>f.upload());same(...p);
  assert.equal(p[1].glass.spos.updateRanges.length,0,'creation bufferData has no native range clear; owned onUpload clears it');
  both(p,f=>f.gl.calls.length=0);both(p,f=>f.upload());assert.equal(p[1].gl.calls.length,0);
  const beforeSpawn=[p[1].glass.spos.version,p[1].glass.snrm.version];
  both(p,f=>spawn(f));same(...p);
  assert.deepEqual([p[1].glass.spos.version,p[1].glass.snrm.version],beforeSpawn,'native spawn changes local/physics data; render bytes wait for simulate');
  both(p,f=>f.glass._simulate(1/60));both(p,f=>f.upload());same(...p);
  assert.equal(p[1].glass.spos.updateRanges.length,0);assert.equal(p[1].glass.snrm.updateRanges.length,0);
  assert.equal(count(p[1]).payloadBytes,72);assert.equal(count(p[0]).payloadBytes,230400);
  const c=fixture(true,true);c.upload();
  assert.deepEqual(c.uploadCallbacks,[c.glass.spos,c.glass.snrm],'original upload callbacks keep their receiver');
  spawn(c);c.glass._simulate(1/60);c.upload();assert.equal(c.uploadCallbacks.length,4);
});

test('multi-tick and culled/deferred updates retain pending union; no per-tick range objects',()=>{
  const p=pair();both(p,f=>f.upload());both(p,f=>spawn(f,7));both(p,f=>f.glass._simulate(1/60));
  const posRange=p[1].glass.spos.updateRanges[0],normalRange=p[1].glass.snrm.updateRanges[0];
  both(p,f=>spawn(f,2));both(p,f=>f.glass._simulate(1/60));same(...p,false);
  assert.equal(p[1].glass.spos.updateRanges[0],posRange);assert.equal(p[1].glass.snrm.updateRanges[0],normalRange);
  assert.deepEqual([posRange.start,posRange.count],[18,54]);
  for(let tick=0;tick<24;tick++){both(p,f=>f.glass._simulate(1/60));same(...p,false);assert.equal(p[1].glass.spos.updateRanges.length,1);}
  both(p,f=>f.gl.calls.length=0);both(p,f=>f.upload());same(...p);
  assert.equal(count(p[1]).payloadBytes,432);assert.equal(count(p[1]).calls,2);
});

test('settled expiry and below-world retirement only dirty positions, without dropping earlier pending normals',()=>{
  for(const retire of ['settled','below']){
    const p=pair();both(p,f=>f.upload());both(p,f=>spawn(f));both(p,f=>f.glass._simulate(1/60));both(p,f=>f.upload());
    both(p,f=>{if(retire==='settled'){f.glass.sstate[0]=2;f.glass.slife[0]=14.1;}else{f.glass.sp[1]=-41;f.glass.sv[1]=-1;f.glass.sfloor[0]=-1e6;}});
    both(p,f=>f.gl.calls.length=0);const normalVersion=p[1].glass.snrm.version;
    both(p,f=>f.glass._simulate(1/60));assert.equal(p[1].glass.snrm.version,normalVersion);both(p,f=>f.upload());same(...p);
    assert.equal(count(p[1]).payloadBytes,36);assert.equal(count(p[1]).calls,1);
  }
  const p=pair();both(p,f=>f.upload());both(p,f=>spawn(f));both(p,f=>f.glass._simulate(1/60));
  both(p,f=>{f.glass.sstate[0]=2;f.glass.slife[0]=14.1;f.glass._simulate(1/60);});
  assert.equal(p[1].glass.snrm.updateRanges.length,1,'normals written before retirement remain pending');
  both(p,f=>f.upload());same(...p);
});

test('settle writes final normals once; sleeping shards preserve native RNG and no-update behavior',()=>{
  const p=pair();both(p,f=>f.upload());both(p,f=>spawn(f));
  both(p,f=>{f.glass.sp[1]=.001;f.glass.sv[1]=-1;f.glass._simulate(1/60);});same(...p,false);
  assert.equal(p[1].glass.sstate[0],2);assert.equal(p[1].glass.snrm.updateRanges.length,1);
  both(p,f=>f.upload());same(...p);both(p,f=>f.gl.calls.length=0);
  both(p,f=>f.glass._simulate(1/60));both(p,f=>f.upload());same(...p);assert.equal(count(p[1]).calls,0);
});

test('ring wrap/overwrite and reset retain exact CPU/GPU bytes, pending normals and original pane commit',()=>{
  const p=pair();both(p,f=>f.upload());both(p,f=>spawn(f,f.capacity-1));both(p,f=>spawn(f));
  both(p,f=>f.glass._simulate(1/60));assert.deepEqual([p[1].glass.spos.updateRanges[0].start,p[1].glass.spos.updateRanges[0].count],[0,28800]);
  both(p,f=>f.upload());same(...p);
  // Force the native 64-slot scan/overwrite branch, not a bespoke allocator.
  both(p,f=>{f.glass.cursor=0;f.glass.sstate.fill(1,0,65);f.glass.active=66;spawn(f);f.glass._simulate(1/60);});same(...p,false);
  both(p,f=>f.glass.reset());same(...p,false);
  assert.deepEqual([p[1].glass.spos.updateRanges[0].start,p[1].glass.spos.updateRanges[0].count],[0,28800]);
  assert.equal(p[1].glass.snrm.updateRanges.length,1);
  both(p,f=>spawn(f,100));both(p,f=>f.glass._simulate(1/60));both(p,f=>f.upload());same(...p);
  both(p,f=>f.glass.hit(f.glass.panes[0],0,1.4,new f.THREE.Vector3(0,0,1),.3));same(...p,false);
  for(const key of ['position','normal','uv','crack']){
    const a=p[0].glass.panes[0].mesh.geometry.attributes[key],b=p[1].glass.panes[0].mesh.geometry.attributes[key];
    assert.deepEqual(bytes(a.array),bytes(b.array),'retained pane '+key);assert.equal(b.updateRanges.length,0,'retained pane owner is unchanged');
  }
});

test('toggle safely carries native-full pending updates and fresh backend allocation after restore',()=>{
  const p=pair(false);assert.equal(p[1].glass.ghShardDirtyRanges,false);both(p,f=>f.upload());
  both(p,f=>spawn(f,2));both(p,f=>f.glass._simulate(1/60));p[1].glass.ghShardDirtyRanges=true;
  both(p,f=>f.upload());same(...p);both(p,f=>spawn(f,80));both(p,f=>f.glass._simulate(1/60));
  p[1].glass.ghShardDirtyRanges=false;both(p,f=>f.upload());same(...p);
  p[1].glass.ghShardDirtyRanges=true;const version=p[1].glass.spos.version;
  p[1].glass.ghShardDirtyRanges=true;assert.equal(p[1].glass.spos.version,version,'same toggle is idempotent');
  both(p,f=>{f.gl=fakeGL();f.up=f.Attributes(f.gl);f.upload=()=>{f.up.update(f.glass.spos,f.gl.ARRAY_BUFFER);f.up.update(f.glass.snrm,f.gl.ARRAY_BUFFER);};f.gpu=a=>f.up.get(a)?.buffer.data;});
  both(p,f=>f.upload());same(...p);assert.equal(p[1].glass.spos.updateRanges.length,0);
  both(p,f=>f.glass._simulate(1/60));both(p,f=>f.upload());same(...p);
});

test('legacy full-upload mode follows original path and seeded actual update cascades remain byte exact',()=>{
  const p=pair(false);both(p,f=>f.upload());both(p,f=>f.glass.shatter(f.glass.panes[0],0,1.5,new f.THREE.Vector3(0,0,1),1));
  for(let tick=0;tick<120;tick++){
    both(p,f=>f.glass.update(1/60));if(tick%3===2){both(p,f=>f.upload());same(...p);}
  }
  assert.deepEqual(count(p[0]),count(p[1]));
  p[1].glass.ghShardDirtyRanges=true;
  for(let tick=0;tick<900;tick++){
    both(p,f=>f.glass.update(1/60));if(tick%13===12){both(p,f=>f.upload());same(...p);}
  }
  both(p,f=>f.upload());same(...p);

});


test('normal startup enables owned shard ranges without a benchmark flag',()=>{
  const f=fixture(undefined);assert.equal(f.glass.ghShardDirtyRanges,true);
  f.upload();spawn(f,4);f.glass._simulate(1/60);f.gl.calls.length=0;f.upload();
  assert.equal(count(f).payloadBytes,72);
});
