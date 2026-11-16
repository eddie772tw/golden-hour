// Live original affine transforms only. No vertex baking, pose replay or TRS loss.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const finite=values=>{for(const x of values)assert.ok(Number.isFinite(x),'Nonfinite native pose');};
const visible=node=>{for(let p=node;p;p=p.parent)if(!p.visible)return false;return true;};
const hashAttribute=a=>createHash('sha256').update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength)).digest('hex');
export function originalBodyModel(body) {
  if(body.type==='nade')return 'native-grenade';
  if(body.obj.name)return body.obj.name;
  // The only nameless dynamic addProp caller in pinned core is ND's shot ceiling.
  const g=body.obj.geometry?.parameters;
  assert.ok(body.temp&&body.mass===2&&body.mat==='plastic'&&body.obj.isMesh&&
    body.obj.geometry.type==='BoxGeometry'&&g.width===.58&&g.height===.02&&g.depth===.58,
    'Unregistered nameless native body');
  return 'native-ceiling-tile';
}

export function makePoseSource(graph) {
  const T=graph.runtime.THREE,skins=[],bodyIDs=new WeakMap(),unitIDs=new WeakMap();
  const rootInverse=new T.Matrix4(),matrix=new T.Matrix4(),cancellation=new T.Matrix4();
  function addSkin(rig,actor,rigIndex,id,firstPerson=false) {
    const mesh=rig.body,s=mesh.skeleton;
    assert.ok(mesh.isSkinnedMesh);assert.equal(mesh.bindMode,'attached');assert.equal(s.bones.length,34);
    assert.ok(mesh.bindMatrix.elements.every((v,i)=>Math.abs(v-identity[i])<1e-10));
    skins.push({rig,actor,rigIndex,id,firstPerson,team:rig.team,root:new Float32Array(16),palette:new Float32Array(s.bones.length*16)});
  }
  addSkin(graph.fpbody.op,graph.player,0,0,true);
  graph.match.bots.forEach((actor,index)=>actor.rigs.forEach((rig,rigIndex)=>addSkin(rig,actor,rigIndex,1+index*2+rigIndex)));
  let nextBody=graph.physics.props.length,nextUnit=0;
  const sourcePropIndex=new WeakMap();graph.physics.props.forEach((body,index)=>{bodyIDs.set(body,index);sourcePropIndex.set(body,index);});
  const modelNames=[...new Set([...graph.physics.props.map(b=>b.obj.name),...Object.keys(graph.runtime.weapons).map(id=>'gun_'+id),
    'magProp','native-ceiling-tile','native-grenade'])];
  const modelIDs=new Map(modelNames.map((name,index)=>[name,index]));
  const phases=['off','flight','slide','unfold','heel','hunt','attack','leap','recover','takedown','dead'];
  const operatorAssets=[0,1].map(team=>{
    const skin=skins.find(s=>!s.firstPerson&&s.team===team),g=skin.rig.body.geometry;
    return {team,bones:34,positionSHA256:hashAttribute(g.attributes.position),
      skinIndexSHA256:hashAttribute(g.attributes.skinIndex),skinWeightSHA256:hashAttribute(g.attributes.skinWeight)};
  });
  const manifest={schema:'gh-live-pose-v1',floatType:'Float32LE',matrixLayout:'Three column-major4x4',
    palette:'inverse(rootWorld)*boneWorld*originalInverseBind; client applies rootWorld once; DO NOT multiply inverse bind again',
    skins:skins.map(s=>({id:s.id,actor:s.firstPerson?0:graph.match.bots.indexOf(s.actor)+1,rigIndex:s.rigIndex,team:s.team,bones:34,firstPerson:s.firstPerson})),
    operatorAssets,bodyModels:modelNames,k9Phases:phases,
    originalDynamicModelSources:{magProp:'Original spawnMag factories:core40753/41349/42402, adopted by Arsenal._dropMag33041',
      'native-ceiling-tile':'Original ND onShot26225 exact0.58x0.02x0.58 BoxGeometry; no generic fallback',
      'gun_*':'Original Bot.die/dropWeapon45398','native-grenade':'Original Physics.throwGrenade'},
    initialBodies:graph.physics.props.map((b,index)=>({id:index,sourcePropIndex:index,name:b.obj.name,
      model:modelIDs.get(b.obj.name),homeP:b.home.p.toArray(),homeQ:b.home.q.toArray()})),
    completeSnapshot:true,missingPreviousBodyIDs:'hide/remove; each snapshot lists all current nondead box/nade bodies',
    bodyStride:80,k9Stride:32,
    gaps:['No static geometry/material transfer in this endpoint. Use separately validated original rest assets.',
      'K9 sends original position/yaw/phase only; its custom part deformation is not transferred.',
      'Operator body palettes are live; weapon/FPbody subset/FX/High materials are not a complete native port.']};
  function prepare() {
    graph.scene.updateMatrixWorld();graph.gfx.vmScene.updateMatrixWorld();
    for(const skin of skins) {
      const mesh=skin.rig.body,s=mesh.skeleton;
      s.update();
      cancellation.multiplyMatrices(mesh.matrixWorld,mesh.bindMatrixInverse);
      assert.ok(cancellation.elements.every((v,i)=>Math.abs(v-identity[i])<1e-8),'Attached cancellation changed');
      rootInverse.copy(skin.rig.root.matrixWorld).invert();skin.root.set(skin.rig.root.matrixWorld.elements);
      s.bones.forEach((bone,index)=>{
        matrix.multiplyMatrices(rootInverse,bone.matrixWorld).multiply(s.boneInverses[index]);
        skin.palette.set(matrix.elements,index*16);
      });
      finite(skin.root);finite(skin.palette);
    }
  }
  function encode(droppedSnapshots) {
    const bodies=graph.physics.bodies.filter(b=>!b.dead&&(b.type==='box'||b.type==='nade'));
    const units=graph.match.k9.units;
    const size=160+skins.reduce((n,s)=>n+88+s.palette.byteLength,0)+bodies.length*80+units.length*32;
    const bytes=Buffer.alloc(size);let at=0;
    const u=value=>{bytes.writeUInt32LE(value>>>0,at);at+=4;};
    const f=value=>{assert.ok(Number.isFinite(value));bytes.writeFloatLE(value,at);at+=4;};
    const mat=m=>{for(const x of m.elements??m)f(x);};
    u(skins.length);u(bodies.length);u(units.length);u(droppedSnapshots);
    mat(graph.camera.matrixWorld);mat(graph.camera.projectionMatrix);
    for(const x of [graph.camera.fov,graph.camera.aspect,graph.camera.near,graph.camera.far])f(x);
    for(const s of skins) {
      u(s.id);u((visible(s.rig.root)?1:0)|(s.actor.alive?2:0)|(s.firstPerson?4:0)|(s.actor.char===s.rig?8:0));
      u(s.firstPerson?0:graph.match.bots.indexOf(s.actor)+1);u(s.rigIndex);u(s.team);u(s.palette.length/16);
      mat(s.root);for(const x of s.palette)f(x);
    }
    for(const body of bodies) {
      if(!bodyIDs.has(body))bodyIDs.set(body,nextBody++);
      const model=originalBodyModel(body);
      assert.ok(modelIDs.has(model),'Unregistered original body model '+model);
      u(bodyIDs.get(body));u(modelIDs.get(model));
      u((visible(body.obj)?1:0)|(body.sleeping?2:0)|(body.temp?4:0)|(body.type==='nade'?8:0));
      u(sourcePropIndex.get(body)??0xffffffff);mat(body.obj.matrixWorld);
    }
    for(const unit of units) {
      if(!unitIDs.has(unit))unitIDs.set(unit,nextUnit++);
      const phase=phases.indexOf(unit.phase);assert.ok(phase>=0,'Unknown native K9 phase '+unit.phase);
      u(unitIDs.get(unit));u(unit.team);u(unit.alive?1:0);u(phase);
      f(unit.pos.x);f(unit.pos.y);f(unit.pos.z);f(unit.yaw);
    }
    assert.equal(at,bytes.length);
    return {bytes,skins:skins.length,bodies:bodies.length,k9:units.length};
  }
  return {manifest,prepare,encode};
}
