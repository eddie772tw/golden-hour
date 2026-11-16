// Each pellet stops at the nearest blocking collider or enemy hurtbox.
function rayDistance(origin,dir,min,max) {
  let lo=0, hi=Infinity;
  for (let axis=0;axis<3;axis++) {
    if (Math.abs(dir[axis])<1e-8) {
      if (origin[axis]<min[axis] || origin[axis]>max[axis]) return Infinity;
    } else {
      const a=(min[axis]-origin[axis])/dir[axis], b=(max[axis]-origin[axis])/dir[axis];
      lo=Math.max(lo,Math.min(a,b)); hi=Math.min(hi,Math.max(a,b));
      if (lo>hi) return Infinity;
    }
  }
  return lo;
}

export function clearSegment(from,to,cover) {
  const delta=to.map((value,i)=>value-from[i]);
  const length=Math.hypot(...delta);
  if (!length) return true;
  const dir=delta.map(value=>value/length);
  return !cover.some(c=>rayDistance(from,dir,c.min,c.max)<length);
}

export function traceDischarge({origin,yaw,pitch,pellets,spread,damage,falloff,reach=140},targets,cover,random=Math.random) {
  const hits=new Map();
  const sy=Math.sin(yaw), cy=Math.cos(yaw), sp=Math.sin(pitch), cp=Math.cos(pitch);
  for (let i=0;i<pellets;i++) {
    const angle=spread ? random()*Math.PI*2 : 0;
    const radius=spread ? Math.sqrt(random())*spread*Math.PI/180 : 0;
    const x=radius*Math.cos(angle), y=radius*Math.sin(angle);
    const norm=Math.hypot(1,x,y);
    const dir=[(-sy*cp+cy*x+sy*sp*y)/norm,(sp+cp*y)/norm,(-cy*cp-sy*x+cy*sp*y)/norm];
    let nearest=reach, target;

    for (const actor of targets) {
      const d=rayDistance(origin,dir,[actor.x-.32,actor.y,actor.z-.32],
        [actor.x+.32,actor.y+(actor.crouch?1.2:1.8),actor.z+.32]);
      if (d<nearest) { nearest=d; target=actor; }
    }
    if (target && !cover.some(c=>rayDistance(origin,dir,c.min,c.max)<=nearest)) {
      const fraction=Math.min(1,Math.max(0,(nearest-falloff[0])/(falloff[1]-falloff[0])));
      hits.set(target,(hits.get(target)??0)+damage[0]+(damage[1]-damage[0])*fraction);
    }
  }
  return hits;
}
