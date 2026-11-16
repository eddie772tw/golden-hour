// Deterministic lossless JSON selection from the single reviewed original audit.
// No geometry capture, browser, renderer, RNG, or network operation.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const SOURCE_SHA='c5a9ecd23a8ccba9ff5d6532ffd599530a5f4781348764a1205ac2c934a0c36b';
const vertexSHA='ff9ea90420f2abffe746d1d0bcf24bfd8132f8587e174e96933df3d851af3274';
const fragmentSHA='3c0210076da24ec761d424727d804c0b6c1e00fc317b924557a7fec0f9186b89';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function project(bytes) {
  if(hash(bytes)!==SOURCE_SHA) throw Error('Only the exact reviewed original shader audit is accepted');
  const original=JSON.parse(bytes);
  if(original.schema!=='gh-original-shader-audit-v1') throw Error('Original schema mismatch');
  const candidates=Object.values(original.materials).filter(m=>m.shaderMaterial && hash(m.vertexShader??'')===vertexSHA && hash(m.fragmentShader??'')===fragmentSHA);
  if(candidates.length!==1) throw Error('Expected one exact source GL material');
  const material=candidates[0], owners=original.objects.filter(o=>o.materials.includes(material.id));
  if(owners.length!==1) throw Error('Expected one original owner');
  const owner=owners[0], geometry=original.attributes[owner.geometry];
  if(!geometry?.attrs.aT || Object.keys(geometry.attrs).join(',')!=='aT') throw Error('Unexpected source GL attributes');
  const values={materials:{[material.id]:material},objects:[owner],attributes:{[owner.geometry]:geometry}};
  return {schema:'gh-godot-gl-audit-proof-v1',sourceAudit:{schema:original.schema,sha256:SOURCE_SHA,byteLength:bytes.length},
    selection:[`materials/${material.id}`,`objects/${original.objects.indexOf(owner)}`,`attributes/${owner.geometry}`],
    selectionSHA256:hash(JSON.stringify(values)),...values};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==4) throw Error('Usage: node project_gl_proof.mjs ORIGINAL-AUDIT.json OUTPUT-PROOF.json');
  const bytes=Buffer.from(JSON.stringify(project(readFileSync(process.argv[2])),null,2)+'\n');
  writeFileSync(process.argv[3],bytes);
  console.log(JSON.stringify({sha256:hash(bytes),bytes:bytes.length}));
}
