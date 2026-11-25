import { weaponDefinition, selectedModel, familyOf, weaponName } from "./weapon-models.js";
import { loadShopWeaponArt, mountShopWeapon } from "./shop-weapon-art.js";
import { configureM200, installM200Handling, m200Enabled } from "./m200.js";
import { loadM200Art, mountM200 } from "./m200-art.js";
const m200ArtReady = loadM200Art();
const weaponArtReady = Promise.all([loadShopWeaponArt(), m200ArtReady]);
import "../i18n/dom.js";
import "./touch-controls.js";
import { installDesktopInput } from "./desktop-input.js";
import { installRuntimeDiagnostics } from "./runtime-diagnostics.js";
import { createRenderPreparation, finishShaderJobs, waitForDraw } from "./render-preparation.js";
import { prepareWarmDrawCoverage, preparedProgramsReady, retainedProgramCompletion } from "./shader-warmup.js";
import {
  createWebGLContext,
  installWebGLRecovery,
} from "./webgl-context.js";

import {
  readCache,
  writeMaterialsCache,
  restoreMaterials,
  hydrateArmoury,
} from "./startup-cache.js";
import { startupPolicy, textureSize, limitTextureData } from "./performance-policy.js";
import { decodeOperators, restoreOperator, hydrateGrips } from "./startup-geometry.js";

const base = new URL("../", import.meta.url);
const version = document.documentElement.dataset.bundle || "development";
const params = new URLSearchParams(location.search);
const baking = params.has("bake");
const shaderWarmupCandidate = params.get("shaderWarmup") === "1" || globalThis.__GH_SHADER_WARMUP_CANDIDATE === true;
const workerDecode = !baking && params.get("operatorDecode") === "worker";
const operatorAbort = workerDecode ? new AbortController() : null;
const policy = startupPolicy({
  coarse: matchMedia("(pointer: coarse)").matches,
  mobile: navigator.userAgentData?.mobile,
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints,
});
globalThis.GHDiagnostics = installRuntimeDiagnostics({ version, profile: policy.mobile ? "mobile" : "desktop" });
// Mobile textures have their own key and a smaller read/write budget; never
// deserialize the desktop's 154 MiB pixel pack into a phone's memory.
const key = `materials-v2:${policy.mobile ? "mobile" : "desktop"}:${version}`;
const shaderJobs = [];
let resolveRuntime, rejectRuntime;
const runtimeReady = new Promise((resolve, reject) => {
  resolveRuntime = resolve;
  rejectRuntime = reject;
});
runtimeReady.catch(() => {});
const stats = {
  version,
  materials: "miss",
  resourceProfile: policy.mobile ? "mobile" : "desktop",
  armoury: "fallback",
  operators: "fallback",
  cacheReadMs: 0,
  shaderJobs: 0,
  shaderErrors: 0,
  shaderWarmupCandidate,
};
const start = performance.now();
const boot = (globalThis.GHBoot = {
  weaponDefinition, selectedModel, familyOf, weaponName, mountShopWeapon,
  configureM200, mountM200, installM200Handling, m200Enabled, m200ArtReady,
  stats,
  runtimeReady,
  createRenderPreparation,
  waitForDraw,
  shaderWarmupCandidate, prepareWarmDrawCoverage, preparedProgramsReady, retainedProgramCompletion,
  shaderWarmupStatus() {
    const preparation = globalThis.GH?.debug?.gfx?.preparation;
    return {
      enabled: shaderWarmupCandidate,
      rendererReady: !!globalThis.GH?.ready && !!preparation && !preparation.pending && !preparation.error,
      pending: preparation?.pending ?? true,
      error: preparation?.error?.message || null,
      shaderJobs: stats.shaderJobs, shaderErrors: stats.shaderErrors,
      lastPreparation: stats.preparation || null,
      history: stats.shaderWarmupHistory || [],
    };
  },
  createWebGLContext,
  policy,
  limitTextureData(data, width, height) {
    return limitTextureData(data, width, height, policy.textureLimit);
  },
  limitTextureCanvas(canvas) {
    if (!canvas?.width || !canvas.height ||
        Math.max(canvas.width, canvas.height) <= policy.textureLimit) return canvas;
    const [width, height] = textureSize(canvas.width, canvas.height, policy.textureLimit);
    const reduced = document.createElement("canvas");
    reduced.width = width;
    reduced.height = height;
    reduced.getContext("2d").drawImage(canvas, 0, 0, width, height);
    return reduced;
  },
  materials: null,
  armoury: null,
  operators: null,
  restoreActorTexture(name, create) {
    if (!this.actorTextures && this.actorMaterialPack) {
      try {
        this.actorTextures = restoreMaterials(this.actorMaterialPack, create, 8);
        stats.actorTextures = "prebaked";
      } catch { this.actorTextures = null; }
      this.actorMaterialPack = null;
    }
    return this.actorTextures?.[name] || null;
  },
  hydrateGrips(kind, gun, vector, quaternion) {
    try {
      const hit = hydrateGrips(kind, gun, this.grips, vector, quaternion);
      if (hit) stats.gripsRestored = (stats.gripsRestored || 0) + 1;
      return hit;
    } catch { return false; }
  },
  async prepareOperators() {
    // A slow optional download must not stall the procedural startup path.
    const start = performance.now();
    let timer;
    try {
      await Promise.race([operatorJob, new Promise(resolve => {
        timer = setTimeout(() => {
          operatorAbort?.abort(new Error("Operator build stage deadline"));
          resolve();
        }, 75);
      })]);
    } finally {
      clearTimeout(timer);
      stats.operatorStageWaitMs = performance.now() - start;
    }
  },
  restoreOperator(team, createGeometry, createAttribute) {
    const record = this.operators?.[team];
    if (!record) return null;
    const geometry = restoreOperator(record, createGeometry, createAttribute);
    this.operators[team] = null;
    stats.operators = "prebaked";
    stats.operatorsRestored = (stats.operatorsRestored || 0) + 1;
    return geometry;
  },
  swatches: new Map(),
  restoreCanvas(record) {
    const canvas = document.createElement("canvas");
    canvas.width = record.width;
    canvas.height = record.height;
    canvas
      .getContext("2d")
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(
            record.data.buffer,
            record.data.byteOffset,
            record.data.byteLength,
          ),
          record.width,
          record.height,
        ),
        0,
        0,
      );
    return canvas;
  },
  captureMaterials(value) {
    if (policy.cacheMaterials) this.pendingMaterials = value;
  },
  restoreMaterials(create, anisotropy) {
    if (!this.materials) return null;
    try {
      const result = restoreMaterials(this.materials, create, anisotropy, { consume: true });
      if (result) stats.materials = "hit";
      this.materials = null;
      return result;
    } catch {
      this.materials = null;
      stats.materials = "invalid";
      return null;
    }
  },
  hydrateArmoury(studio) {
    try {
      const hit = hydrateArmoury(studio, this.armoury);
      if (hit) stats.armoury = "prebaked";
      return hit;
    } catch {
      return false;
    }
  },
  trackShader(job) {
    stats.shaderJobs++;
    shaderJobs.push(Promise.resolve(job).then(
      () => null,
      (error) => {
        const failure = error instanceof Error ? error : Error(String(error));
        stats.shaderErrors++;
        stats.lastShaderError = failure.message.slice(0, 200);
        return failure;
      },
    ));
  },
  async finishShaders() {
    await finishShaderJobs(shaderJobs);
  },
});
// Browser HTTP cache can fetch/parse the stable, versioned bundle while local
// material data and pre-baked icons load in parallel.
const game = new URL("core/game.js", base);
const preload = document.createElement("link");
preload.rel = "preload";
preload.as = "script";
preload.href = game.href;
document.head.append(preload);
// Fetch while the renderer builds the hotel; only join at the operator stage.
// Missing, obsolete or offline assets use the original procedural model.
const cancelOperatorLoad = () => operatorAbort.abort(new Error("Page hidden during operator load"));
let operatorDeadline;
if (workerDecode) {
  addEventListener("pagehide", cancelOperatorLoad, { once: true });
  operatorDeadline = setTimeout(() => operatorAbort.abort(new Error("Operator load timeout")), 15000);
}
const operatorJob = baking ? Promise.resolve() : fetch(new URL("assets/operators.bin", base), {
  signal: operatorAbort?.signal ?? AbortSignal.timeout(15000),
  priority: "low",
}).then(async response => {
  if (!response.ok) throw Error("Operator pack HTTP " + response.status);
  const buffer = await response.arrayBuffer();
  if (globalThis.GH?.ready) return;
  const start = performance.now();
  stats.operatorDecodeStartedAt = start;
  let operators, grips, materials;
  if (workerDecode) {
    const { decodeOperatorPack } = await import("./operator-decoder.js");
    const result = await decodeOperatorPack(buffer, version, operatorAbort.signal);
    operatorAbort.signal.throwIfAborted();
    if (globalThis.GH?.ready) return;
    ({ operators, grips, materials } = result);
    stats.operatorDecodeMode = result.mode;
    stats.operatorDecodeMs = result.decodeMs;
  } else {
    operators = decodeOperators(buffer, version);
    ({ grips, materials } = operators);
    stats.operatorDecodeMode = "inline";
    stats.operatorDecodeMs = performance.now() - start;
  }
  stats.operatorDecodeElapsedMs = performance.now() - start;
  boot.operators = operators;
  boot.grips = grips;
  boot.actorMaterialPack = materials;
}).catch(error => {
  stats.operators = "fallback";
  stats.operatorDecodeError = String(operatorAbort?.signal.reason?.message || error.message || error);
}).finally(() => {
  if (workerDecode) {
    clearTimeout(operatorDeadline);
    removeEventListener("pagehide", cancelOperatorLoad);
  }
});
if (!baking) {
  await Promise.allSettled([
    (policy.cacheMaterials ? readCache(key, policy.materialCacheBytes, { signal: AbortSignal.timeout(1200) })
      : Promise.resolve(null)).then((value) => {
      boot.materials = value || null;
    }),
    fetch(new URL("assets/armoury.json", base), {
      signal: AbortSignal.timeout(1500),
      priority: "high",
    }).then(async (response) => {
      if (response.ok) {
        const pack = await response.json();
        if (pack.source !== version) return;
        boot.armoury = pack;
        await Promise.allSettled(
          (pack.swatches || []).map(async ([key, url]) => {
            if (!/^data:image\/png;base64,/.test(url)) return;
            const image = await createImageBitmap(
              await (await fetch(url)).blob(),
            );
            boot.swatches.set(key, image);
          }),
        );
        stats.swatches = boot.swatches.size;
      }
    }),
    fetch(new URL("assets/grips.json", base), { signal: AbortSignal.timeout(1200), priority: "high" })
      .then(async response => {
        if (!response.ok) return;
        const pack = await response.json();
        if (pack.schema === 1 && pack.source === version && Array.isArray(pack.grips)) boot.grips = pack.grips;
      }),
  ]);
}
stats.cacheReadMs = Math.round(performance.now() - start);
await weaponArtReady;
const script = document.createElement("script");
script.src = game.href;
script.onerror = () => {
  rejectRuntime(Error("Game script failed to load"));
  document.querySelector("#ltxt").textContent = "游戏资源加载失败，请刷新重试";
};
document.body.append(script);
try {
  await Promise.all([import("./telemetry.js"), import("./pvp.js")]);
  while (!globalThis.GH?.ready)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const desktop = installDesktopInput(globalThis.GH);
  globalThis.GHInput?.bind(globalThis.GH, desktop.suspend);
  installWebGLRecovery(globalThis.GH, desktop.suspend);
  await globalThis.GH.debug.gfx.whenReady();
  stats.runtimeReadyMs = Math.round(performance.now());
  resolveRuntime();
} catch (error) {
  rejectRuntime(error);
  throw error;
}
// Geometry actually used by the renderer owns its buffers. Release unused
// optional data (for example, if a slow download arrived after its build stage).
boot.operators = null;
boot.actorMaterialPack = null;
if (!baking && policy.cacheMaterials && boot.pendingMaterials) {
  const save = () => {
    try {
      const materials = boot.pendingMaterials;
      boot.pendingMaterials = null;
      writeMaterialsCache(key, materials, policy.materialCacheBytes)
        .then((saved) => {
          stats.materialsSaved = saved.textures;
          stats.materialBytes = saved.bytes;
        })
        .catch(() => {
          stats.cacheWrite = "unavailable";
        });
    } catch {
      boot.pendingMaterials = null;
      stats.cacheWrite = "unavailable";
    }
  };
  if (globalThis.requestIdleCallback)
    requestIdleCallback(save, { timeout: 5000 });
  else setTimeout(save, 1000);
}
