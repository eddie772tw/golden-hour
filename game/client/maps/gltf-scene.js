// The MIT-licensed Three.js adjuncts use the renderer's existing Three.js instance.
export async function decodeMapScene(THREE, bytes, signal) {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import("./vendor/GLTFLoader.js"),
    import("./vendor/meshopt_decoder.module.js"),
  ]);
  signal?.throwIfAborted();
  const manager = new THREE.LoadingManager();
  const blobURLs = new Set();
  manager.setURLModifier(url => {
    if (!url.startsWith("blob:")) throw Error("Expected an embedded map texture");
    blobURLs.add(url);
    return url;
  });
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  let gltf;
  try {
    gltf = await loader.parseAsync(bytes, "");
    signal?.throwIfAborted();
    return configureScene(THREE, gltf);
  } catch (error) {
    if (gltf) disposeScene(gltf.scenes);
    throw error;
  } finally {
    // Also release any temporary URLs the decoder did not reach on a failed load.
    for (const url of blobURLs) URL.revokeObjectURL(url);
  }
}

function applyProperties(target, extras, keys) {
  for (const key of keys) {
    if (Object.hasOwn(extras, key)) target[key] = extras[key];
  }
}

function configureScene(THREE, gltf) {
  const root = gltf.scene;
  const { ghHemisphere, ghLighting, ghEnvironment } = root.userData;
  const nodeProps = ["castShadow", "receiveShadow", "frustumCulled", "renderOrder"];
  const materialProps = ["depthWrite", "fog", "toneMapped", "allowOverride", "shadowSide",
    "polygonOffset", "polygonOffsetFactor", "polygonOffsetUnits"];
  const seen = new Set();

  function configure(node, inherited = {}) {
    const render = { ...inherited, ...node.userData.ghRender };
    applyProperties(node, render, nodeProps);
    for (const material of [].concat(node.material ?? [])) {
      if (!seen.has(material)) {
        seen.add(material);
        applyProperties(material, material.userData.ghRender ?? {}, materialProps);
      }
      if (material.transparent || !material.depthWrite) node.layers.set(1);
    }
    for (const child of node.children) configure(child, render);
  }
  configure(root);
  if (ghHemisphere) {
    const sky = new THREE.Color().fromArray(ghHemisphere.sky);
    const ground = new THREE.Color().fromArray(ghHemisphere.ground);
    root.add(new THREE.HemisphereLight(sky, ground, ghHemisphere.intensity));
  }
  const sun = ghLighting?.sun && root.getObjectByName(ghLighting.sun);
  if (sun?.isDirectionalLight && sun.castShadow) {
    const camera = sun.shadow.camera;
    Object.assign(camera, { left: -28, right: 28, bottom: -28, top: 28, far: 130 });
    camera.updateProjectionMatrix();
    sun.shadow.normalBias = 0.025;
  }
  const mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
  for (const clip of gltf.animations) mixer.clipAction(clip).play();
  const scenes = gltf.scenes;
  let disposed = false;
  return {
    root,
    indoor: ghEnvironment === "outdoor" ? 0 : 1,
    sun,
    update: delta => mixer?.update(delta),
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer?.stopAllAction();
      mixer?.uncacheRoot(root);
      disposeScene(scenes);
    },
  };
}

function disposeScene(scenes) {
  const materials = new Set(), geometries = new Set(), textures = new Set(), images = new Set();
  for (const scene of scenes) {
    scene.removeFromParent();
    scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [].concat(object.material ?? [])) materials.add(material);
      object.shadow?.dispose();
    });
  }
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) {
    if (typeof texture.image?.close === "function") images.add(texture.image);
    texture.dispose();
  }
  for (const image of images) image.close();
}
