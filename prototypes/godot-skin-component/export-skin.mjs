import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {loadRuntime,REPO} from '../godot-node-logic/load-runtime.mjs';
import {createAssetBoot} from '../godot-node-logic/asset-boot.mjs';
import {BinaryWriter,exportRig,capturePose,godotWorldPositions,readAttribute,sha256} from './skin-data.mjs';

export function buildSkinFixture(){
  assert.equal(new Uint8Array(new Uint16Array([1]).buffer)[0],1,'Writer requires little-endian host');
  const boot=createAssetBoot(),loaded=loadRuntime({boot}),{runtime:r,context}=loaded;
  let seed=5281;context.Math=Object.create(Math);
  context.Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const writer=new BinaryWriter(),assets=[];
  for(const team of [0,1]){
    const rig=r.makeCharacter({team,ground:()=>0});
    const asset=exportRig(rig,r.THREE,writer,{team});assets.push(asset);
    let tick=0;
    const capture=label=>asset.frames.push(capturePose(rig,r.THREE,{label,tick},writer));
    capture('original-constructor-joints');
    const pos=new r.THREE.Vector3();
    for(let i=1;i<=45;i++){
      r.state.time=++tick/60;pos.set(i*.025,0,-i*.04);
      rig.update(1/60,{pos,yaw:.4,pitch:.1,stance:'stand',engage:true});
    }
    capture('original-walking-update-45');
    for(let i=0;i<25;i++){
      r.state.time=++tick/60;
      rig.update(1/60,{pos,yaw:1.1,pitch:-.2,stance:'crouch',engage:true});
    }
    capture('original-crouch-update-70');
    // Transform the original parent, never synthesize bone matrices: checks root double-transform.
    rig.root.position.set(3.25,.7,-4.5);rig.root.rotation.y=.63;rig.root.updateMatrix();
    capture('same-original-pose-transformed-parent');
  }
  const binary=writer.finish();
  const validation=[];
  for(const asset of assets)for(const frame of asset.frames){
    const golden=readAttribute(binary,frame.nativeWorldPositionGolden),target=godotWorldPositions(asset,frame,binary),
      f32=godotWorldPositions(asset,frame,binary,{float32Palette:true});
    let maxError=0,maxFloat32PaletteError=0;
    for(let i=0;i<golden.length;i++){
      maxError=Math.max(maxError,Math.abs(target[i]-golden[i]));
      maxFloat32PaletteError=Math.max(maxFloat32PaletteError,Math.abs(f32[i]-golden[i]));
    }
    assert.ok(maxError<2e-6,'Serialized scalar skinning differs from native world golden');
    assert.ok(maxFloat32PaletteError<3e-6,'Float32 palette exceeds prototype CPU position bound');
    validation.push({team:asset.team,pose:frame.label,vertices:asset.vertices,maxError,maxFloat32PaletteError,
      maxPoseTRSRecomposeError:frame.maxPoseTRSRecomposeError});
  }
  const packet={schema:'gh-native-live-skin-v1',binary:{uri:'operators.skin.bin',bytes:binary.length,sha256:sha256(binary),endianness:'little'},
    source:{coreSHA256:loaded.sourceSHA256,threeRevision:r.THREE.REVISION,bundleVersion:boot.stats.version,
      operatorsSHA256:sha256(readFileSync(new URL('game/assets/operators.bin',REPO))),
      decoderSHA256:sha256(readFileSync(new URL('game/client/startup-geometry.js',REPO))),
      loaderSHA256:sha256(readFileSync(new URL('../godot-node-logic/load-runtime.mjs',import.meta.url))),
      assetBootSHA256:sha256(readFileSync(new URL('../godot-node-logic/asset-boot.mjs',import.meta.url))),
      fixtureSeed:5281,poseClock:'Original rig.update fixed1/60; no full-game/AI or native animation-timing parity claimed'},
    convention:{coordinates:'Right-handed Y-up/-Z-forward unchanged; column-major matrices; no axis mirror',
      sourceWinding:'counterclockwise',godotWinding:'clockwise by swapping each triangle second/third index exactly once',
      geometry:'Original geometry.attributes.position/normal, not getVertexPosition baked geometry',
      skeletonWorld:'rig.root.matrixWorld',bonePose:'inverse(rig.root.matrixWorld) * original bone.matrixWorld; absolute local pose relative parent, not rest delta',
      affineRequirement:'Keep full bone matrices. Native walking poses contain shear; Skeleton3D TRS setters/glTF TRS animation are not an exact consumer. Use full RenderingServer palette or another proven affine path.',
      skinBind:'original boneInverse; v1 guards attached bindMode, bindMatrix identity and meshWorld*bindMatrixInverse identity',
      equation:'worldPosition = rootWorld * sum(weight * globalBonePose * inverseBind * originalRestPosition)'},
    assets,validation,
    parity:{nativeCPUPositionGolden:true,godotLoaded:false,godotGPUValidated:false,highShader:false,fullAI:false,
      gaps:['Godot import/engine vertex deformation and skin normals require root validation.',
        'aux/aux2 and every original attribute are preserved byte-exact but their High shader logic is unported.',
        'Textures/custom material shader, fade variants, VM/FPbody/reflection/shadow/High effects remain unported.',
        'Body-only two original team rigs; no invented bone hierarchy or substitute pose animation.',
        'Position golden is native CPU skinning, not full GPU shader displacement/normal parity.']}};
  return {packet,binary,platformCalls:loaded.platformCalls};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const directory=resolve(process.argv[2]||fileURLToPath(new URL('./evidence',import.meta.url)));
  const jsonPath=join(directory,'operators.skin.json'),binPath=join(directory,'operators.skin.bin');
  assert.ok(!existsSync(jsonPath)&&!existsSync(binPath),'Choose a new output directory; preserve prior evidence');
  const {packet,binary,platformCalls}=buildSkinFixture();assert.deepEqual(platformCalls,[]);
  mkdirSync(directory,{recursive:true});writeFileSync(binPath,binary,{flag:'wx'});
  writeFileSync(jsonPath,JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({jsonPath,binPath,bytes:binary.length,teams:packet.assets.length,poses:packet.validation.length,
    maxNativeCPUError:Math.max(...packet.validation.map(v=>v.maxError)),
    maxFloat32PaletteError:Math.max(...packet.validation.map(v=>v.maxFloat32PaletteError)),godotRun:false,highParity:false}));
}
