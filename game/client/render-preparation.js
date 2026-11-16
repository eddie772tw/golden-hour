// One renderer owner. A later request keeps the gate closed until its draw ends.
export function createRenderPreparation(warm) {
  let tail = Promise.resolve(), revision = 0, pending = false, error = null;
  return {
    get pending() { return pending; },
    get error() { return error; },
    request(reason, change) {
      const generation = ++revision;
      pending = true;
      error = null;
      const job = tail.catch(() => {}).then(async () => {
        await change?.();
        if (generation !== revision) return;
        await warm(reason, () => generation === revision);
        if (generation === revision) pending = false;
      }).catch(failure => {
        if (generation === revision) {
          pending = false;
          error = failure;
        }
        throw failure;
      });
      tail = job;
      // Event handlers may enqueue without awaiting; wait() still reports failure.
      job.catch(() => {});
      return job;
    },
    invalidate(failure) {
      revision++;
      pending = false;
      error = failure;
    },
    async wait() {
      for (;;) {
        const current = tail;
        try { await current; }
        catch (failure) { if (current === tail) throw failure; }
        if (current !== tail) continue;
        if (error) throw error;
        return;
      }
    },
  };
}

export async function finishShaderJobs(jobs) {
  while (jobs.length) {
    const results = await Promise.all(jobs.splice(0));
    const failure = results.find(result => result !== null);
    if (failure) throw failure;
  }
}

export async function waitForDraw(renderer) {
  const gl = renderer.getContext();
  if (gl.isContextLost()) throw Error("WebGL context lost during preparation");
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) throw Error("Unable to fence renderer preparation");
  const deadline = performance.now() + 120000;
  try {
    gl.flush();
    for (;;) {
      if (gl.isContextLost()) throw Error("WebGL context lost during preparation");
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return;
      if (status === gl.WAIT_FAILED || performance.now() > deadline)
        throw Error("Renderer preparation did not complete");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally {
    gl.deleteSync(fence);
  }
}
