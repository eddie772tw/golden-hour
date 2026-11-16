import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { sampler,evaluate,half } from './tools/hm_reference.mjs';
import { project,hash } from './tools/project_hm_fixture.mjs';
const fixtureBytes=fs.readFileSync(new URL('./fixtures/hm-source.json',import.meta.url));
const fixture=JSON.parse(fixtureBytes);
const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/hm-oracle-cases.json',import.meta.url)));
// External real capture is deliberately not shipped. No synthetic runtime asset.
const bytes=process.env.GH_HM_VOLUME ? fs.readFileSync(process.env.GH_HM_VOLUME) : null;
const repoRoot=process.env.GH_GODOT_SOURCE_ROOT??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');

test('normalized trilinear reference distinguishes all axes and clamps edges',()=>{
  assert.equal(half(0x3c00),1);assert.equal(half(0x8000),-0);assert.ok(Number.isNaN(half(0x7e01)));
  const words=[0,0x3c00,0x4000,0x4200,0x4400,0x4500,0x4600,0x4700];
  const b=Buffer.alloc(2*2*2*8);for(let i=0;i<8;i++)for(let c=0;c<4;c++)b.writeUInt16LE(c===3?0x3c00:words[i],i*8+c*2);
  const t=sampler(b,2,2,2);
  assert.deepEqual(t.sample([1,0,0]),[1,1,1]);assert.deepEqual(t.sample([0,1,0]),[2,2,2]);assert.deepEqual(t.sample([0,0,1]),[4,4,4]);
  assert.deepEqual(t.sample([.5,.5,.5]),[3.5,3.5,3.5]);assert.deepEqual(t.sample([-10,-10,-10]),[0,0,0]);assert.deepEqual(t.sample([10,10,10]),[7,7,7]);
});

test('portable projection pins source TY, all compiled roles and fixed non-tick clock',()=>{
  const loader=fs.readFileSync(new URL('./lightfield_binding.gd',import.meta.url),'utf8');
  assert.equal(hash(fixtureBytes),loader.match(/const FIXTURE_SHA: String="([a-f0-9]{64})"/)[1]);
  assert.equal(hash(fixture.sourceTY),fixture.sourceTYSHA256);
  assert.equal(fixture.roles.length,177);
  assert.ok(fixture.roles.every(r=>r.compiledVariants.every(p=>p.hasSourceTY&&p.hasIrradianceCall)));
  assert.equal(cases.clock,8.479888889365725);assert.notEqual(cases.clock,fixture.source.tick/60);
  const shader=fs.readFileSync(new URL('./lightfield.gdshaderinc',import.meta.url),'utf8');
  assert.equal(hash(shader),fixture.nativeShaderSHA256);assert.ok(!/\bTIME\b/.test(shader));
  assert.ok(shader.includes('vec3 pw = (ghLVMat * vec4(worldPos, 1.0)).xyz;'));
  assert.throws(()=>project(Buffer.from('{}')),/Exact reviewed/);
});

test('actual global Material hook exposes original clock reference without material construction, rendering or RNG',async()=>{
  const {loadBundle}=await import(pathToFileURL(path.join(repoRoot,'server/fixtures/bundle-probe.mjs')));
  const {THREE:T}=loadBundle(pathToFileURL(path.join(repoRoot,'game/core/game.js')));
  const originalMath=T.MathUtils.generateUUID.constructor('return Math')(),old=originalMath.random;let calls=0;
  originalMath.random=()=>{calls++;return .5;};
  try{
    const receiver=Object.create(T.MeshStandardMaterial.prototype);
    const collect=()=>{const s={uniforms:{},fragmentShader:'varying vec3 vViewPosition;\nvoid main() {\n#include <lights_fragment_begin>\n}'};receiver.onBeforeCompile(s);return s.uniforms;};
    const a=collect(),b=collect();assert.equal(a.ghLVT,b.ghLVT);assert.equal(a.ghLVT.value,b.ghLVT.value);assert.equal(calls,0);
  }finally{originalMath.random=old;}
});

test('external original RGBAH words, shape and A/B centers agree with fixed reference',{skip:!bytes&&'Set GH_HM_VOLUME to the original external asset'},()=>{
  assert.equal(bytes.length,397440);assert.equal(hash(bytes),fixture.asset.sha256);
  const tex=sampler(bytes,60,18,46);
  for(const row of cases.cases.slice(0,3)){
    const value=evaluate(fixture,tex,row.position,row.normal,{baseOnly:true});
    value.value.forEach((v,i)=>assert.ok(Math.abs(v-row.expected.value[i])<1e-14));
    assert.equal(value.time,8.479888889365725);
  }
});

test('external real volume phase witnesses distinguish disabled pool/sparkle contributions',{skip:!bytes&&'Set GH_HM_VOLUME to the original external asset'},()=>{
  assert.equal(hash(bytes),fixture.asset.sha256);
  const t=sampler(bytes,60,18,46);
  for(const name of ['pool-caustic-witness','chandelier-sparkle-witness']){
    const row=cases.cases.find(c=>c.name===name),full=evaluate(fixture,t,row.position,row.normal),base=evaluate(fixture,t,row.position,row.normal,{baseOnly:true});
    assert.ok(Math.max(...full.value.map((v,i)=>v-base.value[i]))>.1);
  }
});

test('external original manifest regenerates the lossless projection and native syntax changes',{skip:!process.env.GH_HM_COMPILED_MANIFEST&&'Set GH_HM_COMPILED_MANIFEST for full projection regeneration'},()=>{
  const regenerated=project(fs.readFileSync(process.env.GH_HM_COMPILED_MANIFEST));
  assert.equal(JSON.stringify(regenerated.fixture,null,2)+'\n',fixtureBytes.toString());
  assert.equal(regenerated.native,fs.readFileSync(new URL('./lightfield.gdshaderinc',import.meta.url),'utf8'));
});
