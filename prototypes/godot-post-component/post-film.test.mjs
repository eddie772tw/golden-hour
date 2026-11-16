import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const root=process.env.GH_GODOT_SOURCE_ROOT ? new URL('file:///'+process.env.GH_GODOT_SOURCE_ROOT.replaceAll('\\','/').replace(/\/?$/,'/')) : new URL('../../',import.meta.url);
const {loadBundle}=await import(new URL('server/fixtures/bundle-probe.mjs',root));
import {build,reference} from './post-reference.mjs';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const proof=JSON.parse(read('./render/fixtures/source-post-proof.json')),cases=JSON.parse(read('./render/fixtures/post-cases.json'));
const full=JSON.parse(read('./fixtures/source-post-meter-evidence.json'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const {THREE:T}=loadBundle(new URL('game/core/game.js',root));

test('all selected operators are literal substrings of the reviewed original shader, with actual123 proof retained',()=>{
  assert.equal(hash(read('./fixtures/source-post-meter-evidence.json')),proof.sourceCaptureSHA256);
  assert.equal(hash(full.finalSource.fragment),proof.sourceFinalFragmentSHA256);
  for(const text of Object.values(proof.selection))assert.ok(full.finalSource.fragment.includes(text));
  assert.equal(proof.currentCompiledFinal.id,123);assert.equal(proof.currentCompiledFinal.fragmentSHA256,'010b92601d5dffe17c397cab6d2dce30b51667fcf376b1775ef4d560d0a6209b');
  assert.equal(hash(read('./render/post_film.gdshaderinc')),proof.nativeIncludeSHA256);
  assert.equal(full.compiled.find(p=>p.current).fragment.match(/aces\(/g).length,1);
});

test('independent CPU cases reproduce pinned finite bounded output, actual-E and hue witnesses without time/history',()=>{
  assert.equal(JSON.stringify(build(proof),null,2)+'\n',read('./render/fixtures/post-cases.json'));
  assert.deepEqual(reference(proof,cases.cases[0]),[0,0,0]);
  for(const row of cases.cases)assert.ok(row.expectedLinear.every(x=>Number.isFinite(x)&&x>=0&&x<=1));
  for(const pair of cases.witnessPairs){const a=cases.cases.find(r=>r.name===pair[0]),b=cases.cases.find(r=>r.name===pair[1]);assert.ok(Math.max(...a.expectedLinear.map((x,i)=>Math.abs(x-b.expectedLinear[i])))>.01);}
  assert.throws(()=>reference(proof,{input:[NaN,1,1]}),/Finite/);
  assert.ok(!read('./render/post_film.gdshaderinc').includes('TIME'));
});

function fixture(throwRead=false){
  const originalMaterial=new T.ShaderMaterial({vertexShader:full.finalSource.vertex,fragmentShader:full.finalSource.fragment});
  let currentMaterial,bytes=new Uint8Array(4),target=null,reads=0,resets=0;
  const color=new T.Color(.1,.2,.3),viewport=new T.Vector4(2,3,640,480),scissor=new T.Vector4(4,5,320,240);
  const initialViewport=viewport.clone(),initialScissor=scissor.clone();
  const gl={getError:()=>0,isShader:h=>typeof h?.source==='string',getShaderSource:h=>h.source};
  const r={xr:{isPresenting:false},autoClear:false,toneMapping:0,clippingPlanes:['saved'],shadowMap:{enabled:true,autoUpdate:false,needsUpdate:true},
    getContext:()=>gl,getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
    getViewport:v=>v.copy(viewport),setViewport:(...args)=>args[0]?.isVector4?viewport.copy(args[0]):viewport.set(...args),
    getScissor:v=>v.copy(scissor),setScissor:v=>scissor.copy(v),getScissorTest:()=>true,setScissorTest(){},
    getClearColor:c=>c.copy(color),getClearAlpha:()=>.5,setClearColor(){},clear(){},resetState:()=>{resets++;},
    readRenderTargetPixels(t,x,y,w,h,out){if(throwRead)throw Error('Injected read failure');reads++;out.set(bytes);},
    properties:{get:m=>({currentProgram:{vertexShader:{source:m.vertexShader},fragmentShader:{source:m.fragmentShader}}})}};
  const quad={material:originalMaterial,dispose(){throw Error('Must not dispose shared geometry');},render(){
    currentMaterial=this.material;const u=currentMaterial.uniforms;
    const row={input:u.hdr_input.value.toArray(),auto:u.uAuto.value,hueKeep:u.uHueKeep.value};
    const linear=u.reference_mode.value?u.reference_linear.value.toArray():reference(proof,row);
    bytes=Uint8Array.from([...linear.map(x=>Math.round(255*(x<=.0031308?x*12.92:1.055*x**(1/2.4)-.055))),255]);
  }};
  const colorOwner=new T.MeshStandardMaterial();
  const g={renderer:r,final:{material:originalMaterial,_fsQuad:quad},composer:{readBuffer:new T.WebGLRenderTarget(1,1)},uniforms:{uBalance:{value:new T.Vector3(1,1,1)}},scene:{traverse:fn=>fn({material:colorOwner})}};
  const sourceMath=T.MathUtils.generateUUID.constructor('return Math')(),prior=sourceMath.random;let originalCalls=0;
  sourceMath.random=()=>{originalCalls++;return .5;};
  const sandbox=vm.createContext({GH:{ready:true,G:{state:'paused'},benchmark:{tick:240},debug:{gfx:g}},Math:sourceMath,Uint8Array,TextEncoder,console});
  vm.runInContext(read('./browser-film-oracle.js'),sandbox);
  return {run:()=>sandbox.__ghThreePostFilm.run({proof,cases,coreSHA256:proof.sourceCoreSHA256}),check(){
    assert.equal(quad.material,originalMaterial);assert.equal(target,null);assert.equal(resets,1);assert.deepEqual(viewport,initialViewport);assert.deepEqual(scissor,initialScissor);
    assert.equal(r.autoClear,false);assert.equal(r.shadowMap.enabled,true);assert.equal(r.shadowMap.needsUpdate,true);assert.equal(originalCalls,0);
  },cleanup:()=>{sourceMath.random=prior;},reads:()=>reads};
}

test('bounded browser control flow restores original shared quad, native state and source RNG; mocked read is not GPU proof',()=>{
  const f=fixture();try{const report=f.run();assert.equal(report.ok,true,report.error);assert.equal(report.cases.length,12);assert.equal(f.reads(),36);f.check();}finally{f.cleanup();}
});

test('browser read failure still restores shared geometry ownership, native state and source RNG',()=>{
  const f=fixture(true);try{const report=f.run();assert.equal(report.ok,false);assert.match(report.error,/Injected read failure/);f.check();}finally{f.cleanup();}
});
