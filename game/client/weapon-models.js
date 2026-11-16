// Model IDs travel on the wire. Families select the recovered rigs, attachments and mastery tracks.
export const models = {
  gbull: { family:"pistol", name:"G-Bull", mag:20, rpm:60/0.22, pellets:1, dmg:[34,20],
    range:[16,38], hip:[1.1,3.2], ads:0.14, recoilScale:0.85 },
  chingi: { family:"smg", name:"Chin-Gi", mag:30, rpm:60/0.09, pellets:1, dmg:[20,17],
    range:[22,48], hip:[0.9,2.4], ads:0.07, recoilScale:0.65 },
  linbei: { family:"shotgun", name:"Lin-Bei", mag:6, rpm:60/0.85, pellets:6, dmg:[12,10],
    range:[20,38], hip:[1.25,2.4], ads:0.65, recoilScale:0.75 },
};
export const factoryNames = { ar:"KR-7 CARBINE", smg:"VESPER 9", shotgun:"M12 BREACHER", pistol:"STRIX 9" };
export const familyOf = id => Object.hasOwn(models,id) ? models[id].family : id;
export const weaponName = id => models[id]?.name ?? factoryNames[id];
const storageKey = "gh_weapon_models_v1";
const selected = {};
try {
  const preferences = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "{}");
  for (const [family, id] of Object.entries(preferences)) {
    if (Object.hasOwn(models,id) && models[id].family === family) selected[family] = id;
  }
} catch { /* Storage may be unavailable in a restricted browser. */ }
export const selectedModel = family => selected[family] ?? family;
export function selectModel(family,id) {
  if (!Object.hasOwn(factoryNames,family) || familyOf(id) !== family) return;
  selected[family] = id;
  try { localStorage.setItem(storageKey, JSON.stringify(selected)); } catch {}
}
export function weaponDefinition(base) {
  const profileId = selectedModel(base.id), model = models[profileId];
  if (!model) return { ...base, profileId };
  return { ...base, ...model, id:base.id, profileId, recoil:{ ...base.recoil,
    v:base.recoil.v*model.recoilScale, h:base.recoil.h*model.recoilScale } };
}
