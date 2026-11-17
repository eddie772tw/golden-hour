// These static glTF 2 models use packed float attributes, 16-bit indices,
// embedded PNGs and translation-only nodes. Reuse the game's Three.js runtime.
import { models, shopWeaponsEnabled } from "./weapon-models.js";

const assets = new Map();
const keyFor = (id, detail) => id + (detail === "view" ? "" : "_world_lod");

async function loadAsset(key) {
  const url = new URL("../assets/shop-weapons/" + key + ".glb", import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw Error("Weapon art " + key + ": HTTP " + response.status);
  const bytes = await response.arrayBuffer(), header = new DataView(bytes);
  const jsonLength = header.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)));
  const bin = 28 + jsonLength;
  const images = await Promise.all(doc.images.map(async image => {
    const view = doc.bufferViews[image.bufferView];
    const data = new Uint8Array(bytes, bin + (view.byteOffset || 0), view.byteLength);
    return createImageBitmap(new Blob([data], { type: image.mimeType }), { colorSpaceConversion: "none" });
  }));
  assets.set(key, { doc, bytes, bin, images });
}

export function loadShopWeaponArt() {
  if (!shopWeaponsEnabled) return Promise.resolve();
  return Promise.all(Object.keys(models).flatMap(id =>
    ["view", "world"].map(detail => loadAsset(keyFor(id, detail)).catch(error => console.error(error)))));
}

function buildTemplate(T, asset) {
  const { doc, bytes, bin, images } = asset;
  function attribute(index) {
    const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
    const Type = { 5126: Float32Array, 5123: Uint16Array }[a.componentType];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
    return new T.BufferAttribute(new Type(bytes, bin + (view.byteOffset || 0) + (a.byteOffset || 0), a.count * size), size);
  }
  const textures = doc.textures.map(({ source }) => {
    const texture = new T.Texture(images[source]);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.flipY = false;
    texture.needsUpdate = true;
    return texture;
  });
  const materials = doc.materials.map(m => {
    const p = m.pbrMetallicRoughness, material = new T.MeshStandardMaterial({
      color: new T.Color().fromArray(p.baseColorFactor ?? [1,1,1]),
      metalness: p.metallicFactor ?? 1, roughness: p.roughnessFactor ?? 1,
      side: m.doubleSided ? T.DoubleSide : T.FrontSide,
    });
    material.name = m.name;
    if (p.baseColorTexture) {
      material.map = textures[p.baseColorTexture.index];
      material.map.colorSpace = T.SRGBColorSpace;
    }
    if (m.normalTexture) {
      material.normalMap = textures[m.normalTexture.index];
      material.normalScale.setScalar(m.normalTexture.scale ?? 1);
    }
    return material;
  });
  const root = new T.Group(), sockets = {};
  for (const node of doc.nodes) {
    const position = new T.Vector3().fromArray(node.translation ?? [0,0,0]);
    if (node.name.endsWith("VisualSocket")) sockets[node.name] = position;
    if (node.mesh === undefined) continue;
    for (const part of doc.meshes[node.mesh].primitives) {
      const geometry = new T.BufferGeometry();
      const attrs = { POSITION: "position", NORMAL: "normal", TEXCOORD_0: "uv", TEXCOORD_1: "uv1" };
      for (const [name, index] of Object.entries(part.attributes)) geometry.setAttribute(attrs[name], attribute(index));
      geometry.setIndex(attribute(part.indices));
      const mesh = new T.Mesh(geometry, materials[part.material]);
      mesh.name = node.name;
      if (node.extras?.removableIrons) mesh.userData.removableIrons = true;
      mesh.position.copy(position);
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    }
  }
  return { root, sockets };
}

// Golden Hour's authored palm contact centres, in metres in gun space.
// The wrist pivots sit outside those centres and retain their native offsets.
const grips = {
  gbull:  { fire: [0,-0.037,0.012], sightHeight: 0.034 },
  chingi: { fire: [0,-0.045,0.012], support: [0,0.010,-0.229], eyeRelief: 0.255 },
  linbei: { fire: [0,-0.022,0.028], support: [0,-0.012,-0.375], eyeRelief: 0.26 },
};

export function mountShopWeapon(T, gun, id, detail) {
  if (!shopWeaponsEnabled || !Object.hasOwn(models, id)) return;
  const key = keyFor(id, detail), asset = assets.get(key);
  if (!asset) return;
  const { root, sockets } = asset.template ??= buildTemplate(T, asset);
  const body = root.clone();
  body.name = key;
  body.position.fromArray(grips[id].fire).sub(sockets.GripVisualSocket);
  const socket = name => sockets[name].clone().add(body.position);
  const keep = new Set();
  for (const part of [...Object.values(gun.hands ?? {}), ...Object.values(gun.mounts ?? {}),
        gun.parts?.frag, gun.parts?.shell, gun.parts?.hull, gun.parts?.liftShell]) {
    part?.traverse?.(obj => keep.add(obj));
  }
  // Keep the native clip controllers and rig hierarchy. Remove only their gun
  // surfaces, including meshes that a reload clip might make visible again.
  const magazine = new Set();
  gun.parts?.mag?.traverse(obj => magazine.add(obj));
  const remove = [];
  gun.root.traverse(obj => { if (obj.isMesh && !keep.has(obj)) remove.push(obj); });
  for (const mesh of remove) {
    // The native ejected-magazine factory still reads these meshes.
    if (mesh.children.length || magazine.has(mesh)) mesh.layers.disableAll();
    else mesh.removeFromParent();
  }
  gun.root.add(body);
  gun.anchors.eject.copy(socket("EjectVisualSocket"));
  if (!gun.build?.optic || gun.build.optic === "irons") {
    if (sockets.AimVisualSocket) {
      gun.anchors.sight.copy(socket("AimVisualSocket"));
      gun.anchors.frontSight = socket("FrontSightVisualSocket");
      gun.adsDist = grips[id].eyeRelief;
    } else gun.anchors.sight.y = body.position.y + grips[id].sightHeight;
  } else {
    for (const part of body.children) if (part.userData.removableIrons) part.visible = false;
  }
  const muzzle = socket("MuzzleVisualSocket");
  if (gun.mounts?.muzzle?.children.length) {
    const offset = muzzle.clone().sub(gun.mounts.muzzle.position);
    gun.mounts.muzzle.position.add(offset);
    gun.anchors.muzzle.add(offset);
  } else gun.anchors.muzzle.copy(muzzle);
  if (grips[id].support) {
    const delta = socket("SupportGripVisualSocket").sub(new T.Vector3().fromArray(grips[id].support));
    gun.anchors.gripL.position.add(delta);
    const pose = gun.grips?.support ?? gun.grips?.pump;
    if (pose) {
      pose.pos.add(delta);
      gun.arms.setRest("L", pose.pos, pose.quat, pose.pose);
    }
  }
}
