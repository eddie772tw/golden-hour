const base = new URL("../../assets/maps/", import.meta.url);
export const BUILTIN_HOTEL = Object.freeze({ id: "hotel", version: "builtin" });

const sameMap = (a, b) => a.id === b.id && a.version === b.version;

function verifyRef(ref) {
  if (typeof ref?.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ref.id) ||
      typeof ref.version !== "string" || !/^\d+$/.test(ref.version)) {
    throw Error("Invalid map ID or version");
  }
}

function mapURL(ref, name) {
  verifyRef(ref);
  return new URL(ref.id + "/" + ref.version + "/" + name, base);
}

async function read(url, signal, optional = false) {
  const response = await fetch(url, { signal, redirect: "error" });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw Error("Map asset " + url.pathname + " returned HTTP " + response.status);
  return response;
}

export async function loadMapCatalog({ signal } = {}) {
  const response = await read(new URL("catalog.json", base), signal, true);
  if (!response) return { schema: 1, defaultMap: "hotel", defaultMode: "tdm", maps: [BUILTIN_HOTEL] };
  const catalog = await response.json();
  if (catalog?.schema !== 1 || catalog.defaultMap !== "hotel" || catalog.defaultMode !== "tdm" ||
      !Array.isArray(catalog.maps) || !catalog.maps.some(map => map?.id === "hotel")) {
    throw Error("Invalid training map catalog");
  }
  const ids = new Set();
  for (const ref of catalog.maps) {
    verifyRef(ref);
    if (ids.has(ref.id)) throw Error("Duplicate map in catalog");
    ids.add(ref.id);
  }
  return catalog;
}

const vector = value => Array.isArray(value) && value.length === 3 &&
  value.every(number => Number.isFinite(number) && Math.abs(number) < 2000);

function verifyWorld(world, gameplay) {
  if (!Array.isArray(world?.colliders) || !world.colliders.length ||
      !world.colliders.every(({ min, max, noMove, noRay }) =>
        vector(min) && vector(max) && min.every((value, axis) => value < max[axis]) &&
        [noMove, noRay].every(flag => flag === undefined || typeof flag === "boolean"))) {
    throw Error("Invalid map collision data");
  }
  if (!Array.isArray(world.nodes) || !world.nodes.length || world.nodes.length > 32767 ||
      !world.nodes.every(({ pos, links }, index) => vector(pos) && Array.isArray(links) &&
        links.every(to => Number.isInteger(to) && to >= 0 && to < world.nodes.length && to !== index))) {
    throw Error("Invalid map navigation data");
  }
  if (!Array.isArray(gameplay?.spawns) ||
      !gameplay.spawns.every(({ pos, yaw, team }) => vector(pos) &&
        (yaw === undefined || Number.isFinite(yaw)) && (team === 0 || team === 1)) ||
      ![0, 1].every(team => gameplay.spawns.some(spawn => spawn.team === team))) {
    throw Error("Invalid map spawn data");
  }
}

export async function loadMapData(ref, { signal } = {}) {
  signal?.throwIfAborted();
  if (sameMap(ref, BUILTIN_HOTEL)) {
    return { manifest: { schema: 1, ...BUILTIN_HOTEL, name: "暮色酒店", clientScene: "hotel" }, world: null, gameplay: null };
  }
  const manifest = await (await read(mapURL(ref, "manifest.json"), signal)).json();
  if (manifest?.schema !== 1 || !sameMap(manifest, ref) || typeof manifest.name !== "string" ||
      manifest.worldAsset !== "world.json" || manifest.gameplayAsset !== "gameplay.json" ||
      (manifest.id === "hotel" ? manifest.clientScene !== "hotel" : manifest.clientScene !== "gltf")) {
    throw Error("Invalid map manifest");
  }
  const [world, gameplay] = await Promise.all(["world.json", "gameplay.json"].map(async name =>
    (await read(mapURL(ref, name), signal)).json()));
  signal?.throwIfAborted();
  verifyWorld(world, gameplay);
  return { manifest, world, gameplay };
}

export async function loadMapSceneBytes(manifest, { signal } = {}) {
  const expectedPath = "assets/maps/" + manifest.id + "/" + manifest.version + "/scene.glb";
  if (manifest.sceneAsset !== expectedPath || !/^[a-f0-9]{64}$/.test(manifest.sceneSHA256) ||
      !Number.isSafeInteger(manifest.sceneBytes) || manifest.sceneBytes <= 0) {
    throw Error("Invalid map scene manifest");
  }
  const response = await read(mapURL(manifest, "scene.glb"), signal);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== manifest.sceneBytes) throw Error("Map scene length differs from manifest");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  signal?.throwIfAborted();
  const hex = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== manifest.sceneSHA256) throw Error("Map scene SHA-256 differs from manifest");
  return bytes;
}
