import { Engine } from "./engine.js";

export class CompetitiveEngine extends Engine {
  removeRemote(id) {
    super.removeRemote(id);
    // A newly revealed rig must not interpolate from positions before it was hidden.
    for (const snapshot of this.snapshots) {
      snapshot.players = snapshot.players.filter(player=>player.id!==id);
    }
  }
  createRemote(player) {
    super.createRemote(player);
    // The first interpolation sample positions the rig before making it visible.
    this.remotes.get(player.id).rig.root.visible=false;
  }
  actor(id) {
    // Kill feed and post-match HUD need only a public name and team for a hidden actor.
    return super.actor(id) ?? this.room?.players.find(player=>player.id===id);
  }
}
