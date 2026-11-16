// CPU byte/metadata fixtures only, never rendering or High-parity acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
const source=fs.readFileSync(new URL('./browser-textures.js',import.meta.url),'utf8');
const vector=(...v)=>({toArray:()=>v});
function texture(id,data){return{uuid:id,type:1009,format:1023,colorSpace:'srgb',channel:0,flipY:true,premultiplyAlpha:false,
  wrapS:1000,wrapT:1000,minFilter:1008,magFilter:1006,anisotropy:1,generateMipmaps:true,mipmaps:[],matrixAutoUpdate:false,
  matrix:{elements:[2,0,0,0,3,0,.25,.5,1]},offset:vector(.25,.5),repeat:vector(2,3),center:vector(0,0),rotation:0,image:{width:2,height:2,data}};}
function fixture(){
  const pixels=new Uint8Array([255,0,0,255,0,255,0,128,0,0,255,255,9,19,29,0]);
  const albedo=texture('albedo',pixels),normal=texture('normal',pixels);normal.colorSpace='';normal.flipY=false;
  const material={uuid:'m1',type:'MeshStandardMaterial',map:albedo,normalMap:normal,roughnessMap:normal,normalScale:vector(1,1),normalMapType:0,aoMapIntensity:1};
  const snapshot={source:{coreSHA256:'fixture',capturedAt:123456,tick:240},materials:{m1:{}}};
  const context=vm.createContext({Uint8Array,Uint8ClampedArray,URL,crypto:webcrypto,location:{href:'http://127.0.0.1:1/',origin:'http://127.0.0.1:1'},
    btoa:s=>Buffer.from(s,'binary').toString('base64'),GH:{ready:true,G:{state:'paused'},debug:{gfx:{scene:{traverse(fn){fn({material});}}}}},__ghGodotSnapshot:snapshot});
  vm.runInContext(source,context);return{api:context.__ghGodotTextures,context,material,albedo,normal,pixels};
}
test('exact asymmetric RGBA payload, hash and bounded asset reader preserve all bytes',async()=>{
  const f=fixture(),m=await f.api.capture({sessionId:'same-session'});
  assert.equal(m.counts.captured,2);assert.equal(m.source.geometryCapturedAt,123456);assert.equal(m.materials.m1.maps.roughnessMap.channel,'g');
  assert.equal(m.textures.albedo.flipY,true);assert.deepEqual(Array.from(m.textures.albedo.matrix),[2,0,0,0,3,0,.25,.5,1]);
  const chunks=[];let offset=0;while(true){const part=f.api.readAsset('albedo',offset,3);chunks.push(Buffer.from(part.base64,'base64'));offset=part.nextOffset;if(part.done)break;}
  const data=Buffer.concat(chunks);assert.deepEqual([...data],[...f.pixels]);assert.equal(m.textures.albedo.sha256,createHash('sha256').update(data).digest('hex'));
  assert.equal(m.materials.m1.maps.normalMap.color,'linear');assert.equal(m.textures.normal.flipY,false);
});
test('RT and float textures remain explicit unsupported and are never read back',async()=>{
  const f=fixture();f.albedo.isRenderTargetTexture=true;f.normal.type=1016;
  const m=await f.api.capture();assert.equal(m.counts.captured,0);assert.equal(m.counts.unsupported,2);assert.equal(m.unsupported.length,2);
  assert.match(m.textures.albedo.reason,/GPU-only/);assert.match(m.textures.normal.reason,/float/);
  assert.throws(()=>f.api.readAsset('albedo'),/Unknown captured asset/);
});
test('existing CPU canvas keeps canonical RGBA, release and session mismatch fail closed',async()=>{
  const f=fixture();f.albedo.image={width:2,height:2,getContext(){return{getContextAttributes:()=>({colorSpace:'srgb'}),getImageData:()=>({data:new Uint8ClampedArray(f.pixels)})};}};
  const m=await f.api.capture();assert.equal(m.textures.albedo.readPath,'existing-canvas2d');assert.match(m.textures.albedo.lossless,/canonical/);
  f.context.__ghGodotSnapshot.materials.ghost={};await assert.rejects(f.api.capture(),/do not match live session/);assert.throws(()=>f.api.manifest(),/Capture first/);
  f.api.release();assert.throws(()=>f.api.readAsset('normal'),/Unknown captured asset/);
});
