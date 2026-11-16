// Tiny metadata/typed-byte unit fixture only; NOT an original world or AI acceptance run.
import assert from 'node:assert/strict';
import {capturePropAssets} from './export-prop-assets.mjs';
const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const blocked=()=>{throw Error('Source mutation/clone/UUID or random call');};
const attribute=(array,itemSize,normalized=false)=>({array,itemSize,normalized,count:array.length/itemSize});
const geometry={uuid:'already-existing-geometry',type:'BufferGeometry',
  attributes:{position:attribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3),normal:attribute(new Float32Array([0,0,1,0,0,1,0,0,1]),3),
    uv:attribute(new Float32Array([0,0,1,0,0,1]),2),customAux:attribute(new Uint8Array([1,2,3]),1,true)},
  index:attribute(new Uint16Array([0,1,2]),1),groups:[],drawRange:{start:0,count:Infinity},morphAttributes:{}};
const material={uuid:'already-existing-material',name:'unit-role',type:'MeshStandardMaterial',color:{r:.2,g:.3,b:.4},
  opacity:1,side:0,blending:1,alphaTest:0,onBeforeCompile:blocked};
function node(name,children=[],mesh=false){return {name,uuid:'already-existing-'+name,type:mesh?'Mesh':'Group',children,
  visible:true,matrixAutoUpdate:true,position:{x:0,y:0,z:0},quaternion:{x:0,y:0,z:0,w:1},scale:{x:1,y:1,z:1},
  matrix:{elements:I},clone:blocked,updateMatrix:blocked,updateMatrixWorld:blocked,
  isMesh:mesh,geometry:mesh?geometry:undefined,material:mesh?material:undefined,layers:{mask:1}};}
const leaf=node('leaf',[],true);leaf.position={x:1,y:2,z:3};
const branch=node('branch',[leaf]);branch.matrixAutoUpdate=false;branch.matrix={elements:[...I]};branch.matrix.elements[4]=.25;branch.matrix.elements[12]=4;
const root=node('original-unit-prop',[branch]);root.position.x=20;root.position.z=9;
const home={p:{x:20,y:0,z:9},q:{x:0,y:0,z:0,w:1}};
const graph={sourceSHA256:'b'.repeat(64),physics:{props:[{type:'box',temp:false,dead:false,obj:root,home}]}};
const before=JSON.stringify(graph),random=Math.random;let result;
try{Math.random=blocked;result=capturePropAssets(graph,{initializerSHA256:'a'.repeat(64),expectedProps:1});}
finally{Math.random=random;}
assert.equal(JSON.stringify(graph),before,'Exporter must not mutate source graph or typed attributes');
assert.equal(result.packet.props.length,1);assert.equal(result.packet.geometries.length,1);
const child=result.packet.props[0].children[0];
assert.equal(child.path,'/0:branch/0:leaf');assert.deepEqual(child.relativeMatrix.slice(12,15),[5.5,2,3]);
assert.equal(child.relativeMatrix[4],.25,'Full affine child transform must not be decomposed');
assert.equal(result.packet.geometries[0].attributes.customAux.normalized,true);
assert.equal(result.packet.geometries[0].allOriginalAttributeNames.includes('customAux'),true);
for(const [name,a]of Object.entries(geometry.attributes)){
  const record=result.packet.geometries[0].attributes[name];
  assert.deepEqual(result.binary.subarray(record.byteOffset,record.byteOffset+record.byteLength),Buffer.from(a.array.buffer));
}
assert.equal(result.packet.source.phase,'After original initialization/reset, before START/controller/ticks');
assert.throws(()=>capturePropAssets(graph,{initializerSHA256:'a'.repeat(64)}),/prop count/);
assert.throws(()=>capturePropAssets(graph,{initializerSHA256:'wrong',expectedProps:1}),/initializer hash/);
console.log('PASS tiny prop metadata fixture: no source writes/clone/RNG, nested full affine relative transform, all typed attributes and role metadata; no full-world/AI/GPU claim');
