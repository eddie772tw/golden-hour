const base = ["ar", "smg", "shotgun", "pistol"];

// These tables are protocol constants. Community additions must be appended.
export const WEAPON_WIRE_IDS = Object.freeze({
  community: Object.freeze([...base, "gbull", "chingi", "linbei", "m200"]),
  v49221: Object.freeze(base),
  v60115: Object.freeze([...base, "m200"]),
});

export function encodeWeaponIndex(id, format = "community") {
  const index = Object.hasOwn(WEAPON_WIRE_IDS, format) ? WEAPON_WIRE_IDS[format].indexOf(id) : -1;
  return index === -1 ? undefined : index;
}

export function decodeWeaponIndex(index, format = "community") {
  if (Number.isInteger(index) && index >= 0 && Object.hasOwn(WEAPON_WIRE_IDS, format))
    return WEAPON_WIRE_IDS[format][index];
}
