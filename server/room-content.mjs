import { builtinMap, mapKey } from "./maps.mjs";

export function roomContent(map, modeId) {
  return { mapId:map.ref.id, mapVersion:map.ref.version, mapRevision:map.ref.revision, modeId };
}

export function acceptsMap(hello, map, modeId = "tdm") {
  const selected=hello.mapId!==undefined || hello.mapVersion!==undefined || hello.mapRevision!==undefined;
  if (hello.mapProtocol!==1) return hello.mapProtocol===undefined && !selected && hello.modeId===undefined && map===builtinMap;
  return (!selected || (hello.mapId===map.ref.id && hello.mapVersion===map.ref.version && hello.mapRevision===map.ref.revision)) &&
    (hello.modeId===undefined || hello.modeId===modeId);
}

export function selectTdmMap(maps, hello) {
  if (hello.mapId===undefined && hello.mapVersion===undefined && hello.mapRevision===undefined) {
    if (!acceptsMap(hello,builtinMap)) throw Error("error.map_version");
    return builtinMap;
  }
  if (typeof hello.mapId!=="string" || typeof hello.mapVersion!=="string") throw Error("error.map_version");
  const map=maps.get(mapKey({id:hello.mapId,version:hello.mapVersion}));
  if (!map || !acceptsMap(hello,map)) throw Error("error.map_version");
  return map;
}

export function findTdmRoom(rooms, map) {
  return [...rooms].find(room=>room.modeId==="tdm" && room.map===map && room.phase==="live" && room.summary().joinable);
}
