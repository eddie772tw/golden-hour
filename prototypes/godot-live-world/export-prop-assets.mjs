// Read-only original factory prop-template extraction, before START. No Three objects are created.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const hash=value=>createHash('sha256').update(value).digest('hex');
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
const finite=array=>{for(const n of array)assert.ok(Number.isFinite(n),'Nonfinite original prop data');return array;};
function multiply(a,b){const out=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return finite(out);}
function localMatrix(node){
  if(node.matrixAutoUpdate===false)return finite(Array.from(node.matrix.elements));
  // Compute into independent scalar data; never call updateMatrix/updateMatrixWorld on the source.
  const {x,y,z,w}=node.quaternion,s=node.scale,p=node.position;
  const x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
  return finite([(1-yy-zz)*s.x,(xy+wz)*s.x,(xz-wy)*s.x,0,(xy-wz)*s.y,(1-xx-zz)*s.y,(yz+wx)*s.y,0,
    (xz+wy)*s.z,(yz-wx)*s.z,(1-xx-yy)*s.z,0,p.x,p.y,p.z,1]);
}
class Store {
  chunks=[];length=0;known=new WeakMap();
  add(array){
    assert.ok(ArrayBuffer.isView(array)&&!(array instanceof DataView));
    if(this.known.has(array))return this.known.get(array);
    const pad=(8-this.length%8)%8;if(pad){this.chunks.push(Buffer.alloc(pad));this.length+=pad;}
    const value=bytes(array),record={type:array.constructor.name,byteOffset:this.length,byteLength:value.length,length:array.length,sha256:hash(value)};
    this.chunks.push(Buffer.from(value));this.length+=value.length;this.known.set(array,record);return record;
  }
  finish(){return Buffer.concat(this.chunks,this.length);}
}
function attrValues(a){
  if(!a.isInterleavedBufferAttribute)return a.array;
  const source=a.data.array,out=new source.constructor(a.count*a.itemSize);
  for(let i=0;i<a.count;i++)for(let j=0;j<a.itemSize;j++)out[i*a.itemSize+j]=source[i*a.data.stride+a.offset+j];
  return out;
}
function textureMetadata(t){
  const image=t.image||t.source?.data;
  return {sourceUUID:t.uuid,name:t.name,width:image?.width??null,height:image?.height??null,
    colorSpace:t.colorSpace,flipY:t.flipY,type:t.type,format:t.format,wrapS:t.wrapS,wrapT:t.wrapT,
    minFilter:t.minFilter,magFilter:t.magFilter,anisotropy:t.anisotropy,
    repeat:t.repeat?{x:t.repeat.x,y:t.repeat.y}:null,offset:t.offset?{x:t.offset.x,y:t.offset.y}:null,
    pixelsExported:false,pixelSourceKind:image?.data?'typed pixel source, not copied by this geometry exporter':image?.constructor?.name??'absent'};
}
export function capturePropAssets(graph,{initializerSHA256,expectedProps=101}={}){
  assert.equal(new Uint8Array(new Uint16Array([1]).buffer)[0],1,'Little-endian writer required');
  assert.equal(graph.physics.props.length,expectedProps,'Original initial prop count changed');
  assert.match(initializerSHA256??'',/^[a-f0-9]{64}$/,'Pass exact immutable initializer hash');
  assert.match(graph.sourceSHA256??'',/^[a-f0-9]{64}$/);
  assert.ok(!graph.hostContext?.GH?.benchmark,'Export original rest assets before controller installation/START');
  const store=new Store(),geometries=[],materials=[],geometryIDs=new WeakMap(),materialIDs=new WeakMap();
  function attribute(a){
    const data=attrValues(a);finite(data);
    return {...store.add(data),itemSize:a.itemSize,count:a.count,normalized:!!a.normalized,
      sourceInterleaved:!!a.isInterleavedBufferAttribute,sourceInstanced:!!a.isInstancedBufferAttribute};
  }
  function geometry(g){
    if(geometryIDs.has(g))return geometryIDs.get(g);
    const id=geometries.length;geometryIDs.set(g,id);
    const attributes=Object.fromEntries(Object.entries(g.attributes).map(([name,a])=>[name,attribute(a)]));
    assert.equal(g.attributes.position.normalized,false,'Canonical capture fingerprint requires original nonnormalized positions');
    const morphAttributes=Object.fromEntries(Object.entries(g.morphAttributes??{}).map(([name,list])=>[name,list.map(attribute)]));
    const index=g.index?attribute(g.index):null;
    const canonicalPosition=Float32Array.from(attrValues(g.attributes.position));
    const canonicalIndex=g.index?Uint32Array.from(attrValues(g.index)):Uint32Array.from({length:g.attributes.position.count},(_,i)=>i);
    geometries.push({id,sourceUUID:g.uuid,type:g.type,attributes,index,groups:g.groups.map(v=>({...v,count:Number.isFinite(v.count)?v.count:null})),
      drawRange:{start:g.drawRange.start,count:Number.isFinite(g.drawRange.count)?g.drawRange.count:null},
      morphAttributes,morphTargetsRelative:!!g.morphTargetsRelative,
      nativeInstanceCount:g.isInstancedBufferGeometry?g.instanceCount:null,
      captureMatch:{positionFloat32SHA256:hash(bytes(canonicalPosition)),indexUint32SHA256:hash(bytes(canonicalIndex)),
        vertexCount:g.attributes.position.count,indexCount:canonicalIndex.length},
      allOriginalAttributeNames:Object.keys(g.attributes)});
    return id;
  }
  function material(m){
    if(materialIDs.has(m))return materialIDs.get(m);
    const id=materials.length;materialIDs.set(m,id);
    const textures={};for(const key of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap','envMap','displacementMap'])if(m[key])textures[key]=textureMetadata(m[key]);
    materials.push({id,sourceUUID:m.uuid,name:m.name,type:m.type,color:m.color?[m.color.r,m.color.g,m.color.b]:null,
      emissive:m.emissive?[m.emissive.r,m.emissive.g,m.emissive.b]:[0,0,0],emissiveIntensity:m.emissiveIntensity??1,
      opacity:m.opacity,transparent:!!m.transparent,roughness:m.roughness??1,metalness:m.metalness??0,
      alphaTest:m.alphaTest,side:m.side,blending:m.blending,vertexColors:!!m.vertexColors,visible:m.visible!==false,
      depthTest:m.depthTest!==false,depthWrite:m.depthWrite!==false,colorWrite:m.colorWrite!==false,stencilWrite:!!m.stencilWrite,
      shaderMaterial:!!(m.isShaderMaterial||m.isRawShaderMaterial),customCompile:!!m._ghUser,
      shaderHookSHA256:typeof m.onBeforeCompile==='function'?hash(Function.prototype.toString.call(m.onBeforeCompile)):null,
      textures,shaderTranslated:false});
    return id;
  }
  const props=graph.physics.props.map((body,index)=>{
    assert.equal(body.type,'box');assert.ok(!body.temp&&!body.dead,'Initial original props only');
    const root=body.obj,children=[];
    function visit(node,path,relative,parentVisible){
      const ownVisible=node.visible!==false,insideVisible=path===''?true:parentVisible&&ownVisible;
      const current=path===''?relative:multiply(relative,localMatrix(node));
      if(node.isMesh||node.isLine||node.isPoints){
        assert.ok(!node.isSkinnedMesh,'Skinned prop needs its own live affine driver');
        const g=node.geometry;assert.ok(g?.attributes.position,'Missing original prop geometry');
        const mats=Array.isArray(node.material)?node.material:[node.material];
        let instances=null;
        if(node.isInstancedMesh)instances={count:node.count,matrix:store.add(node.instanceMatrix.array),
          colors:node.instanceColor?attribute(node.instanceColor):null};
        children.push({path,sourceUUID:node.uuid,name:node.name,type:node.type,geometry:geometry(g),
          materials:mats.map(material),materialArray:Array.isArray(node.material),relativeMatrix:current,
          ownVisible,effectiveVisibleWithinRoot:insideVisible,layers:node.layers.mask,castShadow:!!node.castShadow,
          receiveShadow:!!node.receiveShadow,frustumCulled:node.frustumCulled!==false,renderOrder:node.renderOrder,
          primitive:node.isPoints?'points':node.isLineSegments?'lines':node.isLineLoop?'line_loop':node.isLine?'line_strip':'triangles',instances});
      }
      node.children.forEach((child,i)=>visit(child,path+'/'+i+':'+child.name,current,insideVisible));
    }
    visit(root,'',IDENTITY,true);
    assert.ok(children.length>0,'Empty original prop template');
    return {sourcePropIndex:index,sourceRootUUID:root.uuid,sourceRootType:root.type,name:root.name,
      homeP:finite([body.home.p.x,body.home.p.y,body.home.p.z]),homeQ:finite([body.home.q.x,body.home.q.y,body.home.q.z,body.home.q.w]),
      rootInitialScale:finite([root.scale.x,root.scale.y,root.scale.z]),children};
  });
  const binary=store.finish();
  const packet={schema:'gh-original-prop-rest-v1',source:{coreSHA256:graph.sourceSHA256,initializerSHA256,
    exporterSHA256:hash(readFileSync(new URL(import.meta.url))),phase:'After original initialization/reset, before START/controller/ticks',
    owner:'graph.physics.props[index].obj original factory graph; no clones/UUID creation/RNG consumption/scene writes'},
    binary:{uri:'props.rest.bin',bytes:binary.length,sha256:hash(binary),endianness:'little'},
    props,geometries,materials,counts:{props:props.length,children:props.reduce((n,p)=>n+p.children.length,0),geometries:geometries.length,materials:materials.length},
    convention:{matrix:'Column-major original relative transforms; liveBodyWorld * childRelative; do not apply home/root twice',
      geometry:'Original factory local attributes, not captured tick240 posed/world vertices',winding:'Source CCW retained; Godot consumer reverses triangle second/third indices exactly once'},
    limits:['Only initial immutable props; dynamic gun/magProp/ceiling tile/grenade and K9 geometry remain unmapped.',
      'All attributes/morph/instancing data preserved; arbitrary custom shader/High/normal law unported.',
      'Material/texture roles are metadata; texture pixels and shader code are not translated.',
      'Internal child animation after START is not in body-root stream; no silent rest-template equivalence claim.',
      'Static capture prop nodes may only be excluded after owner/path/core/geometry evidence matches this manifest.']};
  return {packet,binary};
}
export function exportPropAssets(graph,{outputDirectory,initializerSHA256,expectedProps=101}={}){
  assert.ok(outputDirectory,'Provide a new output directory');
  const directory=resolve(outputDirectory),jsonPath=join(directory,'props.rest.json'),binaryPath=join(directory,'props.rest.bin');
  assert.ok(!existsSync(jsonPath)&&!existsSync(binaryPath),'Do not overwrite original asset evidence');
  const {packet,binary}=capturePropAssets(graph,{initializerSHA256,expectedProps});
  mkdirSync(directory,{recursive:true});writeFileSync(binaryPath,binary,{flag:'wx'});
  const data=Buffer.from(JSON.stringify(packet,null,2)+'\n');writeFileSync(jsonPath,data,{flag:'wx'});
  return {packet,binary,jsonPath,binaryPath,jsonSHA256:hash(data),binarySHA256:packet.binary.sha256,counts:packet.counts};
}
