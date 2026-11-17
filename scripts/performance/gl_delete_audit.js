// Explicit context-recovery diagnostic. Never use this run for frame-time gates.
(() => {
  const state = window.__glDeleteAudit = { armed: false, calls: {}, failures: [], precedingErrors: [] };
  addEventListener('webglcontextrestored', () => { state.armed = true; }, true);
  const prototype = WebGL2RenderingContext.prototype;
  for (const name of ['deleteTexture','deleteBuffer','deleteFramebuffer','deleteRenderbuffer',
                       'deleteVertexArray','deleteProgram','deleteShader']) {
    const original = prototype[name];
    prototype[name] = function(...args) {
      if (!state.armed) return original.apply(this, args);
      const preceding = this.getError();
      if (preceding && state.precedingErrors.length < 32) state.precedingErrors.push({ name, error: preceding });
      const result = original.apply(this, args), error = this.getError();
      state.calls[name] = (state.calls[name] || 0) + 1;
      if (error && state.failures.filter(row => row.name === name).length < 2)
        state.failures.push({ name, error, stack: new Error().stack });
      return result;
    };
  }
})();
