// Actual bundled BM/p9/Cd CPU paths plus a controlled GL read mock; never WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const root=process.env.GH_GODOT_SOURCE_ROOT ? new URL('file:///'+process.env.GH_GODOT_SOURCE_ROOT.replaceAll('\\','/').replace(/\/?$/,'/')) : new URL('../../',import.meta.url);
const source=fs.readFileSync(new URL('game/core/game.js',root),'utf8');
const collector=fs.readFileSync(new URL('./browser-post-meter.js',import.meta.url),'utf8');
const core=createHash('sha256').update(source).digest('hex');
const cutoff=source.lastIndexOf('\n  As0().catch(');assert.ok(cutoff>0);
const context={console,performance,URLSearchParams,AbortController,DOMException,URL,TextEncoder,TextDecoder,
  location:{search:''},navigator:{userAgent:'offline-post-test'},addEventListener(){},
  localStorage:{getItem(){return null;},setItem(){}},
  document:{addEventListener(){},createElement(){throw Error('Unexpected DOM/GPU allocation');}},
  setTimeout(){},clearTimeout(){}};
context.window=context;context.self=context;
vm.runInNewContext(source.slice(0,cutoff)+'\n globalThis.__post={T:Ct,BM,p9,Cd,Y:_Y};\n})();',context,{timeout:10000});
const {T,BM,p9,Cd,Y}=context.__post;

function fixture(){
  const g=Object.create(BM.prototype),queue=[];let readCalls=0;
  Object.assign(g,{quality:'high',time:8.54,preparation:{pending:false,error:null},camera:new T.PerspectiveCamera()});
  // Take the actual owning constructor literal, without constructing WebGLRenderer.
  const literal=BM.toString().match(/this\.exposure = (\{[^}]+\})/)[1];
  g.exposure=vm.runInNewContext('('+literal+')');
  g.final=new Cd(Y);g.uniforms=g.final.uniforms;g.uniforms.uRes.value.set(1920,1080);
  g.meter=new p9(g);g.meter.setSize(1920,1080);
  const framebuffer={},program={id:101,vertexShader:{slot:'vertex'},fragmentShader:{slot:'fragment'}};
  const gl={NO_ERROR:0,DRAW_FRAMEBUFFER_BINDING:0x8ca6,READ_FRAMEBUFFER_BINDING:0x8caa,
    getError:()=>queue.shift()??0,getParameter:()=>null,isFramebuffer:x=>x===framebuffer,
    isShader:h=>h===program.vertexShader||h===program.fragmentShader,
    getShaderSource:h=>'// existing compiled prefix\n'+(h.slot==='vertex'?Y.vertexShader:Y.fragmentShader)};
  const nativePrograms={programs:new Map([['existing',program]]),currentProgram:program};
  let target=null,readsEnabled=true;
  const r={toneMapping:0,outputColorSpace:'srgb',domElement:{width:1920,height:1080},info:{render:{calls:42}},
    getContext:()=>gl,getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},
    properties:{get:o=>o===g.final.material?nativePrograms:{__webglFramebuffer:framebuffer}},
    readRenderTargetPixels(o,x,y,w,h,buffer){
      readCalls++;assert.equal(o,g.meter.e0);assert.deepEqual([x,y,w,h],[0,0,1,1]);
      assert.equal(buffer.constructor.name,'Uint16Array');assert.equal(buffer.length,4);
      if(readsEnabled)buffer.set([0x3800,0x3400,0,0x3c00]);
    }};
  g.renderer=r;
  // Exercise the actual meter render ownership/order and official override values
  // using its native CPU method; the quad is a counted mock, never a GPU draw.
  let setupDraws=0;g.meter.quad.render=()=>{setupDraws++;};
  g.meter.render(r,null,{texture:new T.Texture()},1/60);r.setRenderTarget(null);
  assert.equal(setupDraws,3);
  const GH={ready:true,G:{state:'paused',time:4},benchmark:{tick:240},debug:{gfx:g}};
  const sandbox=vm.createContext({GH,Map,TextEncoder,console});vm.runInContext(collector,sandbox);
  return {g,r,gl,queue,nativePrograms,run:()=>sandbox.__ghPostMeter.capture({coreSHA256:core,sessionId:'actual-source-cpu'}),
    reads:()=>readCalls,disableRead:()=>{readsEnabled=false;}};
}

test('actual BM.readMeter and p9/Cd preserve source bindings, read one original pixel and decode exact words',()=>{
  const f=fixture(),report=f.run();assert.equal(report.ok,true,JSON.stringify(report.errors));
  assert.equal(f.reads(),1);assert.equal(report.operations.nativeMeterReads,1);
  assert.equal(report.read.nativeDecoded.exposure,.5);assert.equal(report.read.nativeDecoded.avg,.25);
  assert.equal(report.read.effectiveExposure,.5);assert.deepEqual(Array.from(report.read.words),[0x3800,0x3400,0,0x3c00]);
  assert.equal(report.meter.lastAdaptUniforms.uKey,.15);assert.equal(report.meter.lastAdaptUniforms.uComp,.46);
  assert.equal(report.meter.lastAdaptUniforms.uMaxE,1.6);assert.equal(report.meter.lastAdaptUniforms.uReset,1);
  assert.equal(report.compiledCurrentProgram,101);assert.equal(report.compiled.length,1);
  assert.equal(createHash('sha256').update(report.finalSource.fragment).digest('hex'),'d57a2ec1063369281be2d7a85ccfc95c86a9a40ca239159442fd3c437fdd3b1a');
  assert.ok(Object.values(report.nativeStateAfter).every(Boolean));
  assert.equal(f.r.info.render.calls,42);
});

test('wrong e0 binding and pre-existing GL errors fail before any read and remain evidence',()=>{
  let f=fixture();f.g.uniforms.tAdapt.value=new T.Texture();let report=f.run();
  assert.equal(report.ok,false);assert.equal(f.reads(),0);assert.match(report.errors[0],/identity/);
  f=fixture();f.queue.push(1282);report=f.run();
  assert.equal(report.ok,false);assert.equal(f.reads(),0);assert.deepEqual(Array.from(report.glErrorsBefore),[1282]);
});

test('failed read witness, read-time GL error and draw mutation are never disguised as success',()=>{
  let f=fixture();f.disableRead();let report=f.run();assert.equal(report.ok,false);assert.match(report.errors[0],/witness/);
  f=fixture();const read=f.r.readRenderTargetPixels;f.r.readRenderTargetPixels=(...args)=>{read(...args);f.queue.push(1282);};report=f.run();
  assert.equal(report.ok,false);assert.deepEqual(Array.from(report.glErrorsAfter),[1282]);
  f=fixture();const original=f.r.readRenderTargetPixels;f.r.readRenderTargetPixels=(...args)=>{original(...args);f.r.info.render.calls++;};report=f.run();
  assert.equal(report.ok,false);assert.equal(report.nativeStateAfter.callsUnchanged,false);
  f=fixture();f.r.readRenderTargetPixels=(o,x,y,w,h,buffer)=>buffer.set([0x7e00,0x3400,0,0x3c00]);report=f.run();
  assert.equal(report.ok,false);assert.equal(report.read.nativeDecoded.exposure.nonfinite,'NaN');
  assert.equal(report.read.effectiveExposure.nonfinite,'NaN');
});

test('absent existing program records a gap without compilation; oversized shader fails bounded before reading',()=>{
  let f=fixture();f.nativePrograms.programs=undefined;let report=f.run();
  assert.equal(report.ok,true);assert.equal(f.reads(),1);assert.equal(report.compiled.length,0);assert.match(report.gaps[0],/No existing/);
  f=fixture();f.g.final.material.fragmentShader='x'.repeat(65537);report=f.run();
  assert.equal(report.ok,false);assert.equal(f.reads(),0);assert.match(report.errors[0],/cap/);
  assert.ok(Buffer.byteLength(JSON.stringify(report))<262144);
});
