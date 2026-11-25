export const COOP_MODE = "zombie-coop";
export const COOP_NAME = "前庭撤离 · 四人合作";

export function supportsCoop(config) {
  const modes = config?.communityModes;
  return modes?.protocol === 1 && Array.isArray(modes.modes) && modes.modes.includes(COOP_MODE);
}

export function coopStatus(state) {
  if (!state) return "";
  if (state.stage === "waiting") return `集结队伍 · ${state.connected}/${state.capacity} 席`;
  if (state.stage === "briefing") return "正在部署";
  if (state.stage === "wave") return `第 ${state.wave}/${state.waves} 波 · 剩余 ${state.infected} 名感染者`;
  if (state.stage === "regroup") return "本波清空 · 准备迎接下一波";
  if (state.stage === "extraction") return `全体幸存者前往前庭撤离点 · ${Math.round(state.hold * 100)}%`;
  return { extracted: "行动完成 · 已撤离", overrun: "行动失败 · 小队失守", timeout: "行动失败 · 撤离超时" }[state.result] || "行动结束";
}

// The community mode uses original procedural meshes and solid materials.
// Existing Three.js constructors and the existing hotel scene supply rendering.
export function installCoopPresentation(engine) {
  const { Group, Mesh, BoxGeometry, RingGeometry, MeshStandardMaterial, MeshBasicMaterial } = engine.debug.coopVisuals;
  const root = new Group();
  root.name = "community-coop";
  engine.debug.gfx.scene.add(root);
  const box = new BoxGeometry(1, 1, 1);
  const ring = new RingGeometry(0.95, 1, 32);
  const body = [0x506655, 0x986341, 0x684d42].map(color => new MeshStandardMaterial({ color, roughness: 0.84 }));
  const skin = new MeshStandardMaterial({ color: 0x9ca476, roughness: 0.90 });
  const markerMaterial = new MeshBasicMaterial({ color: 0x6affce, depthWrite: false });
  const marker = new Mesh(ring, markerMaterial);
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  root.add(marker);

  const panel = document.createElement("aside");
  panel.className = "community-coop-hud";
  panel.hidden = true;
  document.querySelector("#hud").append(panel);
  const actors = new Map();
  let lastTick = -1;

  function makeActor(kind) {
    const model = new Group();
    const part = (parent, material, x, y, z, w, h, d) => {
      const mesh = new Mesh(box, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      parent.add(mesh);
    };
    part(model, body[kind], 0, 1.02, 0, 0.48, 0.58, 0.3);
    part(model, skin, 0.04, 1.52, 0.03, 0.27, 0.32, 0.26);
    const limbs = [];
    for (const side of [-1, 1]) {
      const leg = new Group(), arm = new Group();
      leg.position.set(side * 0.13, 0.76, 0);
      arm.position.set(side * 0.30, 1.22, 0);
      part(leg, body[kind], 0, -0.36, 0, 0.18, 0.72, 0.19);
      part(arm, skin, 0, -0.25, 0, 0.14, 0.54, 0.16);
      model.add(leg, arm);
      limbs.push({ side, leg, arm });
    }
    if (kind === 2) model.scale.set(1.26, 1.12, 1.25);
    root.add(model);
    return { model, limbs };
  }

  function update(dt) {
    const state = engine.room?.modeState;
    const snap = engine.lastSnapshot;
    const playing = engine.gh.G.state === "playing" && snap?.phase === "live";
    panel.hidden = !playing || !state;
    if (!panel.hidden) {
      const label = coopStatus(state);
      if (panel.textContent !== label) panel.textContent = label;
    }
    marker.visible = playing && state?.stage === "extraction" && state.target?.length === 3 &&
      state.target.every(Number.isFinite) && Number.isFinite(state.radius) && state.radius > 0;
    if (marker.visible) {
      marker.position.set(state.target[0], state.target[1] + 0.035, state.target[2]);
      marker.scale.setScalar(state.radius);
    }
    if (snap && lastTick !== snap.tick) {
      lastTick = snap.tick;
      const current = new Set();
      for (const record of snap.zombies || []) {
        current.add(record.id);
        let actor = actors.get(record.id);
        if (!actor) {
          actor = makeActor(record.kind);
          actor.model.position.set(record.x, record.y, record.z);
          actors.set(record.id, actor);
        }
        actor.record = record;
      }
      for (const [id, actor] of actors) {
        if (current.has(id)) continue;
        actor.model.removeFromParent();
        actors.delete(id);
      }
    }
    const blend = Math.min(1, 14 * dt);
    for (const { model, record, limbs } of actors.values()) {
      model.position.x += (record.x - model.position.x) * blend;
      model.position.y += (record.y - model.position.y) * blend;
      model.position.z += (record.z - model.position.z) * blend;
      model.rotation.y = record.yaw;
      const gait = record.moving ? Math.sin(performance.now() / 85 + record.id % 11) : 0;
      for (const { side, leg, arm } of limbs) {
        leg.rotation.x = side * gait * 0.47;
        arm.rotation.x = record.attacking ? -1.42 : side * -gait * 0.46 - 0.2;
      }
    }
  }

  engine.modeFrame = update;
  return () => {
    engine.modeFrame = null;
    root.removeFromParent();
    panel.remove();
    for (const resource of [box, ring, skin, markerMaterial, ...body]) resource.dispose();
  };
}
