// Actual owning rig -> explicit rest geometry and live Skeleton3D/Skin packet.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const elements=m=>Array.from(m.elements);
const nearIdentity=m=>m.elements.every((v,i)=>Math.abs(v-identity[i])<1e-10);
export function multiply(a,b){
  const out=Array(16).fill(0);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];
  return out;
}
export function point(m,p){return [0,1,2].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]);}
export function reverseWinding(index){
  assert.equal(index.length%3,0);
  const output=new index.constructor(index);
  for(let i=0;i<output.length;i+=3)[output[i+1],output[i+2]]=[output[i+2],output[i+1]];
  return output;
}
export class BinaryWriter {
  chunks=[]; length=0;
  add(array,itemSize=1,normalized=false){
    assert.ok(ArrayBuffer.isView(array)&&!(array instanceof DataView));
    const padding=(8-this.length%8)%8;
    if(padding){this.chunks.push(Buffer.alloc(padding));this.length+=padding;}
    const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);
    const record={type:array.constructor.name,byteOffset:this.length,byteLength:bytes.length,length:array.length,itemSize,
      count:array.length/itemSize,normalized,sha256:sha256(bytes)};
    this.chunks.push(Buffer.from(bytes));this.length+=bytes.length;
    return record;
  }
  finish(){return Buffer.concat(this.chunks,this.length);}
}
export function exportRig(rig,T,writer,{team=rig.team}={}){
  rig.root.updateMatrixWorld(true);rig.body.skeleton.update();
  const mesh=rig.body,g=mesh.geometry,s=mesh.skeleton;
  assert.ok(mesh.isSkinnedMesh&&s.bones.length,'Actual live SkinnedMesh required');
  assert.equal(mesh.bindMode,'attached','v1 only proves attached operator skinning');
  assert.ok(nearIdentity(mesh.bindMatrix),'v1 only proves shipped identity bindMatrix');
  assert.ok(nearIdentity(new T.Matrix4().multiplyMatrices(mesh.matrixWorld,mesh.bindMatrixInverse)),
    'Attached cancellation must hold; do not silently reapply mesh world');
  assert.equal(Object.keys(g.morphAttributes).length,0,'Morph targets require a separate proof');
  const attributes={};
  for(const [name,a] of Object.entries(g.attributes)){
    assert.ok(!a.isInterleavedBufferAttribute&&!a.isInstancedBufferAttribute,'Unproved attribute layout');
    assert.equal(a.count,g.attributes.position.count);
    attributes[name]=writer.add(a.array,a.itemSize,a.normalized);
  }
  for(const name of ['position','normal','uv','skinIndex','skinWeight'])assert.ok(attributes[name],name);
  const count=g.drawRange.count===Infinity?g.index.count-g.drawRange.start:g.drawRange.count;
  assert.equal(g.drawRange.start%3,0);assert.equal(count%3,0);
  const selected=g.index.array.slice(g.drawRange.start,g.drawRange.start+count);
  const bones=s.bones.map((bone,index)=>({index,name:bone.name||`source_bone_${index.toString().padStart(2,'0')}`,
    sourceName:bone.name,parent:s.bones.indexOf(bone.parent),inverseBind:elements(s.boneInverses[index]),
    restGlobal:elements(s.boneInverses[index].clone().invert())}));
  for(const bone of bones){
    const global=new T.Matrix4().fromArray(bone.restGlobal);
    bone.restLocal=bone.parent<0?elements(global):elements(new T.Matrix4().fromArray(bones[bone.parent].restGlobal).invert().multiply(global));
  }
  const material=mesh.material;
  return {team,sourceMeshName:mesh.name,sourceGeometryUUID:g.uuid,vertices:g.attributes.position.count,
    attributes,index:writer.add(g.index.array),godotClockwiseIndex:writer.add(reverseWinding(selected)),
    drawRange:{...g.drawRange,count},groups:g.groups.map(group=>({...group})),
    fp:writer.add(g.userData.fp),triangles:g.userData.triangles,
    bindMode:mesh.bindMode,bindMatrix:elements(mesh.bindMatrix),bones,
    material:{name:material.name,type:material.type,sourceUUID:material.uuid,side:material.side,
      transparent:material.transparent,opacity:material.opacity,
      shaderHookSHA256:sha256(material.onBeforeCompile.toString()),
      shaderTranslated:false,texturesTransferred:false},
    preservedButNotMappedToGodotHigh:Object.keys(attributes).filter(name=>!['position','normal','uv','color','skinIndex','skinWeight'].includes(name)),
    frames:[]};
}
export function capturePose(rig,T,{label,tick},writer){
  rig.root.updateMatrixWorld(true);rig.body.skeleton.update();
  const mesh=rig.body,rootInverse=rig.root.matrixWorld.clone().invert(),s=mesh.skeleton;
  const global=s.bones.map(b=>new T.Matrix4().multiplyMatrices(rootInverse,b.matrixWorld));
  const local=global.map((m,i)=>{
    const parent=s.bones.indexOf(s.bones[i].parent);
    return parent<0?m.clone():global[parent].clone().invert().multiply(m);
  });
  let maxTRSError=0;const localBoneTRS=[];
  for(const m of local){
    const p=new T.Vector3(),q=new T.Quaternion(),scale=new T.Vector3();
    // The real hidden-mag bone has an exactly zero basis. Decomposing it divides by zero.
    // Identity quaternion + zero scale reconstructs the ORIGINAL affine matrix exactly.
    if([0,1,2,4,5,6,8,9,10].every(i=>Math.abs(m.elements[i])<1e-12)){
      p.setFromMatrixPosition(m);q.identity();scale.set(0,0,0);
    }else m.decompose(p,q,scale);
    const round=new T.Matrix4().compose(p,q,scale);
    for(let j=0;j<16;j++)maxTRSError=Math.max(maxTRSError,Math.abs(m.elements[j]-round.elements[j]));
    localBoneTRS.push({position:p.toArray(),rotation:q.toArray(),scale:scale.toArray()});
  }
  const vertices=mesh.geometry.attributes.position.count,golden=new Float32Array(vertices*3),v=new T.Vector3();
  for(let i=0;i<vertices;i++){mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld);v.toArray(golden,i*3);}
  return {label,tick,rootWorld:elements(rig.root.matrixWorld),meshWorld:elements(mesh.matrixWorld),
    bindMatrixInverse:elements(mesh.bindMatrixInverse),globalBonePoses:global.map(elements),localBonePoses:local.map(elements),localBoneTRS,
    maxPoseTRSRecomposeError:maxTRSError,requiresAffinePalette:maxTRSError>=1e-6,nativeWorldPositionGolden:writer.add(golden,3),
    source:'Original rig.update/renderFromJoints + SkinnedMesh.getVertexPosition; no synthesized bone animation'};
}
export function readAttribute(buffer,record){
  const types={Float32Array,Float64Array,Uint8Array,Uint16Array,Uint32Array,Int32Array};
  const Type=types[record.type];assert.ok(Type,'Unknown array type');
  const bytes=buffer.subarray(record.byteOffset,record.byteOffset+record.byteLength);
  assert.equal(sha256(bytes),record.sha256,'Corrupt attribute');
  const copy=Uint8Array.from(bytes);
  return new Type(copy.buffer,0,record.length);
}
// Independent scalar target equation, using serialized data rather than source objects.
export function godotWorldPositions(asset,frame,buffer,{float32Palette=false}={}){
  const p=readAttribute(buffer,asset.attributes.position),ids=readAttribute(buffer,asset.attributes.skinIndex),
    weights=readAttribute(buffer,asset.attributes.skinWeight),out=new Float64Array(p.length);
  const palette=asset.bones.map((bone,i)=>{
    const m=multiply(frame.globalBonePoses[i],bone.inverseBind);
    return float32Palette?Array.from(Float32Array.from(m)):m;
  });
  for(let i=0;i<asset.vertices;i++){
    const v=[p[i*3],p[i*3+1],p[i*3+2]],local=[0,0,0];
    for(let j=0;j<4;j++){
      const weight=weights[i*4+j],bone=ids[i*4+j];
      assert.ok(bone<palette.length&&weight>=0&&Number.isFinite(weight));
      if(weight){const skinned=point(palette[bone],v);for(let k=0;k<3;k++)local[k]+=weight*skinned[k];}
    }
    const world=point(frame.rootWorld,local);for(let k=0;k<3;k++)out[i*3+k]=world[k];
  }
  return out;
}
