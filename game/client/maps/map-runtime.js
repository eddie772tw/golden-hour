import { BUILTIN_HOTEL, loadMapData, loadMapSceneBytes } from "./map-assets.js";
import { decodeMapScene } from "./gltf-scene.js";

const noop = () => {};

function buildWorld(runtime, data) {
  const world = runtime.createWorld();
  for (const { min, max, noMove = false, noRay = false, surf = "concrete" } of data.world.colliders) {
    world.addCollider(...min, ...max, surf, { noMove, noRay });
  }

  const nav = runtime.createNav(world);
  for (const { pos } of data.world.nodes) nav.add(...pos);
  for (const node of nav.nodes) {
    for (const to of data.world.nodes[node.i].links) {
      const other = nav.nodes[to];
      node.links.push({ to, c: Math.hypot(node.x - other.x, node.y - other.y, node.z - other.z) });
    }
  }
  const reached = new Set([0]), queue = [0];
  for (const index of queue) {
    for (const { to } of nav.nodes[index].links) {
      if (!reached.has(to)) reached.add(to), queue.push(to);
    }
  }
  nav.islands = nav.nodes.filter(node => !reached.has(node.i)).map(node => node.i);

  const spawns = data.gameplay.spawns.map(({ pos: [x, y, z], yaw = 0, team: side }) => ({ x, y, z, yaw, side }));
  return { world, nav, spawns };
}

export async function prepareMap(gh, ref, { signal } = {}) {
  const runtime = gh.debug.mapRuntime;
  signal?.throwIfAborted();
  // The browser's hotel world is generated in the core with its original props,
  // breakable panes and navigation. Both supported hotel references use it.
  if (ref.id === "hotel" && [BUILTIN_HOTEL.version, "2"].includes(ref.version)) {
    return { ref, dispose: noop };
  }

  const data = await loadMapData(ref, { signal });
  if (data.manifest.clientScene !== "gltf") throw Error("Unsupported map scene");
  const { background, fogColor, fogDensity } = data.manifest.environment ?? {};
  if (![background, fogColor].every(value => /^[a-f0-9]{6}$/.test(value)) ||
      !Number.isFinite(fogDensity) || fogDensity < 0) throw Error("Invalid map environment");

  const bytes = await loadMapSceneBytes(data.manifest, { signal });
  const { world, nav, spawns } = buildWorld(runtime, data);
  const scene = await decodeMapScene(runtime.THREE, bytes, signal);
  return { ref, data, world, nav, spawns, scene, dispose: scene.dispose };
}

// Called between rounds by training or multiplayer. This preserves references
// held by physics, native operators, scene code and the network engine.
export function installMap(gh, prepared) {
  const { mapRuntime: runtime, ctx, world, nav, gfx, match, glass, physics, fx } = gh.debug;
  if (runtime.active) throw Error("Clear the installed map before changing maps");
  if (!prepared.scene) return noop;

  const { scene } = gfx, { THREE } = runtime;
  const { sun, root, indoor } = prepared.scene;
  const { background, fogColor, fogDensity } = prepared.data.manifest.environment;
  const hotel = ctx.hotel;
  glass.reset();
  physics.reset();
  fx.reset?.();

  const hotelWorld = { cols: world.cols, grid: world.grid };
  const hotelNav = { nodes: nav.nodes, islands: nav.islands };
  const hotelK9 = { nn: match.k9.nn, D: match.k9.D, NX: match.k9.NX };
  const hotelEnvironment = { background: scene.background, fog: scene.fog, environmentIntensity: scene.environmentIntensity };
  const hotelBehavior = { pool: hotel.pool, inPool: hotel.inPool, indoor: hotel.indoor, update: hotel.update, lights: hotel.lights, mapScene: hotel.mapScene };
  const hotelPanes = glass.panes, hotelBodies = physics.bodies, hotelProps = physics.props;
  const preRender = gfx.preRender, fxSun = fx.sun, updateSun = gfx.onQuality;
  let installed = true;

  function applyWorld(collision, routes) {
    world.cols = collision.cols;
    world.grid = collision.grid;
    world._q.length = world._rayQ.length = physics._cands.length = 0;
    world.groundCol = null;
    nav.nodes = routes.nodes;
    nav.islands = routes.islands;
  }

  function invalidateFrame() {
    gfx._reflectAt = null;
    gfx._shadowAt = 0;
    gfx._hasPrev = false;
    gfx.renderer.shadowMap.needsUpdate = true;
  }

  function clear() {
    if (!installed) return;
    installed = false;
    runtime.active = null;
    physics.reset();
    fx.reset?.();
    prepared.dispose();
    scene.add(...runtime.hotelRoots);
    applyWorld(hotelWorld, hotelNav);
    Object.assign(match.k9, hotelK9);
    Object.assign(scene, hotelEnvironment);
    Object.assign(hotel, hotelBehavior);
    glass.panes = hotelPanes;
    physics.bodies = hotelBodies;
    physics.props = hotelProps;
    gfx.preRender = preRender;
    gfx.onQuality = updateSun;
    fx.sun = fxSun;
    match.mapSpawns = null;
    ctx.hud.map.mapName = null;
    invalidateFrame();
    ctx.hud.map.build(world, hotel);
  }

  try {
    scene.remove(...runtime.hotelRoots);
    scene.add(root);
    scene.background = new THREE.Color("#" + background);
    scene.fog = new THREE.FogExp2("#" + fogColor, fogDensity);
    scene.environmentIntensity = 0;
    gfx.preRender = null;
    gfx.onQuality = quality => {
      updateSun?.(quality);
      if (!sun?.castShadow || sun.shadow.mapSize.x === quality.shadow) return;
      sun.shadow.mapSize.setScalar(quality.shadow);
      sun.shadow.dispose();
      sun.shadow.map = null;
    };
    gfx.onQuality(gfx.q);
    fx.sun = null;
    Object.assign(hotel, { pool: null, inPool: () => false, indoor: () => indoor, update: [], lights: {}, mapScene: prepared.scene });
    glass.panes = [];
    physics.bodies = [];
    physics.props = [];
    applyWorld(prepared.world, prepared.nav);
    // These imported graphs are much denser than the hotel's. K9 uses native
    // on-demand A* here, without building hotel-style all-pairs tables.
    Object.assign(match.k9, { nn: nav.nodes.length, D: null, NX: null });
    match.mapSpawns = prepared.spawns;
    ctx.hud.map.mapName = prepared.data.manifest.name;
    ctx.hud.map.build(world, hotel);
    invalidateFrame();
    runtime.active = prepared;
    return clear;
  } catch (error) {
    clear();
    throw error;
  }
}
