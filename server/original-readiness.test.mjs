import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { inspectOriginalReadiness } from "../scripts/check_original_readiness.mjs";

const tdm = { id: "tdm", name: "Teams", clientAdapter: "teams" };
const zombies = { id: "zombie-coop", name: "Co-op", clientAdapter: "zombies" };
const hotel = { id: "hotel", version: "2", clientScene: "hotel", name: "Hotel", modes: ["tdm"] };
const base = { defaultMap: "hotel", defaultMode: "tdm", maps: [hotel], modes: [tdm] };

function fixtureGlb() {
  const body = '{"asset":{"version":"2.0"}}';
  const json = Buffer.from(body.padEnd(Math.ceil(body.length / 4) * 4));
  const bytes = Buffer.alloc(20 + json.length);
  bytes.write("glTF", 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12);
  bytes.write("JSON", 16);
  json.copy(bytes, 20);
  return bytes;
}

const scene = fixtureGlb();
const descriptor = { bytes: scene.length, sha256: createHash("sha256").update(scene).digest("hex") };
const map = { id: "test-yard", version: "fixture-1", clientScene: "gltf", name: "Fixture",
  modes: ["zombie-coop"], sceneAsset: "assets/maps/test-yard/fixture-1/scene.glb",
  sceneBytes: descriptor.bytes, sceneSHA256: descriptor.sha256 };
const catalog = { ...base, maps: [hotel, map], modes: [tdm, zombies] };

test("readiness reports whether the original catalog advertises co-op without treating it as admission", async () => {
  const report = await inspectOriginalReadiness(base);
  assert.equal(report.cooperationStatus, "not-advertised");
  assert.deepEqual(report.cooperation, []);
  assert.equal(report.officialAdmission, "not-tested");
  assert.equal((await inspectOriginalReadiness(catalog)).cooperation[0].status, "asset-root-required");
  await assert.rejects(() => inspectOriginalReadiness({ ...catalog, defaultMap: "unknown" }));
});

test("readiness verifies the versioned map, P3 anchor and both LODs for all three actors", async t => {
  const root = await mkdtemp(join(tmpdir(), "gh-original-readiness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, dirname(map.sceneAsset));
  await mkdir(folder, { recursive: true });
  const missing = await inspectOriginalReadiness(catalog, root);
  assert.deepEqual(missing.cooperation[0].checks.map(check => check.status), ["missing", "missing", "missing"]);

  const mapData = { ...map, mapId: map.id, bounds: { minX: -10, minZ: -10, maxX: 10, maxZ: 10 },
    colliders: [{ min: [-1, 0, -1], max: [1, 0.1, 1], noMove: false, noRay: false }],
    nodes: [{ pos: [0, 0, 0], links: [1] }, { pos: [1, 0, 0], links: [0] }],
    anchors: { P3: [[0, 0, 0]] } };
  const actors = {};
  for (const kind of ["walker", "runner", "brute"]) {
    actors[kind] = {};
    for (const lod of [2, 3]) {
      const file = kind + "-lod" + lod + ".glb";
      actors[kind][lod] = { file, ...descriptor };
      await writeFile(join(folder, file), scene);
    }
  }
  await writeFile(join(folder, "scene.glb"), scene);
  await writeFile(join(folder, "map-data.json"), JSON.stringify(mapData));
  await writeFile(join(folder, "actors.json"), JSON.stringify(actors));

  const successful = (await inspectOriginalReadiness(catalog, root)).cooperation[0];
  assert.equal(successful.status, "assets-verified", JSON.stringify(successful.checks));
  assert.equal(successful.checks.length, 9);
  await writeFile(join(folder, "map-data.json"), JSON.stringify({ ...mapData, version: "fixture-2" }));
  const modifiedRig = Buffer.from(scene);
  modifiedRig[24] ^= 1;
  await writeFile(join(folder, "runner-lod2.glb"), modifiedRig);
  const mismatches = (await inspectOriginalReadiness(catalog, root)).cooperation[0];
  assert.equal(mismatches.status, "assets-incomplete");
  assert.deepEqual(mismatches.checks.filter(check => check.status === "invalid").map(check => check.reason), [
    "Map data does not match the catalog version or scene descriptor", "GLB size or SHA-256 does not match its manifest",
  ]);

  actors.walker[2].file = "../../../other.glb";
  await writeFile(join(folder, "actors.json"), JSON.stringify(actors));
  const rejected = (await inspectOriginalReadiness(catalog, root)).cooperation[0];
  assert.equal(rejected.checks.length, 3);
  assert.match(rejected.checks[2].reason, /Invalid actor descriptor/);
});
