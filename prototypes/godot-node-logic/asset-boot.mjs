import {readFileSync} from 'node:fs';
import {REPO} from './load-runtime.mjs';
const [{decodeOperators,restoreOperator,hydrateGrips},{restoreMaterials},
  {familyOf,weaponDefinition,selectedModel},{mountShopWeapon},{startupPolicy,limitTextureData}]=
  await Promise.all(['startup-geometry.js','startup-cache.js','weapon-models.js','shop-weapon-art.js','performance-policy.js']
    .map(file=>import(new URL('game/client/'+file,REPO))));

export function createAssetBoot() {
  const bytes=readFileSync(new URL('game/assets/operators.bin',REPO));
  const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  const version=readFileSync(new URL('game/index.html',REPO),'utf8').match(/data-bundle="([^"]+)"/)[1];
  const decoded=decodeOperators(buffer,version),available=decoded.slice();
  const policy=startupPolicy({coarse:false,mobile:false,platform:'Win32'});
  let actorTextures;
  return {policy,stats:{version},familyOf,weaponDefinition,selectedModel,mountShopWeapon,
    restoreActorTexture(name,create){actorTextures??=restoreMaterials(decoded.materials,create,8);return actorTextures?.[name]??null;},
    restoreOperator(team,geometry,attribute){const record=available[team];available[team]=null;return restoreOperator(record,geometry,attribute);},
    hydrateGrips(kind,gun,vector,quaternion){return hydrateGrips(kind,gun,decoded.grips,vector,quaternion);},
    restoreMaterials(){return null;},
    captureMaterials(value){this.pendingMaterials=value;},
    limitTextureData(data,width,height){return limitTextureData(data,width,height,policy.textureLimit);},
    limitTextureCanvas(canvas){if(policy.textureLimit!==Infinity)throw Error('Desktop-only proof');return canvas;},
    async prepareOperators(){},
  };
}
