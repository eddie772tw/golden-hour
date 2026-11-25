import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { World } from "../game/client/simulation.js";

const hotel = JSON.parse(readFileSync(new URL("./world.json", import.meta.url)));
const idPattern = /^[a-z0-9][a-z0-9-]{0,31}$/;
const versionPattern = /^[0-9]{1,16}$/;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const coordinate = number => Number.isFinite(number) && Math.abs(number) <= 1000;
const vector = value => Array.isArray(value) && value.length === 3 && value.every(coordinate);
const hotelBounds = { minX:-31, maxX:31, minZ:-24, maxZ:25 };

export const builtinMap = {
  ...hotel,
  ref: Object.freeze({ id:"hotel", version:"builtin", revision:"builtin", name:"暮色酒店", clientScene:"hotel" }),
  bounds: hotelBounds,
  nodes: hotel.nodes.map(pos => ({pos, links:[]})),
  spawns: hotel.nodes.slice(0,10).map((pos,i) => ({pos, yaw:0, team:i%2})),
  bulletCover: hotel.colliders.filter(c => !c.noRay),
};

export const mapKey = ({ id, version }) => id + "/" + version;

function readJSON(dir, name, limit = 8 * 1024 * 1024) {
  const bytes = readFileSync(join(dir,name));
  if (bytes.length > limit) throw Error(name + " exceeds the size limit");
  return { bytes, value:JSON.parse(bytes.toString("utf8")) };
}

function normalizeBounds(raw, mapId) {
  const { minX,maxX,minZ,maxZ } = raw ?? (mapId === "hotel" ? hotelBounds : {});
  if (![minX,maxX,minZ,maxZ].every(coordinate) || minX >= maxX || minZ >= maxZ)
    throw Error("invalid bounds");
  return {minX,maxX,minZ,maxZ};
}

function readWorld(value, mapId) {
  const {colliders,nodes}=value;
  if (!Array.isArray(colliders) || !colliders.length || colliders.length > 20000 ||
      !colliders.every(box => box && vector(box.min) && vector(box.max) &&
        box.min.every((v,i) => v < box.max[i]) && typeof box.noMove === "boolean" && typeof box.noRay === "boolean"))
    throw Error("invalid colliders");
  const cells=colliders.reduce((sum,{min,max}) => sum +
    (1+Math.floor(max[0]/4)-Math.floor(min[0]/4))*(1+Math.floor(max[2]/4)-Math.floor(min[2]/4)),0);
  if (cells>1000000) throw Error("collision index exceeds the size limit");
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > 10000 ||
      !nodes.every((node,i) => node && vector(node.pos) && Array.isArray(node.links) && node.links.length<=64 &&
        node.links.every(to => Number.isInteger(to) && to>=0 && to<nodes.length && to!==i)))
    throw Error("invalid navigation nodes");
  return { colliders, nodes, bounds:normalizeBounds(value.bounds,mapId) };
}

function readSpawns(value, world, bounds) {
  const {spawns}=value;
  if (!Array.isArray(spawns) || spawns.length>100 || !spawns.every(spawn =>
    spawn && vector(spawn.pos) && (spawn.team===0 || spawn.team===1) && (spawn.yaw===undefined || Number.isFinite(spawn.yaw))))
    throw Error("invalid team spawns");
  // Authored reserve positions may sit too close to a door or trim to fit a player.
  const usable = spawns.filter(({pos:[x,y,z]}) =>
    x>=bounds.minX && x<=bounds.maxX && z>=bounds.minZ && z<=bounds.maxZ && !world.blockedAt(x,y,z,1.8));
  if ([0,1].some(team=>usable.filter(spawn=>spawn.team===team).length<5))
    throw Error("fewer than five usable spawns per team");
  return usable;
}

// A solid box contributes only planes inside itself. Separate boxes leave openings intact.
function coverPlanes(colliders) {
  return colliders.filter(box=>box.max[1]-box.min[1]>=0.5).flatMap(({min,max}) =>
    [0,2].filter(axis=>max[axis]>min[axis]).map(axis => {
      const along=2-axis;
      return {axis:axis===0?"x":"z",pos:(min[axis]+max[axis])/2,a0:min[along],a1:max[along],
        y0:min[1],y1:max[1],openings:[]};
    }));
}

function loadMap(root, id, version) {
  const dir=join(root,id,version);
  const manifest=readJSON(dir,"manifest.json",65536);
  const {schema,name,clientScene,sceneAsset,sceneBytes,sceneSHA256,environment}=manifest.value;
  if (manifest.value.id!==id || manifest.value.version!==version || schema!==1 ||
      typeof name!=="string" || !name.trim() || name.length>80 ||
      (clientScene !== (id==="hotel" ? "hotel" : "gltf")) ||
      manifest.value.worldAsset!=="world.json" || manifest.value.gameplayAsset!=="gameplay.json")
    throw Error("invalid manifest");
  if (clientScene==="gltf") {
    if (sceneAsset!==`assets/maps/${id}/${version}/scene.glb` ||
        !Number.isInteger(sceneBytes) || sceneBytes<20 || sceneBytes>64*1024*1024 ||
        !/^[0-9a-f]{64}$/.test(sceneSHA256) ||
        !/^[a-f0-9]{6}$/i.test(environment?.background) || !/^[a-f0-9]{6}$/i.test(environment?.fogColor) ||
        !Number.isFinite(environment?.fogDensity) || environment.fogDensity<0 || environment.fogDensity>1)
      throw Error("invalid scene descriptor");
    // A headless server needs only gameplay JSON. The checked manifest binds the scene to this revision.
  }
  const world=readJSON(dir,"world.json"), gameplay=readJSON(dir,"gameplay.json");
  const data=readWorld(world.value,id), bulletCover=data.colliders.filter(c=>!c.noRay);
  const spawns=readSpawns(gameplay.value,new World(data.colliders,data.bounds),data.bounds);
  const hashes=[manifest,world,gameplay].map(file=>digest(file.bytes));
  const revision=digest(hashes.join(":"));
  return { ref:Object.freeze({ id,version,revision,name,clientScene }), ...data, spawns, bulletCover, walls:coverPlanes(bulletCover) };
}

export function loadMapCatalog(root, report = console.warn) {
  const maps=new Map([[mapKey(builtinMap.ref),builtinMap]]);
  let entries;
  try {
    const {value}=readJSON(root,"catalog.json",65536);
    if (value?.schema!==1 || !Array.isArray(value.maps) || value.maps.length>32) throw Error("invalid catalog");
    entries=value.maps;
  } catch (cause) {
    if (cause.code!=="ENOENT") report("Map catalog: "+cause.message);
    return maps;
  }
  for (const entry of entries) {
    const {id,version}=entry ?? {};
    if (typeof id!=="string" || !idPattern.test(id) ||
        typeof version!=="string" || !versionPattern.test(version)) {
      report("Map catalog: invalid map ID or version");
      continue;
    }
    const key=mapKey(entry);
    if (maps.has(key)) continue;
    try { maps.set(key,loadMap(root,id,version)); }
    catch (cause) { report(`Map ${key}: ${cause.message}`); }
  }
  return maps;
}
