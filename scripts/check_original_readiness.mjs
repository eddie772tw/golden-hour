import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ORIGINAL_V60115_ORIGIN, originalV60115Catalog } from "../game/client/original-v60115.js";

const modeId = "zombie-coop";
const rigKinds = ["walker", "runner", "brute"];
const lods = [2, 3];
const jsonLimit = 65536;
const mapDataLimit = 8 * 1024 * 1024;
const sha256 = /^[a-f0-9]{64}$/;
const vector = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

async function readBounded(path, maxBytes) {
  const file = await open(path);
  try {
    const info = await file.stat();
    const { size } = info;
    if (!info.isFile() || size > maxBytes)
      throw Error("Expected a regular file of at most " + maxBytes + " bytes");
    const bytes = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== size) throw Error("File changed while reading");
    return bytes.subarray(0, size);
  } finally {
    await file.close();
  }
}

async function publicJSON(path) {
  const response = await fetch(new URL(path, ORIGINAL_V60115_ORIGIN), {
    credentials: "omit", redirect: "error", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error(path + " returned HTTP " + response.status);
  if (!response.headers.get("content-type")?.startsWith("application/json"))
    throw Error(path + " did not return JSON");
  const parts = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > jsonLimit) throw Error(path + " exceeded the JSON size limit");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

function verifyMapData(data, map) {
  if (!data || data.mapId !== map.id ||
      !["version", "clientScene", "sceneAsset", "sceneBytes", "sceneSHA256"].every(key => data[key] === map[key]))
    throw Error("Map data does not match the catalog version or scene descriptor");
  const { minX, maxX, minZ, maxZ } = data.bounds ?? {};
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ)
    throw Error("Missing or invalid map bounds");
  if (!Array.isArray(data.colliders) || !data.colliders.length || data.colliders.length > 20000 ||
      !data.colliders.every(box => vector(box?.min) && vector(box.max) &&
        box.min.every((value, axis) => value <= box.max[axis]) &&
        typeof box.noMove === "boolean" && typeof box.noRay === "boolean"))
    throw Error("Missing or invalid map colliders");
  if (!Array.isArray(data.nodes) || !data.nodes.length || data.nodes.length > 10000 ||
      !data.nodes.every((node, index) => vector(node?.pos) && Array.isArray(node.links) &&
        node.links.every(link => Number.isInteger(link) && link >= 0 && link < data.nodes.length && link !== index)))
    throw Error("Missing or invalid navigation nodes");
  const extraction = data.anchors?.P3?.[0];
  if (!vector(Array.isArray(extraction) ? extraction : [extraction?.x, extraction?.y, extraction?.z]))
    throw Error("Missing or invalid P3 extraction anchor");
}

async function verifyGlb(path, size, digest) {
  const bytes = await readBounded(path, size);
  if (bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== digest)
    throw Error("GLB size or SHA-256 does not match its manifest");
  const jsonBytes = bytes.readUInt32LE(12);
  if (bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== size || jsonBytes < 4 || jsonBytes % 4 || 20 + jsonBytes > size ||
      bytes.toString("ascii", 16, 20) !== "JSON")
    throw Error("Invalid GLB v2 header or JSON chunk");
  const document = JSON.parse(bytes.toString("utf8", 20, 20 + jsonBytes));
  if (document?.asset?.version !== "2.0") throw Error("Missing glTF 2.0 asset metadata");
  if ([...(document.buffers ?? []), ...(document.images ?? [])].some(item =>
    item?.uri !== undefined && (typeof item.uri !== "string" || !item.uri.startsWith("data:"))))
    throw Error("GLB references external buffers or images");
}

async function inspectAssets(map, assetRoot) {
  const directory = map.sceneAsset.slice(0, map.sceneAsset.lastIndexOf("/"));
  const checks = [];
  async function check(file, verify) {
    try {
      await verify(join(assetRoot, ...file.split("/")));
      checks.push({ file, status: "verified" });
    } catch (error) {
      checks.push({ file, status: error.code === "ENOENT" ? "missing" : "invalid",
        ...(!error.code && { reason: error.message }) });
    }
  }
  await check(map.sceneAsset, path => verifyGlb(path, map.sceneBytes, map.sceneSHA256));
  await check(directory + "/map-data.json", async path => {
    verifyMapData(JSON.parse(await readBounded(path, mapDataLimit)), map);
  });
  let actors;
  await check(directory + "/actors.json", async path => {
    const manifest = JSON.parse(await readBounded(path, jsonLimit));
    for (const kind of rigKinds) for (const lod of lods) {
      const rig = manifest?.[kind]?.[lod];
      if (rig?.file !== kind + "-lod" + lod + ".glb" || !Number.isSafeInteger(rig.bytes) ||
          rig.bytes < 20 || rig.bytes > 2000000 || !sha256.test(rig.sha256 ?? ""))
        throw Error("Invalid actor descriptor for " + kind + " LOD " + lod);
    }
    actors = manifest;
  });
  if (actors) for (const kind of rigKinds) for (const lod of lods) {
    const { file, bytes, sha256: digest } = actors[kind][lod];
    await check(directory + "/" + file, path => verifyGlb(path, bytes, digest));
  }
  return checks;
}

export async function inspectOriginalReadiness(catalog, assetRoot) {
  const { maps, modes } = originalV60115Catalog(catalog);
  const adapter = modes.find(mode => mode.id === modeId)?.clientAdapter;
  const catalogMaps = maps.map(({ id, version, modes }) => ({ id, version, modes }));
  const cooperation = [];
  for (const map of maps.filter(entry => entry.modes.includes(modeId))) {
    const unsupported = adapter !== "zombies" || map.clientScene !== "gltf";
    const checks = unsupported || !assetRoot ? [] : await inspectAssets(map, assetRoot);
    const status = unsupported ? "unsupported-adapter" : !assetRoot ? "asset-root-required" :
      checks.every(check => check.status === "verified") ? "assets-verified" : "assets-incomplete";
    cooperation.push({ id: map.id, version: map.version, status, checks });
  }
  return { catalogMaps, cooperationStatus: cooperation.length ? "advertised" : "not-advertised",
    cooperation, officialAdmission: "not-tested" };
}

async function main() {
  const { values } = parseArgs({ options: { catalog: { type: "string" }, "assets-root": { type: "string" } } });
  let catalog, transport;
  if (values.catalog) {
    catalog = JSON.parse(await readBounded(values.catalog, jsonLimit));
  } else {
    const [config, liveCatalog] = await Promise.all([publicJSON("/api/config"), publicJSON("/api/catalog")]);
    if (config?.protocol !== 1) throw Error("Unsupported v60115 protocol");
    catalog = liveCatalog;
    transport = { protocol: config.protocol, preferredTransport: config.preferredTransport,
      webrtcAdvertised: typeof config.rtc?.url === "string" && config.rtc.url.length > 0,
      websocketAdvertised: config.websocket === true };
  }
  const report = await inspectOriginalReadiness(catalog, values["assets-root"]);
  console.log(JSON.stringify({ source: values.catalog ? "local-catalog" : "official-public-get",
    ...(transport && { transport }), ...report }, null, 2));
  if (!report.cooperation.length || report.cooperation.some(map => map.status !== "assets-verified"))
    process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
