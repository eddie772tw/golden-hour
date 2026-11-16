// Observe the native match objects; no timer or bundle patch is needed.
export function installTrainingKills({ gh, account, isOnline }) {
  const { match, player, hud } = gh.debug.ctx;
  const callbacks = hud.menus.cb;
  let active = !isOnline() && ["countdown", "live", "ending"].includes(match.state);
  // Installing during a round must not import kills earned before installation.
  let highWater = Number.isSafeInteger(player.kills) && player.kills >= 0 ? player.kills : 0;

  function sample() {
    // Online rendering uses this same player and writes authoritative kills into
    // it. An online native start is preparation, never a training round.
    if (isOnline()) {
      active = false;
      return 0;
    }
    const kills = player.kills;
    if (!active || !Number.isSafeInteger(kills) || kills <= highWater) return 0;
    const delta = kills - highWater;
    highWater = kills;
    // Advance even for an anonymous account: authorization must not backfill.
    account.record("training", delta);
    return delta;
  }

  function flush() {
    try {
      Promise.resolve(account.flush()).catch(() => {});
    } catch {
      // Account state owns synchronization failures; never claim success here.
    }
  }

  const start = match.start;
  match.start = function (...args) {
    sample();
    if (active) flush();
    active = false;
    const result = start.apply(this, args);
    // start resets every actor's counters, then respawns and starts countdown.
    highWater = Number.isSafeInteger(player.kills) && player.kills >= 0 ? player.kills : 0;
    active = !isOnline();
    return result;
  };

  const kill = match._kill;
  match._kill = function (...args) {
    try {
      return kill.apply(this, args);
    } finally {
      // Native _kill can synchronously call _end on the final scoring kill.
      // Read only the local actor's counter, never team scores or killfeed.
      sample();
    }
  };

  function wrapSettlement(target, name) {
    const original = target[name];
    target[name] = function (...args) {
      sample();
      const finishing = active;
      try {
        return original.apply(this, args);
      } finally {
        sample();
        if (finishing && active) {
          active = false;
          flush();
        }
      }
    };
  }

  // Native quit marks match idle directly, without an end callback. Normal end
  // reaches hud.matchEnd after the slow-motion ending (which still allows kills).
  wrapSettlement(hud, "matchEnd");
  wrapSettlement(callbacks, "onQuit");
  return { sample };
}
