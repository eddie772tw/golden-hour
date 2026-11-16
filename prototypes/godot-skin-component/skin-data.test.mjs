import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSkinFixture} from './export-skin.mjs';
import {readAttribute,reverseWinding,sha256} from './skin-data.mjs';
import {decodeOperators} from '../../game/client/startup-geometry.js';
import {REPO} from '../godot-node-logic/load-runtime.mjs';

const {packet,binary,platformCalls}=buildSkinFixture();
assert.deepEqual(platformCalls,[]);
const bytes=readFileSync(new URL('game/assets/operators.bin',REPO));
const decoded=decodeOperators(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),packet.source.bundleVersion);
for(const asset of packet.assets){
  assert.equal(asset.bones.length,34);assert.ok(asset.bones.every(b=>b.parent===-1),'Preserve original flat hierarchy');
  assert.deepEqual(Object.keys(asset.attributes).sort(),Object.keys(decoded[asset.team].attributes).sort());
  for(const [name,record] of Object.entries(asset.attributes)){
    const original=decoded[asset.team].attributes[name].data,actual=readAttribute(binary,record);
    assert.equal(actual.constructor,original.constructor);
    assert.equal(sha256(Buffer.from(actual.buffer)),sha256(Buffer.from(original.buffer,original.byteOffset,original.byteLength)),name);
  }
  const indices=readAttribute(binary,asset.index),cw=readAttribute(binary,asset.godotClockwiseIndex);
  const selected=indices.slice(asset.drawRange.start,asset.drawRange.start+asset.drawRange.count);
  assert.deepEqual(reverseWinding(cw),selected,'One winding reversal; no axis conversion');
  assert.ok(asset.preservedButNotMappedToGodotHigh.includes('aux')&&asset.preservedButNotMappedToGodotHigh.includes('aux2'));
  assert.ok(asset.frames[1].requiresAffinePalette&&asset.frames[1].maxPoseTRSRecomposeError>.01,
    'Actual original walking shear must remain explicit; do not silently replace it with TRS');
  const a=readAttribute(binary,asset.frames[0].nativeWorldPositionGolden),b=readAttribute(binary,asset.frames[1].nativeWorldPositionGolden);
  assert.ok(a.some((v,i)=>Math.abs(v-b[i])>.01),'Original rig.update must produce genuinely different skin poses');
  const moved=readAttribute(binary,asset.frames[3].nativeWorldPositionGolden);
  assert.ok(b.some((v,i)=>Math.abs(v-moved[i])>1),'Original parent-transform test must be nontrivial');
}
assert.equal(packet.validation.length,8);
assert.ok(packet.validation.every(v=>v.maxError<2e-6&&v.maxFloat32PaletteError<3e-6));
const corrupt=Buffer.from(binary);corrupt[packet.assets[0].attributes.position.byteOffset]^=1;
assert.throws(()=>readAttribute(corrupt,packet.assets[0].attributes.position),/Corrupt/);
console.log(JSON.stringify({ok:true,teams:2,realBonesPerTeam:34,originalPoses:8,originalAttributesExact:true,
  clockwiseIndexRoundTrip:true,auxPreserved:true,maxNativeCPUError:Math.max(...packet.validation.map(v=>v.maxError)),
  maxFloat32PaletteError:Math.max(...packet.validation.map(v=>v.maxFloat32PaletteError)),gpuRun:false}));
