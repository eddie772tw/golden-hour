// Lossless bounded selection from the exact already-verified compiled evidence.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const SOURCE_SHA='685d847b6530608c9b94e7478c141dc91fd76ec5672491e0d7e4079f156978c9';
export const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function project(bytes){
  if(hash(bytes)!==SOURCE_SHA)throw Error('Exact reviewed compiled evidence required');
  const a=JSON.parse(bytes),lv=a.lightVolume,t=a.textures[lv.texture.texture],asset=a.assets[t.asset];
  if(a.source.coreSHA256!=='b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b'||a.source.quality!=='high'||a.source.tick!==240)throw Error('Source/core/High/tick mismatch');
  if(t.type!==1016||t.format!==1023||t.dimension!==3||t.colorSpace!==''||t.width!==60||t.height!==18||t.depth!==46||t.filter.join()!=[1006,1006].join()||t.wrap.join()!=[1001,1001,1001].join()||t.generateMipmaps||t.flipY||asset.arrayType!=='Uint16Array'||asset.byteLength!==397440)throw Error('Expected real linear/clamp RGBA half-float HM, never generic noise');
  const names=['ghLV','ghLVMat','ghLVOrg','ghLVInv','ghLVK','ghLVT','ghPool','ghChand'];
  const lit=Object.values(a.materials).filter(m=>m.compiledUniforms.ghLV?.texture===t.id);
  if(lit.length!==177)throw Error('Unexpected compiled role count');
  const uniformValues=m=>Object.fromEntries(names.map(k=>[k,m.compiledUniforms[k]]));
  const uniforms=uniformValues(lit[0]);
  if(lit.some(m=>JSON.stringify(uniformValues(m))!==JSON.stringify(uniforms)))throw Error('Source per-material LV uniforms differ');
  const fragment=a.codes[lit[0].compiledVariants[0].fragment].text;
  const start=fragment.indexOf('uniform highp sampler3D ghLV;'),functionStart=fragment.indexOf('vec3 ghLightVolume(');
  if(start<0||functionStart<start)throw Error('Source TY boundary changed');
  let end=fragment.indexOf('{',functionStart),depth=1;
  while(depth&&++end<fragment.length){if(fragment[end]==='{')depth++;else if(fragment[end]==='}')depth--;}
  if(depth)throw Error('Unclosed source TY');
  const sourceTY=fragment.slice(start,end+1);
  let native=sourceTY;
  for(const [before,after]of [
    ['uniform highp sampler3D ghLV;','uniform sampler3D ghLV : filter_linear, repeat_disable;'],
    ['uniform vec3 ghLVOrg, ghLVInv;','uniform vec3 ghLVOrg; uniform vec3 ghLVInv;'],
    ['uniform vec4 ghLVK, ghLVT, ghPool, ghChand;','uniform vec4 ghLVK; uniform vec4 ghLVT; uniform vec4 ghPool; uniform vec4 ghChand;'],
    ['vec3 ghLightVolume(vec3 viewPos, vec3 viewN) {','vec3 ghLightVolumeWorld(vec3 worldPos, vec3 worldN) {'],
    ['vec3 pw = (ghLVMat * vec4((vec4(viewPos, 0.0) * viewMatrix).xyz + cameraPosition, 1.0)).xyz;','vec3 pw = (ghLVMat * vec4(worldPos, 1.0)).xyz;'],
    ['vec3 nw = normalize(mat3(ghLVMat) * (vec4(viewN, 0.0) * viewMatrix).xyz);','vec3 nw = normalize(mat3(ghLVMat) * worldN);']]){
    if(native.split(before).length!==2)throw Error('Expected unique source transform: '+before);
    native=native.replace(before,after);
  }
  native='// Generated from byte-pinned source TY; world inputs replace view-to-world reconstruction only.\n'+native+'\n';
  const owners=new Map(a.objects.map(o=>[o.id,o]));
  const roles=lit.map(m=>{
    const variants=m.compiledVariants.map(p=>({id:p.id,vertexSHA256:a.codes[p.vertex].sha256,fragmentSHA256:a.codes[p.fragment].sha256,hasSourceTY:a.codes[p.fragment].text.includes(sourceTY),hasIrradianceCall:a.codes[p.fragment].text.includes('irradiance += ghLightVolume(-vViewPosition, normal);')}));
    if(!['MeshStandardMaterial','MeshPhysicalMaterial'].includes(m.type)||variants.some(p=>!p.hasSourceTY||!p.hasIrradianceCall))throw Error('Unsupported original lit role');
    return {sourceMaterial:m.id,nativeID:m.nativeID,name:m.name,type:m.type,scalarFlags:m.scalarFlags,sourceFactors:m.sourceFactors,hasNjSurface:!!m.ghUniforms.ghT,
      userHookSHA256:m.userHook?a.codes[m.userHook].sha256:null,compiledVariants:variants,
      owners:m.owners.map(link=>{const o=owners.get(link.object);return {nativeID:o.nativeID,path:o.path,name:o.name,type:o.type,slot:link.slot,effectiveVisible:o.effectiveVisible,layers:o.layers,renderOrder:o.renderOrder,
        geometryType:o.geometryType,vertices:o.vertices,indexCount:o.indexCount,attributeMetadata:o.attributes};})};
  });
  return {native,fixture:{schema:'gh-hm-typed-fixture-v1',source:a.source,sourceManifestSHA256:SOURCE_SHA,lightVolume:lv,texture:t,asset,uniforms,uniformSignatureSHA256:hash(JSON.stringify(uniforms)),sourceTY,sourceTYSHA256:hash(sourceTY),nativeShaderSHA256:hash(native),roles,
    scope:'Real static HM asset and fixed source time; receiver material/layout/AO/BRDF parity separate; UUID provenance not matching rule'}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv.length!==5)throw Error('Usage: node project_hm_fixture.mjs INPUT-MANIFEST OUTPUT-FIXTURE OUTPUT-SHADER');
  const {fixture,native}=project(fs.readFileSync(process.argv[2]));
  const output=JSON.stringify(fixture,null,2)+'\n';fs.writeFileSync(process.argv[3],output);fs.writeFileSync(process.argv[4],native);
  console.log(JSON.stringify({fixtureBytes:Buffer.byteLength(output),fixtureSHA256:hash(output),nativeShaderSHA256:hash(native),roles:fixture.roles.length}));
}
