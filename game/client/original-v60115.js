import { decodeWeaponIndex } from "./weapon-wire.js";

export const ORIGINAL_V60115_ORIGIN = "https://156.225.18.250";
export const ORIGINAL_V60115 = "v60115";
export const ORIGINAL_V60115_IDENTITY = "v60115 需要 B 站 Toy 授权身份。此客户端没有获准的 Toy 登录流程。";
export const ORIGINAL_V60115_SITE = "https://www.bilibili.com/toy/golden-hour/index.html";

const roomId = /^[A-F0-9]{8}$/;
const identifier = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const version = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const m200Fields = ["optic", "muzzle", "underbarrel", "magazine", "stock", "camo"];

export function originalV60115Build(build) {
  if (!build || typeof build !== "object" || Array.isArray(build)) return undefined;
  const entries = m200Fields.filter(key => typeof build[key] === "string" && identifier.test(build[key]));
  return entries.length ? Object.fromEntries(entries.map(key => [key, build[key]])) : undefined;
}

export function validateOriginalV60115Welcome(event) {
  if (!roomId.test(event.room || "") || !Number.isSafeInteger(event.id) || event.id < 1 || event.id > 0xffffffff ||
      (event.resume != null && (typeof event.resume !== "string" || event.resume.length > 256))) {
    const error = Error("v60115 入场确认无效。");
    error.application = true;
    throw error;
  }
}

export function originalV60115Hello(message, identity) {
  if (typeof identity !== "string" || !identity.trim() || identity.length > 256) {
    const error = Error(ORIGINAL_V60115_IDENTITY);
    error.application = true;
    throw error;
  }
  const hello = {
    type: "hello", uid: identity.trim(), name: typeof message.name === "string" ? message.name.trim().slice(0, 32) : "",
    ...(message.m200Build && { m200Build: originalV60115Build(message.m200Build) }),
    weaponProtocol: 2, cosmeticDatagrams: true, shotAcks: true,
  };
  if (message.resume) {
    if (!roomId.test(message.room || "") || typeof message.resume !== "string" || message.resume.length > 256)
      throw Error("v60115 续接参数无效。");
    hello.room = message.room;
    hello.resume = message.resume;
    return hello;
  }
  if (message.room) {
    if (!roomId.test(message.room)) throw Error("房间代号无效。");
    hello.room = message.room;
    return hello;
  }
  if (message.create !== true && message.quick !== true) throw Error("请选择房间或联机地图。");
  hello[message.create ? "create" : "quick"] = true;
  if (message.create && message.public === true) hello.public = true;
  if (typeof message.difficulty === "string") hello.difficulty = message.difficulty;
  for (const key of ["mapId", "modeId"]) {
    if (!identifier.test(message[key] || "")) throw Error("所选地图或模式无效。");
    hello[key] = message[key];
  }
  return hello;
}

export function originalV60115Room(event) {
  if (!roomId.test(event.room || "") || !identifier.test(event.mapId || "") ||
      !version.test(event.mapVersion || "") || !identifier.test(event.modeId || "") ||
      !identifier.test(event.clientScene || "") || !identifier.test(event.modeAdapter || ""))
    throw Error("v60115 房间地图和模式版本无效。");
  return event;
}

export function originalV60115Catalog(value) {
  if (!Array.isArray(value?.maps) || !Array.isArray(value.modes)) throw Error("v60115 服务器目录无效。");
  const modes = new Map();
  for (const mode of value.modes) {
    if (!identifier.test(mode?.id || "") || !identifier.test(mode.clientAdapter || "") ||
        typeof mode.name !== "string" || modes.has(mode.id)) throw Error("v60115 模式目录无效。");
    modes.set(mode.id, mode);
  }
  const maps = new Map();
  for (const map of value.maps) {
    if (!identifier.test(map?.id || "") || !version.test(map.version || "") ||
        !identifier.test(map.clientScene || "") || typeof map.name !== "string" || maps.has(map.id) ||
        !Array.isArray(map.modes) || !map.modes.length || map.modes.some(id => !modes.has(id)))
      throw Error("v60115 地图目录无效。");
    if (map.clientScene === "gltf" && (
      map.sceneAsset !== `assets/maps/${map.id}/${map.version}/scene.glb` ||
      !/^[a-f0-9]{64}$/.test(map.sceneSHA256 || "") || !Number.isSafeInteger(map.sceneBytes) ||
      map.sceneBytes < 20 || map.sceneBytes > 64 * 1024 * 1024))
      throw Error("v60115 场景版本数据无效。");
    maps.set(map.id, map);
  }
  if (!maps.get(value.defaultMap)?.modes.includes(value.defaultMode)) throw Error("v60115 默认地图与模式无效。");
  return value;
}

export function matchOriginalV60115Room(event, catalog) {
  const room = originalV60115Room(event);
  const map = catalog.maps.find(map => map.id === room.mapId && map.version === room.mapVersion &&
    map.clientScene === room.clientScene && map.modes.includes(room.modeId));
  const mode = catalog.modes.find(mode => mode.id === room.modeId && mode.clientAdapter === room.modeAdapter);
  if (!map || !mode) throw Error("服务器房间版本与 v60115 目录不一致。");
  return { map, mode };
}

export function originalV60115SnapshotLayout(view) {
  const kind = view.getUint8(3), count = view.getUint8(13), zombies = view.getUint8(23);
  const playersEnd = 24 + count * 64, zombiesEnd = playersEnd + zombies * 14;
  const shotAcks = kind === 4;
  if ((kind !== 2 && !shotAcks) || count > 10 || zombies > 16 ||
      (zombies && (count > 4 || view.getUint8(12) !== 2)) ||
      view.byteLength !== zombiesEnd + (shotAcks ? count * 4 : 0)) return null;
  return { count, zombies, playersEnd, zombiesEnd, shotAcks };
}

export function decodeZombieRecords(view, layout) {
  const records = [];
  const ids = new Set();
  for (let i = 0; i < layout.zombies; i++) {
    const offset = layout.playersEnd + i * 14;
    const id = view.getUint32(offset, true), kind = view.getUint8(offset + 12), flags = view.getUint8(offset + 13);
    if (id < 0x80000000 || ids.has(id) || kind > 2 || flags > 3) return null;
    ids.add(id);
    records.push({ id, kind,
      x: view.getInt16(offset + 4, true) / 100, y: view.getInt16(offset + 6, true) / 100,
      z: view.getInt16(offset + 8, true) / 100, yaw: view.getInt16(offset + 10, true) * Math.PI / 32767,
      moving: !!(flags & 1), attacking: !!(flags & 2),
    });
  }
  return records;
}

export function decodeOriginalCosmetic(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (bytes?.byteLength !== 36) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x03014748) return null;
  const id = view.getUint32(4, true), weapon = decodeWeaponIndex(view.getUint8(8), "v60115");
  const [x, y, z, dx, dy, dz] = Array.from({ length: 6 }, (_, i) => view.getFloat32(12 + i * 4, true));
  if (!id || !weapon || ![x, y, z, dx, dy, dz].every(Number.isFinite)) return null;
  return { type: "shot", id, weapon, x, y, z, dx, dy, dz };
}
