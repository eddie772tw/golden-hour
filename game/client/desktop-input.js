const gameplayKeys = new Set([
  "KeyW", "KeyS", "KeyA", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Space", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "KeyC", "KeyX", "KeyZ",
  "KeyR", "KeyV", "KeyF", "KeyG", "KeyQ", "Digit1", "Digit2", "KeyE", "KeyT", "Tab", "KeyB", "Digit3",
]);

function editable(event) {
  return (event.composedPath?.() || [event.target]).some((target) =>
    target?.isContentEditable || target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"),
  );
}

function browserEscape(event) {
  return event.altKey || event.metaKey || event.code === "F11" || event.code === "F12" ||
    (event.ctrlKey && ["KeyW", "KeyT", "KeyN", "KeyL", "KeyR"].includes(event.code));
}

// Clear edges as well as holds: a down edge surviving a pause can fire on resume.
export function clearInputState(input) {
  for (const field of ["keys", "down", "up", "touchKeys", "touchDown", "touchUp"])
    input[field]?.clear();
  for (const field of ["mx", "my", "wheel", "touchForward", "touchRight", "touchMx", "touchMy"])
    input[field] = 0;
  input.touchActive = false;
}

export function installDesktopInput(gh) {
  const input = gh.debug.input;
  const canvas = input.el;
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const playing = () => gh.G.state === "playing";
  // The replay patch consults this before the prototype records keyboard state.
  input.acceptKeyboard = (event) => playing() && !editable(event) && !browserEscape(event);
  let suspending = false;
  function suspend() {
    if (suspending) return;
    suspending = true;
    try {
      const wasPlaying = playing();
      globalThis.GHTouch?.deactivate();
      input.allowLock = false;
      input.lockAttempt = (input.lockAttempt || 0) + 1;
      clearInputState(input);
      input.enabled = false;
      if (wasPlaying) {
        input.onLockChange?.(false);
        // Native ?nolock mode deliberately ignores lock loss; it must still pause
        // on blur, Escape and renderer loss rather than silently resume firing.
        if (playing()) {
          gh.G.state = "paused";
          gh.G.pausedAt = performance.now();
          gh.debug.ctx.hud.show("pause");
          gh.debug.ctx.audio?.slideStop?.();
          gh.debug.ctx.match.k9?.pause();
        }
      }
      input.unlock();
      clearInputState(input);
    } finally {
      suspending = false;
    }
  }
  win.addEventListener("keydown", (event) => {
    if (!playing() || editable(event)) return;
    if (event.code === "Escape") {
      suspend();
      return; // Preserve the browser's pointer-lock/fullscreen escape.
    }
    if (!browserEscape(event) && gameplayKeys.has(event.code)) event.preventDefault();
  }, { capture: true });
  win.addEventListener("blur", suspend);
  win.addEventListener("pagehide", suspend);
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) suspend();
  });
  doc.addEventListener("pointerlockchange", () => {
    if (doc.pointerLockElement !== canvas && playing() && (input.locked || !input.touchActive)) suspend();
  }, { capture: true });
  for (const type of ["mousedown", "auxclick", "contextmenu", "dragstart", "selectstart", "wheel"])
    canvas.addEventListener(type, (event) => {
      if (playing()) event.preventDefault();
    }, { passive: false });
  canvas.style.userSelect = "none";
  canvas.style.touchAction = "none";
  return { suspend };
}
