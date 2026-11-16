// Small actual-Three CPU fixtures only; never a Godot render/complexity acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadBundle } from '../../../server/fixtures/bundle-probe.mjs';
const { THREE:T }=loadBundle(new URL('../../../game/core/game.js',import.meta.url));
const source=fs.readFileSync(new URL('./browser-exporter.js',import.meta.url),'utf8');
function fixture(){
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(70,16/9,.06,2500);camera.position.set(1,2,3);
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,0,0,1],3));
  g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();g.addGroup(0,3,0);g.addGroup(3,3,1);g.setDrawRange(0,6);
  const a=new T.MeshStandardMaterial({color:0xff0000}),b=new T.MeshStandardMaterial({color:0x00ff00});
  const mesh=new T.Mesh(g,[a,b]);mesh.name='actual-fixture';scene.add(mesh);
  const inst=new T.InstancedMesh(g,a,2);inst.setMatrixAt(1,new T.Matrix4().makeTranslation(4,0,0));scene.add(inst);
  const hidden=new T.Group();hidden.visible=false;hidden.add(new T.Mesh(g,a));scene.add(hidden);
  const gfx={scene,camera,quality:'high',renderer:{domElement:{width:1920,height:1080},info:{render:{calls:4,triangles:6,points:0,lines:0}}}};
  const GH={ready:true,G:{state:'paused'},loopStats:{logicalTicks:240},debug:{match:{bots:[]},physics:{bodies:[],props:[]},gfx}};
  const context=vm.createContext({performance,document:{documentElement:{dataset:{bundle:'fixture'}}},GH});
  vm.runInContext(source,context);return{context,api:context.__ghGodotExport,scene,g,mesh,inst};
}
test('capture keeps native geometry sharing, groups/range, instancing, visibility and returns only header',()=>{
  const f=fixture(),header=f.api.capture({coreSHA256:'fixture-not-real-capture'}),data=f.context.__ghGodotSnapshot;
  assert.equal(header.counts.objects,2);assert.equal(header.counts.geometries,1);assert.equal(header.counts.omitted.hidden,1);
  assert.equal(header.geometries,undefined);assert.equal(header.fullSerializationAttempted,false);
  assert.equal(data.objects[0].surfaces.length,2);assert.equal(data.objects[0].surfaces[1].slot,1);
  assert.equal(data.objects[1].instances.count,2);assert.equal(data.objects[1].surfaces.length,1);
  assert.equal(data.objects[0].matrix[12],0);assert.equal(data.parity.fullAI,false);
});
test('bounded streaming round-trips all data across large numeric arrays without whole-scene serialization',()=>{
  const f=fixture();f.api.capture();f.context.__ghGodotSnapshot.largeFixture=Array.from({length:50000},(_,i)=>i/13);
  f.context.__ghGodotSnapshot.astralFixture='😀🦊'.repeat(10000);
  f.api.begin();const chunks=[];let done=false;while(!done){const result=f.api.readChunk(4096);assert.ok(result.chunk.length<=4097);chunks.push(result.chunk);done=result.done;
    assert.ok(!/[\ud800-\udbff]$/.test(result.chunk));assert.ok(!/^[\udc00-\udfff]/.test(result.chunk));}
  const expected=JSON.stringify(f.context.__ghGodotSnapshot);assert.equal(chunks.join(''),expected);assert.equal(JSON.parse(chunks.join('')).largeFixture.length,50000);
  assert.ok(f.api.header().inventory.numericScalars>50000);f.api.release();assert.equal(f.context.__ghGodotSnapshot,null);
});
test('true skinned getVertexPosition is baked once with explicit normal/animation gap',()=>{
  const f=fixture(),g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));g.setIndex([0,1,2]);
  g.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Array(12).fill(0),4));
  g.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
  const bone=new T.Bone(),mesh=new T.SkinnedMesh(g,new T.MeshStandardMaterial());mesh.add(bone);mesh.bind(new T.Skeleton([bone]));bone.position.x=2;f.scene.add(mesh);
  f.api.capture();const data=f.context.__ghGodotSnapshot,obj=data.objects.find(o=>o.id===mesh.uuid),geo=data.geometries[obj.geometry];
  assert.equal(geo.position.values[0],2);assert.equal(geo.frozenPose,true);assert.equal(geo.normalPolicy,'recomputed_area_weighted_approximation');assert.equal(obj.skin.bones.length,1);
  assert.ok(data.unsupported.some(v=>v.kind==='frozen_pose_normals_approximate'));
});
