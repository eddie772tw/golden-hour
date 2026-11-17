// Candidate-only preparation. No factories, spawn/update calls or buffer writes.
export function preparedProgramsReady(properties) {
  const programs = properties?.programs?.values?.() ?? [];
  let seen = false;
  for (const program of programs) {
    seen = true;
    if (!program.isReady()) return false;
  }
  if (seen) return true;
  if (!properties?.currentProgram) throw Error("Missing shader program during preparation");
  return properties.currentProgram.isReady();
}

export function retainedProgramCompletion(renderer) {
  const programs = renderer.info.programs || [];
  let complete = 0;
  for (const program of programs) if (program.isReady()) complete++;
  return { retained: programs.length, complete, allComplete: programs.length > 0 && complete === programs.length,
    completionOnly: true }; // Shader completion, not link validity or every driver specialization.
}

export function prepareWarmDrawCoverage(pools) {
  const restoreFields = [], saved = new Map(), rows = [];
  let restored = false;
  function set(object, key, value) {
    let keys = saved.get(object);
    if (!keys) saved.set(object, keys = new Set());
    if (!keys.has(key)) {
      keys.add(key);
      restoreFields.push([object, key, Object.getOwnPropertyDescriptor(object, key)]);
    }
    object[key] = value;
  }
  function restore() {
    if (restored) return;
    restored = true;
    for (let i = restoreFields.length - 1; i >= 0; i--) {
      const [object, key, descriptor] = restoreFields[i];
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else delete object[key];
    }
  }
  try {
    for (const { label, mesh, scene } of pools) {
      const geometry = mesh?.geometry;
      if (!mesh?.isMesh || mesh.castShadow !== false || !mesh.material?.isShaderMaterial || !scene?.isScene || !geometry?.isInstancedBufferGeometry ||
          !Number.isInteger(geometry.instanceCount) || geometry.instanceCount < 0)
        throw Error("Unrecognized dormant draw: " + label);
      let capacity = Infinity;
      for (const attribute of Object.values(geometry.attributes)) {
        const buffer = attribute.isInstancedBufferAttribute ? attribute :
          attribute.data?.isInstancedInterleavedBuffer ? attribute.data : null;
        if (buffer) capacity = Math.min(capacity, buffer.count * buffer.meshPerAttribute);
      }
      if (!Number.isInteger(capacity) || capacity < 1 || geometry.instanceCount > capacity)
        throw Error("Invalid instance capacity: " + label);
      const ancestors = [];
      let object = mesh;
      for (; object && object !== scene && ancestors.length < 64; object = object.parent) ancestors.push(object);
      if (object !== scene) throw Error("Detached dormant draw: " + label);
      rows.push({ label, before: geometry.instanceCount, warm: Math.max(1, geometry.instanceCount), capacity });
      if (geometry.instanceCount === 0) set(geometry, "instanceCount", 1);
      for (const ancestor of ancestors) set(ancestor, "visible", true);
      set(mesh, "frustumCulled", false);
    }
    return { rows, restore };
  } catch (error) {
    restore();
    throw error;
  }
}
