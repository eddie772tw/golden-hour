// Offline actual-source geometry and dirty-upload inventory; no frame-time claims.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const bytes=readFileSync(new URL('../../game/core/game.js',import.meta.url));
const source=bytes.toString('utf8'),cut=source.lastIndexOf('\n  As0().catch(');assert.ok(cut>0);
const forbidden=()=>{throw Error('This inventory must not access DOM/audio/GPU');};
const c={console,URLSearchParams,URL,AbortController,DOMException,TextEncoder,TextDecoder,
 performance:{now:()=>0},location:{search:'?solo'},navigator:{userAgent:'offline-pool-audit'},addEventListener(){},
 localStorage:{getItem(){return null;},setItem(){}},document:{addEventListener(){},createElement:forbidden},
 setTimeout:forbidden,clearTimeout(){},requestAnimationFrame:forbidden,AudioContext:forbidden};c.window=c;c.self=c;
vm.runInNewContext(source.slice(0,cut)+'\nglobalThis.audit={Physics:_w,style:$M.prototype._styleCasings,Decals:KM,THREE:Ct};\n})();',c,{timeout:10000});
const {Physics,style,Decals,THREE:T}=c.audit;
const physics=new Physics(new T.Scene(),{overlap:()=>false},{audio:{casing(){}}});
const inventory=(mesh)=>{
 const g=mesh.geometry;return {capacity:mesh.count,vertices:g.attributes.position.count,
  trianglesPerInstance:(g.index?.count??g.attributes.position.count)/3,
  trianglesPerDrawAtFixedCapacity:mesh.count*(g.index?.count??g.attributes.position.count)/3,
  geometryAttributeBytes:Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0),indexBytes:g.index?.array.byteLength??0,
  instanceMatrixBytes:mesh.instanceMatrix.array.byteLength,instanceColorBytes:mesh.instanceColor.array.byteLength,
  frustumCulled:mesh.frustumCulled,castShadow:mesh.castShadow};
};
const casingBefore=inventory(physics.caseMesh);style.call({physics});const casingAfter=inventory(physics.caseMesh);
assert.equal(physics.cases.live,0);assert.equal(physics.chunks.live,0);
// Constructor capacity is checked against the actual owning call site. The texture
// factory is intentionally excluded, so this is not a complete real-scene load.
assert.match(source,/this\.decals = new KM\(600,/);
const n=600,d=Object.create(Decals.prototype);
Object.assign(d,{max:n,i:0,full:false,time:1,mesh:new T.InstancedMesh(new T.PlaneGeometry(),new T.MeshBasicMaterial(),n),
 aRect:new T.InstancedBufferAttribute(new Float32Array(n*4),4),aInfo:new T.InstancedBufferAttribute(new Float32Array(n*4),4),
 px:new Float32Array(n*3),kind:new Uint8Array(n),uniforms:{uDecalHead:{value:0},uDecalFull:{value:0}}});
d.mesh.setColorAt(0,new T.Color());
d.add('metal',new T.Vector3(1,2,3),new T.Vector3(0,1,0),.1,null,0,150);
const attributes=[d.mesh.instanceMatrix,d.mesh.instanceColor,d.aRect,d.aInfo];
assert.ok(attributes.every(a=>a.version===1&&a.updateRanges.length===0));
const result={sourceSHA256:createHash('sha256').update(bytes).digest('hex'),
 interpretation:'Actual-source offline inventory, not observed draws, bandwidth or GPU time. Fixed-capacity totals apply only if that mesh is submitted by a pass.',
 emptyPools:{casingBeforeStyle:casingBefore,casingAfterStyle:casingAfter,debris:inventory(physics.chunkMesh)},
 decalSingleAdd:{capacity:n,changedSlots:1,dirtyAttributes:4,fullBufferBytes:attributes.reduce((n,a)=>n+a.array.byteLength,0),
  changedSlotBytes:(16+3+4+4)*4,uploadRanges:attributes.map(a=>a.updateRanges.length)},
 recommendations:['Profile empty/low occupancy per-pass instance submissions before a high-water count candidate. Preserve ring slot identity and full-capacity reset.',
  'Profile decal add frequency and upload owner bytes before a four-attribute pending-span candidate. No per-frame bandwidth estimate follows from one add.']};
console.log(JSON.stringify(result,null,2));
