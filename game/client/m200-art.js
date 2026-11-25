import { M200_ACTION, M200_RELOAD, m200Enabled } from "./m200.js";
import { loadWeaponGLB, weaponGLBTemplate } from "./shop-weapon-art.js";

const url = new URL("../assets/upstream-weapons/v60115/m200.glb", import.meta.url);
const slots = { Optic: "optic", Muzzle: "muzzle", Bipod: "underbarrel", Magazine: "magazine", Stock: "stock" };
const optics = { m200prism: [.1025, -.068, .126], m200long: [.1201, -.15, .23] };
let asset;

export async function loadM200Art() {
  if (!m200Enabled) return false;
  try {
    asset = await loadWeaponGLB(url, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

function tuneMotion(gun, bolt) {
  const resetPose = gun.resetPose;
  const home = bolt?.position.clone();
  function resetBolt() {
    if (!bolt) return;
    bolt.position.copy(home);
    bolt.rotation.z = 0;
  }
  gun.resetPose = () => { resetPose(); resetBolt(); };
  gun.clips = { ...gun.clips };
  for (const name of ["reload", "reloadEmpty"]) {
    const clip = gun.clips[name];
    const scale = M200_RELOAD / clip.duration;
    gun.clips[name] = {
      ...clip, duration: M200_RELOAD,
      events: clip.events.map(event => ({ ...event, t: event.type === "ammo" ? M200_RELOAD : event.t * scale })),
      apply(time, pose) { resetBolt(); clip.apply(time / scale, pose); },
    };
  }
  const fire = gun.clips.fire;
  const rise = (t, start, end) => Math.min(1, Math.max(0, (t - start) / (end - start)));
  gun.clips.fire = {
    ...fire, duration: M200_ACTION,
    apply(time, pose) {
      fire.apply(Math.min(time, fire.duration), pose);
      resetBolt();
      if (!bolt) return;
      bolt.rotation.z += .82 * (rise(time, .14, .28) - rise(time, .92, 1.10));
      bolt.position.z += .075 * (rise(time, .27, .46) - rise(time, .70, .94));
    },
  };
}

export function mountM200(T, gun, detail, build = {}) {
  if (!asset) {
    if (detail === "view") tuneMotion(gun);
    return;
  }
  const [factory, variants] = asset.template ??= weaponGLBTemplate(T, asset, { scenes: true });
  const rifle = factory.getObjectByName("M200_Intervention").clone(false);
  rifle.name = "M200 Intervention";
  for (const part of factory.getObjectByName("M200_Intervention").children) {
    const choice = variants.getObjectByName(build[slots[part.name]]) ?? part;
    const copy = choice.clone(true);
    copy.name = part.name;
    rifle.add(copy);
  }
  const keep = new Set();
  for (const part of [...Object.values(gun.hands ?? {}), gun.parts?.frag, gun.parts?.mag]) {
    part?.traverse(node => keep.add(node));
  }
  gun.root.traverse(node => {
    if (node.isMesh && !keep.has(node)) node.layers.disableAll();
  });
  gun.root.add(rifle);
  const magazine = rifle.getObjectByName("Magazine");
  if (gun.parts?.mag && magazine) {
    gun.parts.mag.clear();
    gun.parts.mag.attach(magazine);
  }
  const [height, sight, eye] = optics[build.optic] ?? [.1113, -.13, .23];
  const muzzle = { m200quiet: -.945, m200brake: -.86 }[build.muzzle] ?? -.84;
  gun.anchors.muzzle.set(0, .04, muzzle);
  gun.anchors.sight.set(0, height, sight);
  gun.anchors.frontSight = null;
  gun.anchors.eye?.set(0, height, eye);
  gun.anchors.eject?.set(.037, .044, -.02);
  gun.anchors.gripR?.position.set(.014, -.044, .13);
  gun.anchors.gripL?.position.set(-.023, -.022, -.26);
  gun.hip?.pos.set(.10, -.16, -.32);
  gun.adsDist = .08;
  if (detail === "view") tuneMotion(gun, rifle.getObjectByName("Bolt"));
}
