import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const fixture = JSON.parse(read('./fixtures/shaft-capture3-fixture.json'));
const projection = JSON.parse(read('./fixtures/gl-audit-proof.json'));
const original = Object.values(projection.materials)[0];
const guards = read('./source_shaders.gd');
const proof = {owner:projection.objects[0],aT:Object.values(projection.attributes)[0].attrs.aT,
  sourceCore:guards.match(/const CORE: String = "([a-f0-9]{64})"/)[1],
  vertexShader:original.vertexShader,fragmentShader:original.fragmentShader,uniforms:original.uniforms,
  vertexSHA256:guards.match(/const VERTEX_SHA: String = "([a-f0-9]{64})"/)[1],
  fragmentSHA256:guards.match(/const FRAGMENT_SHA: String = "([a-f0-9]{64})"/)[1]};
const hash = s => createHash('sha256').update(s).digest('hex');

test('real capture3 GL owner/topology matches the audited role without UUID matching', () => {
  const { owner:o, geometry:g, material:m, source:s } = fixture;
  const audited=proof.owner;
  for(const key of ['nativeID','path','type','layers','renderOrder']) assert.deepEqual(o[key],audited[key]);
  assert.equal(o.nativeID,1426); assert.equal(o.path,'world/311:');
  assert.equal(s.quality,'high'); assert.equal(s.coreSHA256,proof.sourceCore);
  assert.deepEqual(o.matrix,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  assert.equal(o.castShadow,false); assert.equal(g.position.count,912); assert.equal(g.index,null);
  assert.equal(o.surfaces.length,1); assert.equal(o.surfaces[0].mode,'triangles');
  assert.deepEqual(o.surfaces[0].indices,Array.from({length:912},(_,i)=>i));
  assert.equal(m.shaderMaterial,true); assert.equal(m.transparent,true);
  assert.equal(m.blending,5); assert.equal(m.side,2); assert.equal(m.depthWrite,false);
  assert.equal(m.depthTest,true); assert.equal(m.colorWrite,true); assert.equal(m.stencilWrite,false);
  // Values can have coincident UUIDs under seeded initialization; relation above
  // deliberately does not inspect material/geometry/Object3D UUID equality.
});

test('actual source aT bytes match the procedural six-vertex shader input', () => {
  const a=proof.aT; const bytes=Buffer.from(a.data.base64,'base64');
  assert.equal(a.count,912);assert.equal(a.stride,1);assert.equal(a.data.type,'Float32Array');
  const p=fixture.geometry.position.values;
  for(let i=0;i<912;i++) assert.equal(bytes.readFloatLE(i*4),[0,0,1,0,1,1][i%6]);
  for(let i=0;i<912;i+=6) for(let j=0;j<3;j++) {
    assert.equal(p[i*3+j],p[(i+3)*3+j]);assert.equal(p[(i+2)*3+j],p[(i+4)*3+j]);
  }
});

test('audited source early-discard precedes all cosmetic/time-dependent arithmetic', () => {
  assert.equal(hash(proof.vertexShader),proof.vertexSHA256);
  assert.equal(hash(proof.fragmentShader),proof.fragmentSHA256);
  assert.equal(proof.uniforms.uK,0);
  const body=proof.fragmentShader.slice(proof.fragmentShader.indexOf('void main()'));
  assert.match(body,/void main\(\)\s*\{\s*if \(uK <= 0\.0\) discard;/);
  const port=read('./shaft.gdshader');
  assert.match(port,/void fragment\(\)\s*\{\s*if\(source_k<=0\.0\) discard;/);
  assert.match(port,/depth_draw_never/); assert.match(port,/blend_add/);
  assert.match(port,/ALPHA=1\.0/);
});
