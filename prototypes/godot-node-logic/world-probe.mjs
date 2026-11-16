// Full original scene/physics authoring before gameplay. No WebGL substitute.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadRuntime} from './load-runtime.mjs';
import {createAssetBoot} from './asset-boot.mjs';
import * as nativeCanvas from './native-canvas.mjs';

export function buildWorld(report={stages:[],platformCalls:[]}) {
const {runtime:r,context:hostContext,sourceSHA256}=loadRuntime({boot:createAssetBoot(),platformCalls:report.platformCalls,nativeCanvas});
function stage(name,fn){console.log('START',name);const at=performance.now();
  try {const result=fn();report.stages.push({name,ok:true,elapsedMs:performance.now()-at});console.log('DONE',name);return result;}
  catch(error){report.stages.push({name,ok:false,elapsedMs:performance.now()-at,error:String(error)});throw error;}}
const refs={};
{
  const T=r.THREE,scene=new T.Scene(),camera=new T.PerspectiveCamera(90,1920/1080,.06,2500);
  camera.rotation.order='YXZ';camera.layers.enable(1);
  const gfx={scene,camera,vmScene:new T.Scene(),vmCamera:new T.PerspectiveCamera(55,1920/1080,.01,10),
    uniforms:T.UniformsUtils.clone(r.finalShader.uniforms),q:{...r.qualityPresets.high,scale:1},
    quality:'high',size:new T.Vector2(1920,1080),time:0,sunUv:new T.Vector2(),
    async prepare(reason,change){change?.();},async whenReady(){},setFx(fx){this.fx=fx;},
    vmPass:{enabled:true},warmRoots:[]};
  const materials=stage('original-lD-materials',()=>r.makeMaterials({anisotropy:8}));
  materials.lampShade.emissiveIntensity=Math.min(materials.lampShade.emissiveIntensity,1.05);
  materials.onyx.emissiveIntensity*=.8;
  const props=stage('original-PD-prop-factories',()=>r.makeProps(materials));
  const world=new r.World(),fx=stage('original-FX-constructor',()=>new r.FX(scene));
  const glass=stage('original-glass-constructor',()=>new r.Glass(scene,world,{audio:r.audio,fx}));
  const physics=new r.Physics(scene,world,{audio:r.audio,fx,glass,onExplode:(...args)=>refs.combat.explode(...args)});
  fx.physics=physics;
  const sky=stage('original-sky',()=>r.makeSky(scene));
  const hotel=stage('original-FD-hotel',()=>r.makeHotel({scene,world,glass,fx,M:materials,SURF_OF:r.surfaceMap}));
  const onChandelier=(point,attacker)=>{
    const {player,match}=refs;
    const owner=attacker&&attacker.team!==undefined?attacker:player;
    for(const actor of match.actors)if(actor.alive&&Math.hypot(actor.pos.x-point.x,actor.pos.z-point.z)<=2.7&&Math.abs(actor.pos.y-point.y)<=2.5)
      match.damage(actor,160,actor.team===owner.team?actor:owner,{weapon:'chandelier',dir:new T.Vector3(0,-1,0),point,blast:true});
    if(player.eye.distanceTo(point)<18)player.addShake(.6);
  };
  const context={scene,world,glass,physics,fx,M:materials,P:props,audio:r.audio,onChandelier};
  context.K=stage('original-KD-loose-props',()=>r.makeLoose(world,materials));
  stage('original-ND-dressing',()=>r.dressHotel(context,hotel));
  stage('original-qD-details',()=>r.detailHotel(context,hotel));
  stage('original-finishDress/finalize/glass',()=>{hotel.finishDress();world.finalize(scene);glass.build();});
  stage('original-shafts/glows/finishing',()=>{
    fx.buildShafts(hotel.shafts,r.sun.clone().negate());fx.buildGlows();r.finishLights({scene,world,fx,gfx},hotel);
  });
  const nav=stage('original-XD-nav',()=>r.makeNav(world));
  let objects=0,meshes=0;scene.traverse(object=>{objects++;if(object.isMesh)meshes++;});
  report.world={colliders:world.cols.length,bakedMeshes:world.meshes.length,physicsProps:physics.props.length,
    panes:glass.panes.length,navNodes:nav.nodes.length,navIslands:nav.islands,objects,meshes};
  report.worldBootstrapPassed=true;
  return {runtime:r,hostContext,sourceSHA256,scene,camera,gfx,world,fx,glass,physics,hotel,nav,sky,materials,refs};
}
}

/* CLI retains the staged, intentionally incomplete world-only evidence. */
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
const report={kind:'actual-original-hotel-bootstrap-no-GPU',fullFixturePassed:false,
  logicalTicksExecuted:0,allEightExportsCompared:false,platformCalls:[],stages:[],nativeCanvas:nativeCanvas.metadata};
/* Legacy CLI body below delegates to the reusable builder. */
try { buildWorld(report); } catch(error){report.worldBootstrapPassed=false;report.error=String(error);report.stack=error.stack;}
const name=process.argv.find(value=>value.startsWith('--name='))?.slice(7)??'world-probe';
if(!/^[\w-]+$/.test(name))throw Error('Simple evidence name required');
mkdirSync(new URL('./evidence/',import.meta.url),{recursive:true});
writeFileSync(new URL('./evidence/'+name+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));process.exitCode=2;
}
