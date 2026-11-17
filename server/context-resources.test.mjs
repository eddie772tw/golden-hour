import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadBundle } from "./fixtures/bundle-probe.mjs";

const path=new URL("../game/core/game.js",import.meta.url);
const source=readFileSync(path,"utf8"), {THREE}=loadBundle(path);
function owner(name) {
  const start=source.indexOf(`  function ${name}(`), end=source.indexOf("\n  }",start)+4;
  assert.ok(start>=0&&end>start,name);
  return source.slice(start,end);
}
const helpers=source.slice(source.indexOf("  var ghGLResourceGenerations"),source.indexOf("  function KG("));
const sandbox={console,Float32Array,Float64Array,Uint32Array,Uint16Array,Int32Array,Int16Array,
  Uint8Array,Uint8ClampedArray,Int8Array,It:THREE.Vector2,_x:THREE.IntType};
for(const [name,key] of Object.entries({Bs:"RepeatWrapping",Ki:"ClampToEdgeWrapping",P3:"MirroredRepeatWrapping",
  no:"NearestFilter",gM:"NearestMipmapNearestFilter",km:"NearestMipmapLinearFilter",ls:"LinearFilter",
  ig:"LinearMipmapNearestFilter",Ln:"LinearMipmapLinearFilter",R_:"NeverCompare",L_:"AlwaysCompare",
  A_:"LessCompare",SM:"LessEqualCompare",k_:"EqualCompare",z_:"GreaterEqualCompare",C_:"GreaterCompare",P_:"NotEqualCompare"}))
  sandbox[name]=THREE[key];
// Expose the real WebGLTextures dispose-listener registration only in this CPU
// probe. GPU allocation is represented by seeded old/new property maps below.
const textures=owner("dY").replace("    this.allocateTextureUnit = L,",`    this.testListen = target => target.addEventListener("dispose", T);
    this.allocateTextureUnit = L,`);
vm.createContext(sandbox);
vm.runInContext(helpers+owner("KG")+owner("AK")+owner("OK")+textures+
  ";globalThis.api={KG,AK,OK,dY,dispose:ghGLResourceDisposer,retire:ghRetireGLResourceGeneration};",sandbox);
const {api}=sandbox;

function glFixture() {
  const deletes=[],gl={generation:1,lost:false,isContextLost(){return this.lost;},
    getParameter(){return 8;},MAX_VERTEX_ATTRIBS:34921,ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,
    FLOAT:5126,INT:5124,UNSIGNED_INT:5125,
    createBuffer(){return {kind:"Buffer",generation:this.generation};},
    createVertexArray(){return {kind:"VertexArray",generation:this.generation};}};
  for(const name of ["bindBuffer","bufferData","bufferSubData","bindVertexArray","enableVertexAttribArray",
    "disableVertexAttribArray","vertexAttribDivisor","vertexAttribPointer","vertexAttribIPointer"])gl[name]=()=>{};
  for(const kind of ["Buffer","VertexArray","Texture","Framebuffer","Renderbuffer","Program","Shader"])
    gl["delete"+kind]=handle=>{
      assert.equal(handle.generation,gl.generation,"stale GPU handle crossed the native delete boundary");
      deletes.push({kind,handle});
    };
  return {gl,deletes,lose(){gl.lost=true;api.retire(gl);},restore(){gl.generation++;gl.lost=false;}};
}

function geometryBackend(gl,geometry) {
  const attributes=new api.KG(gl),states=new api.AK(gl,attributes),info={memory:{geometries:0}};
  const geometries=new api.OK(gl,attributes,info,states);
  geometries.get({},geometry);geometries.update(geometry);
  states.setup({}, {}, {id:19,getAttributes:()=>({position:{location:0,locationSize:1}})},geometry,null);
  return {attributes,states,info};
}

test("actual old/new geometry listeners clear both CPU caches but delete only current buffers and VAOs",()=>{
  const f=glFixture(),geometry=new THREE.BufferGeometry();
  const attribute=new THREE.BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3);
  geometry.setAttribute("position",attribute);
  const old=geometryBackend(f.gl,geometry);
  assert.equal(geometry._listeners.dispose.length,1);
  f.lose();f.restore();
  const current=geometryBackend(f.gl,geometry);
  assert.equal(geometry._listeners.dispose.length,2,"same CPU geometry retains both backend listeners");
  geometry.dispose();
  assert.deepEqual(f.deletes.map(d=>d.kind),["Buffer","VertexArray"]);
  assert.equal(old.info.memory.geometries,0);assert.equal(current.info.memory.geometries,0);
  assert.equal(old.attributes.get(attribute),undefined);assert.equal(current.attributes.get(attribute),undefined);
  assert.equal(geometry._listeners.dispose.length,0);
  geometry.dispose();assert.equal(f.deletes.length,2,"repeat disposal cannot delete again");
  const rebuilt=geometryBackend(f.gl,geometry);geometry.dispose();
  assert.equal(rebuilt.info.memory.geometries,0);
  assert.equal(f.deletes.length,4,"same-context recreation still deletes normally");
});

function textureBackend(gl,target,{cube=false,multisample=false}={}) {
  const map=new WeakMap(), properties={get(object){if(!map.has(object))map.set(object,{});return map.get(object);},
    remove(object){map.delete(object);}}, info={memory:{textures:1},render:{frame:0}};
  const extensions={has:()=>false},backend=new api.dY(gl,extensions,{},properties,{}, {},info);
  const handle=kind=>({kind,generation:gl.generation});
  const data=properties.get(target);
  data.__webglFramebuffer=cube?Array.from({length:6},()=>handle("Framebuffer")):handle("Framebuffer");
  if(cube)data.__webglDepthbuffer=Array.from({length:6},()=>handle("Renderbuffer"));
  else data.__webglDepthbuffer=handle("Renderbuffer");
  if(multisample)Object.assign(data,{__webglMultisampledFramebuffer:handle("Framebuffer"),
    __webglColorRenderbuffer:[handle("Renderbuffer")],__webglDepthRenderbuffer:handle("Renderbuffer")});
  properties.get(target.texture).__webglTexture=handle("Texture");
  backend.testListen(target);
  return {map,info};
}

test("actual retired render-target dispose callbacks skip stale FBO/depth/texture deletes and remove listeners/properties",()=>{
  for(const options of [{},{cube:true},{multisample:true}]) {
    const f=glFixture(),target=options.cube?new THREE.WebGLCubeRenderTarget(4):new THREE.WebGLRenderTarget(4,4);
    const old=textureBackend(f.gl,target,options);f.lose();f.restore();
    const current=textureBackend(f.gl,target,options);
    assert.equal(target._listeners.dispose.length,2);
    target.dispose();
    assert.equal(target._listeners.dispose.length,0);
    assert.equal(old.map.has(target),false);assert.equal(old.map.has(target.texture),false);
    assert.equal(current.map.has(target),false);assert.equal(current.map.has(target.texture),false);
    assert.equal(old.info.memory.textures,0);assert.equal(current.info.memory.textures,0);
    const expected=options.cube?{Framebuffer:6,Renderbuffer:6,Texture:1}:
      options.multisample?{Framebuffer:2,Renderbuffer:3,Texture:1}:{Framebuffer:1,Renderbuffer:1,Texture:1};
    const counts={};for(const d of f.deletes)counts[d.kind]=(counts[d.kind]||0)+1;
    assert.deepEqual(counts,expected);
    const before=f.deletes.length;target.dispose();assert.equal(f.deletes.length,before);
  }
});

test("GPU generation retirement is per context, persistent after restore, and does not disable same-context owners",()=>{
  const a=glFixture(),b=glFixture(),aOld=api.dispose(a.gl),aPeer=api.dispose(a.gl),bOwner=api.dispose(b.gl);
  aOld("deleteTexture",{generation:1});aPeer("deleteTexture",{generation:1});
  a.lose();aOld("deleteTexture",{generation:1});a.restore();
  aOld("deleteTexture",{generation:1});aPeer("deleteTexture",{generation:1});
  bOwner("deleteTexture",{generation:1});
  const aNew=api.dispose(a.gl);aNew("deleteTexture",{generation:2});
  a.lose();a.restore();aNew("deleteTexture",{generation:2});
  api.dispose(a.gl)("deleteTexture",{generation:3});
  assert.equal(a.deletes.length,4);assert.equal(b.deletes.length,1);
  const pt=source.slice(source.indexOf("      function pt(g0) {",source.indexOf("var Hm = class")),
    source.indexOf("      function V0()",source.indexOf("var Hm = class")));
  assert.ok(pt.indexOf("ghRetireGLResourceGeneration(m0)")>=0);
  assert.ok(pt.indexOf("ghRetireGLResourceGeneration(m0)")<pt.indexOf("x0.dispose()"),"loss retires handles before old callbacks run");
});
