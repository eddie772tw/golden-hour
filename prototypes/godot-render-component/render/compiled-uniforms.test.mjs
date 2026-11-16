import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
const source=fs.readFileSync(new URL('./browser-compiled-uniforms.js',import.meta.url),'utf8');
const matrix={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
const vector=(...v)=>({isVector4:true,toArray:()=>v});
function fixture(){
  const words=new Uint16Array([0x3c00,0x7bff,0x8000,0x7e01,0x3c01,0x0001,0x0000,0x3c00,1,2,3,4,5,6,7,8]);
  const texture=(uuid,im)=>({isTexture:true,uuid,name:'',type:1009,format:1023,colorSpace:'',image:im,
    wrapS:1001,wrapT:1001,minFilter:1006,magFilter:1006,flipY:false,generateMipmaps:false,unpackAlignment:1});
  const lv=texture('real-HM',{width:2,height:2,depth:1,data:words});lv.type=1016;lv.isData3DTexture=true;
  const original=Buffer.from(words.buffer).toString('hex');
  const rgba=new Uint8ClampedArray([91,133,7,255,5,6,7,8]);
  const orm=texture('ORM',{width:2,height:1,getContext:()=>({getContextAttributes:()=>({colorSpace:'srgb'}),getImageData:()=>({data:rgba})})});
  let shaderReads=0;
  const m={uuid:'m',id:12,type:'MeshStandardMaterial',name:'Nj',side:0,roughness:.6,
    _ghUser:function originalHook(){throw Error('Must not call/compile');},roughnessMap:orm,
    ghUniforms:{ghT:{value:vector(2,3,4,5)},ghMacro:{value:orm}}};
  const program={id:4,cacheKey:'original',vertexShader:{text:'original vertex'},fragmentShader:{text:'original ghLightVolume fragment'}};
  const properties={programs:new Map([['key',program]]),currentProgram:program,uniforms:{ghLV:{value:lv},ghLVK:{value:vector(1,.5,1,1)},unwanted:{value:()=>{throw Error('No recursive serialization');}}}};
  const object={isObject3D:true,uuid:'o',id:25,name:'actual',type:'Mesh',children:[],material:m,matrixWorld:matrix,visible:true,layers:{mask:1},renderOrder:0,
    geometry:{uuid:'g',type:'BufferGeometry',attributes:{position:{count:3,itemSize:3}},groups:[],drawRange:{start:0,count:Infinity}}};
  const scene={isObject3D:true,name:'',children:[object],traverse(fn){fn(this);fn(object);}};
  const GH={ready:true,G:{state:'paused'},benchmark:{tick:240},debug:{gfx:{scene,quality:'high',camera:{matrixWorld:matrix},renderer:{properties:{get:()=>properties},getContext:()=>({isShader:h=>!!h,getShaderSource(h){shaderReads++;return h.text;}})}},fx:{lightVolume:{texture:lv,half:words,nx:2,ny:1,nz:1,s:1,x0:-1,y0:0,z0:2}}}};
  const context=vm.createContext({GH,performance:{now:()=>10,timeOrigin:1000},Uint8Array,Uint16Array,TextEncoder,ArrayBuffer,Map,Set,crypto:webcrypto,
    URL,location:{href:'http://localhost/',origin:'http://localhost'},btoa:s=>Buffer.from(s,'binary').toString('base64')});
  vm.runInContext(source,context);
  return {api:context.__ghCompiledMaterials,GH,words,original,rgba,get shaderReads(){return shaderReads;}};
}
const options={coreSHA256:'a'.repeat(64),sessionId:'CPU-only'};
test('actual compiled uniforms, nonenumerable-style gh values, owner slots and shader strings are collected without recompilation',async()=>{
  const f=fixture(),m=await f.api.capture(options);
  assert.equal(m.counts.compiledLVMaterials,1);assert.equal(m.counts.compiledLVIdentityMismatches,0);
  assert.equal(m.lightVolume.texture.texture,'real-HM');
  assert.deepEqual(Array.from(m.materials.m.ghUniforms.ghT.vector),[2,3,4,5]);
  assert.equal(m.materials.m.compiledUniforms.unwanted,undefined);
  assert.equal(m.materials.m.owners[0].slot,0);assert.equal(m.objects[0].path,'world/0:actual');
  assert.equal(m.materials.m.compiledVariants[0].id,4);assert.equal(f.shaderReads,2);
  assert.ok(Object.values(m.codes).some(c=>c.text==='original ghLightVolume fragment'));
  assert.equal(m.textures.ORM.status,'captured');assert.ok(m.textures.ORM.roles.some(r=>r.endsWith('/standard/roughnessMap')));
});
test('half-float raw bits and all ORM RGBA bytes freeze before first await and roundtrip bounded reads with SHA256',async()=>{
  const f=fixture(),promise=f.api.capture(options);f.words.fill(0);f.rgba.fill(0);
  const m=await promise,lv=m.assets[m.textures['real-HM'].asset];
  assert.equal(lv.arrayType,'Uint16Array');assert.equal(lv.byteOrder,'little-endian');
  let offset=0;const pieces=[];
  while(true){const p=f.api.readAsset(lv.id,offset,3);pieces.push(Buffer.from(p.base64,'base64'));offset=p.nextOffset;if(p.done)break;}
  const bytes=Buffer.concat(pieces);assert.equal(bytes.toString('hex'),f.original);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),lv.sha256);
  const orm=m.assets[m.textures.ORM.asset];assert.equal(f.api.readAsset(orm.id,0,99).base64,Buffer.from([91,133,7,255,5,6,7,8]).toString('base64'));
  f.api.release();assert.throws(()=>f.api.readAsset(lv.id),/Capture first/);
});
test('wrong tick/core fail closed and compiled LV identity mismatch is explicit evidence',async()=>{
  const f=fixture();f.GH.benchmark.tick=239;
  await assert.rejects(f.api.capture(options),/tick240/);f.GH.benchmark.tick=240;
  await assert.rejects(f.api.capture({}),/SHA256/);
  f.GH.debug.fx.lightVolume.texture={...f.GH.debug.fx.lightVolume.texture,uuid:'other-HM'};
  // A second texture with equal dimensions/bytes is not the original binding.
  const m=await f.api.capture(options);assert.equal(m.lightVolume.texture.texture,'other-HM');
  assert.equal(m.textures['other-HM'].roles.includes('FX.lightVolume.texture'),true);
  assert.equal(m.counts.compiledLVIdentityMismatches,1);
  assert.ok(m.gaps.some(g=>g.reason.includes('differs from FX.lightVolume')));
});
