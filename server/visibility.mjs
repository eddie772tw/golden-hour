/* A wall can hide an actor only when it covers the entire projected bounds with no opening.
   Checking wall planes also ignores transparent glass, railings and prop collision proxies. */
export function visibleEnemy(viewer, target, walls) {
  if (viewer.team === target.team) return true;
  // Expand for the rig, gun and a short movement horizon. Test from a range of eye positions.
  const margin = 0.15;
  const eyeY = viewer.y + (viewer.sliding ? 0.8 : viewer.crouch ? 1.05 : 1.55);
  const radius = 0.8;
  const lead = 0.10;
  const expand = (speed) => Math.abs(speed || 0) * lead;
  for (const wall of walls) {
    const normal = wall.axis, along = normal === "x" ? "z" : "x";
    const vn = viewer[normal], tn = target[normal];
    const viewPad = margin + expand(viewer["v"+normal]);
    const targetPad = radius + expand(target["v"+normal]);
    // Both bounding volumes must be wholly on opposite sides of this wall plane.
    if (!((vn+viewPad < wall.pos && tn-targetPad > wall.pos) ||
          (vn-viewPad > wall.pos && tn+targetPad < wall.pos))) continue;
    const va = margin + expand(viewer["v"+along]), ta = radius + expand(target["v"+along]);
    const vy = margin + expand(viewer.vy), ty = expand(target.vy);
    let left=Infinity, right=-Infinity, bottom=Infinity, top=-Infinity;
    for (const from of [vn-viewPad,vn+viewPad]) for (const to of [tn-targetPad,tn+targetPad]) {
      const t = (wall.pos-from)/(to-from);
      const center = viewer[along]*(1-t)+target[along]*t;
      const width = va*(1-t)+ta*t;
      left=Math.min(left,center-width); right=Math.max(right,center+width);
      bottom=Math.min(bottom,(eyeY-vy)*(1-t)+(target.y-ty-0.04)*t);
      top=Math.max(top,(eyeY+vy)*(1-t)+(target.y+2.05+ty)*t);
    }
    if (left<=wall.a0 || right>=wall.a1 || bottom<=wall.y0 || top>=wall.y1) continue;
    const throughOpening = wall.openings.some(o =>
      right>=o.a0 && left<=o.a1 && top>=o.y0 && bottom<=o.y1);
    if (!throughOpening) return false;
  }
  return true;
}
