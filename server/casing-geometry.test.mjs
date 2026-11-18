import test from 'node:test';
import assert from 'node:assert/strict';
import {casing,setCasingDetail} from '../scripts/performance/export_casing_geometry.mjs';
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
test('explicit original/high A/B modes preserve original geometry bytes exactly',()=>{
 const profile=[[0,-.5],[.17,-.5],[.17,-.492],[.47,-.492],[.5,-.47],[.5,-.455],[.43,-.44],[.43,-.405],[.47,-.385],[.47,.5],[.405,.5],[.4,.15],[0,.15]];
 const reference=new casing.Lathe(profile.map(([x,y])=>new casing.Vector(x*.5,y)),18);
 reference.rotateX(Math.PI/2);reference.translate(0,-.25,0);reference.computeVertexNormals();
 for(const value of ['original','high']){
  const g=casing.make(value);assert.equal(g.index.count/3,432);
  for(const key of ['position','normal','uv'])assert.deepEqual(bytes(g.attributes[key].array),bytes(reference.attributes[key].array),key);
  assert.deepEqual(bytes(g.index.array),bytes(reference.index.array));
 }
});
test('reduced casings preserve radial/axial design envelope, mouth and inner floor; all indices/normals valid',()=>{
 for(const [detail,triangles] of [['medium',112],['low',84]]){
  const g=casing.make(detail),p=g.attributes.position,n=g.attributes.normal;
  assert.equal(g.index.count/3,triangles);assert.ok(g.index.array.every(i=>i>=0&&i<p.count));
  let radius=0,min=Infinity,max=-Infinity,mouth=false,floor=false;
  for(let i=0;i<p.count;i++){
   const x=p.getX(i),y=p.getY(i)+.25,z=p.getZ(i);radius=Math.max(radius,Math.hypot(x,y));min=Math.min(min,z);max=Math.max(max,z);
   mouth ||= Math.abs(z-.5)<1e-6&&Math.abs(Math.hypot(x,y)-.2)<1e-6;
   floor ||= Math.abs(z-.15)<1e-6&&Math.hypot(x,y)<1e-6;
   assert.ok([x,y,z,n.getX(i),n.getY(i),n.getZ(i)].every(Number.isFinite));
  }
  assert.ok(Math.abs(radius-.25)<1e-6);assert.ok(Math.abs(min+.5)<1e-6);assert.ok(Math.abs(max-.5)<1e-6);
  assert.ok(mouth);assert.ok(floor);
 }
});

test('default and invalid detail values use byte-exact 84-triangle low geometry',()=>{
 const reference=casing.make('low');
 for(const value of [undefined,null,'unknown','',false,84]){
  const g=casing.make(value);assert.equal(g.index.count/3,84);
  for(const key of ['position','normal','uv'])assert.deepEqual(bytes(g.attributes[key].array),bytes(reference.attributes[key].array));
  assert.deepEqual(bytes(g.index.array),bytes(reference.index.array));
 }
});
test('actual startup styling defaults to 84, honors original A/B and leaves pool lifecycle unchanged',()=>{
 const T=casing.THREE;
 try {
  for(const [detail,triangles] of [[undefined,84],['original',432],['medium',112]]){
   setCasingDetail(detail);
   const p=new casing.Physics(new T.Scene(),{overlap:()=>false},{audio:{casing(){}}});
   const old=p.caseMesh.geometry;let disposed=0;old.addEventListener('dispose',()=>disposed++);
   const matrices=bytes(p.caseMesh.instanceMatrix.array).toString('hex');
   casing.style.call({physics:p});
   assert.equal(p.caseMesh.geometry.index.count/3,triangles);assert.equal(disposed,1);
   assert.equal(p.caseMesh.count,90);assert.equal(p.cases.live,0);assert.equal(p.cases.i,0);
   assert.equal(p.caseMesh.castShadow,true);assert.equal(p.caseMesh.frustumCulled,false);
   assert.equal(bytes(p.caseMesh.instanceMatrix.array).toString('hex'),matrices);
   assert.equal(p.caseMesh.material.customProgramCacheKey(),'gh-brass-1');
   const current=p.caseMesh.geometry;casing.style.call({physics:p});assert.equal(p.caseMesh.geometry,current);assert.equal(disposed,1);
  }
 } finally {setCasingDetail(undefined);}
});
