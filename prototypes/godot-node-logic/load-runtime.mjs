// Gate A loader: evaluate the actual owning bundle, suppress only its As0 entry.
// Unknown platform calls throw. No fake actor/physics/GPU/audio implementations.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {PixelCanvas} from './pixel-canvas.mjs';

export const REPO=process.env.GH_NODE_CLIENT_ROOT
  ? pathToFileURL(resolve(process.env.GH_NODE_CLIENT_ROOT)+'/')
  : new URL('../../',import.meta.url);
const PIN='b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b';
export function loadRuntime({boot={},platformCalls=[],pixelCanvas=false,captureDrawCommands=false,nativeCanvas=null}={}) {
  const url=new URL('game/core/game.js',REPO),source=readFileSync(url,'utf8');
  const sha=createHash('sha256').update(source).digest('hex');
  assert.equal(sha,PIN,'Reference core changed; update the proof deliberately');
  const cutoff=source.lastIndexOf('\n  As0().catch(');
  assert.ok(cutoff>0,'Explicit existing bundle-probe boot boundary');
  function forbidden(name) {
    return (...args)=>{const error=new Error('Unsupported headless platform boundary: '+name);
      platformCalls.push({name,args:args.map(value=>typeof value==='string'?value:typeof value),stack:error.stack});
      throw error;};
  }
  const location={search:'?solo',href:'http://localhost/?solo'};
  const makeNative=nativeCanvas?.canvasFactory(name=>forbidden(name)());
  const document={addEventListener(){},createElement:nativeCanvas?(type)=>type==='canvas'?makeNative():forbidden('document.createElement')(type):pixelCanvas?(type)=>type==='canvas'?new PixelCanvas(name=>forbidden(name)(),{captureDrawCommands}):forbidden('document.createElement')(type):forbidden('document.createElement'),
    createElementNS:forbidden('document.createElementNS'),getElementById:forbidden('document.getElementById')};
  const context={console,performance,URLSearchParams,URL,AbortController,DOMException,TextEncoder,TextDecoder,
    location,navigator:{userAgent:'node-authoritative-proof',platform:'Win32'},document,
    innerWidth:1920,innerHeight:1080,devicePixelRatio:1,
    Math,ArrayBuffer,Float32Array,Float64Array,Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Int32Array,DataView,
    addEventListener(){},localStorage:{getItem(){return null;},setItem(){}},
    setTimeout:forbidden('setTimeout'),clearTimeout(){},requestAnimationFrame:forbidden('requestAnimationFrame'),
    AudioContext:forbidden('AudioContext'),webkitAudioContext:forbidden('webkitAudioContext'),GHBoot:boot,
    GH_NOWARM:true}; // Existing owning flag: warm actual weapon clips synchronously before fixture.
  if(nativeCanvas)Object.assign(context,nativeCanvas.globals);
  context.window=context;context.self=context;
  const setupStart=source.indexOf('    let T = () => Je.time, S = new Ow');
  const setupEnd=source.indexOf('b.createBots(5);',setupStart)+'b.createBots(5);'.length;
  assert.ok(setupStart>0 && setupEnd>setupStart);
  const setup=source.slice(setupStart,setupEnd).replaceAll('await q1()','await Promise.resolve()');
  const simulation=source.slice(source.indexOf('    function ghSimulate('),source.indexOf('    function M0(ghNow)'));
  const expose=`globalThis.__logic={THREE:Ct,Input:Cw,World:Mw,Physics:_w,Bot:i7,Match:A7,K9:R7,
    Player:Ow,Combat:Uw,Arsenal:Xw,VM:Qw,FirstPerson:X7,Glass:Ew,FX:$M,
    makeMaterials:lD,makeProps:PD,makeHotel:FD,dressHotel:ND,detailHotel:qD,makeNav:XD,
    makeSky:PL,makeLoose:KD,finishLights:ZD,qualityPresets:c9,finalShader:_Y,
    makeCharacter:n7,makeGun:Ky,makeGrenade:Nk,audio:fo,makeAudio:eZ,
    state:Je,settings:_s,weapons:Ya,surfaceMap:A9,sun:Ii,
    async setupGameplay({scene:i,camera:a,gfx:n,world:f,glass:d,physics:p,fx:u,hotel:g,nav:w,input:l,hud:t,refs}) {
      let m,b; ${setup}
      Object.assign(refs,{combat:m,player:S,match:b});
      return {player:S,vm:E,fpbody:C,ctx:L,combat:m,arsenal:A,match:b};
    },
    makeSimulation({scene:i,camera:a,gfx:n,world:f,glass:d,physics:p,fx:u,hotel:g,sky:x,input:l,hud:t,
      player:S,vm:E,fpbody:C,combat:m,arsenal:A,match:b}) {
      const r={domElement:{height:1080}},t0={head:S.hit[0].a,a:S.hit[1].a,b:S.hit[1].b};
      let K=0,n0=1;
      function I(){throw Error('Menu-camera simulation outside Gate A');}
      function ghPresent(dt){fo.update(dt);t.update(dt,{player:S,ars:A,match:b,camera:a,world:f,physics:p});}
      ${simulation}
      return ghSimulate;
    }};`;
  vm.runInNewContext(source.slice(0,cutoff)+'\n'+expose+'\n})();',context,{filename:'owning-game.js',timeout:10000});
  return {runtime:context.__logic,context,sourceSHA256:sha,platformCalls};
}
