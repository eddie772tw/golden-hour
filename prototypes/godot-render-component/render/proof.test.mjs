import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCE_SHA, hash, project } from './tools/project_gl_proof.mjs';
const bytes=readFileSync(new URL('./fixtures/gl-audit-proof.json',import.meta.url));
const proof=JSON.parse(bytes);
test('frozen compact proof is byte-pinned and preserves the selected record digest',()=>{
  const source=readFileSync(new URL('./source_shaders.gd',import.meta.url),'utf8');
  const pinned=source.match(/const PROOF_SHA: String = "([a-f0-9]{64})"/)[1];
  assert.equal(hash(bytes),pinned);
  assert.equal(proof.schema,'gh-godot-gl-audit-proof-v1');
  assert.equal(proof.sourceAudit.sha256,SOURCE_SHA);
  assert.equal(Object.keys(proof.materials).length,1);
  assert.equal(proof.objects.length,1);assert.equal(Object.keys(proof.attributes).length,1);
  const {materials,objects,attributes}=proof;
  assert.equal(hash(JSON.stringify({materials,objects,attributes})),proof.selectionSHA256);
  const owner=objects[0];assert.equal(owner.path,'world/311:');
  assert.deepEqual(proof.selection,[`materials/${owner.materials[0]}`,'objects/316',`attributes/${owner.geometry}`]);
});
test('projection tool refuses modified or unreviewed full audits',()=>{
  assert.throws(()=>project(Buffer.from('{}')),/exact reviewed/);
  const changed=Buffer.from(bytes);changed[5]^=1;
  assert.throws(()=>project(changed),/exact reviewed/);
});
