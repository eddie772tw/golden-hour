const distance = (a,b) => (a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;

function nearest(nodes, actor) {
  const point=[actor.x,actor.y,actor.z];
  let index=0, best=Infinity;
  for (let i=0; i<nodes.length; i++) {
    const d=distance(point,nodes[i].pos);
    if (d<best) { index=i; best=d; }
  }
  return index;
}

function nextHop(nodes, start, goal) {
  if (start===goal) return goal;
  const first=new Int32Array(nodes.length).fill(-1), queue=[start];
  first[start]=start;
  for (let i=0; i<queue.length; i++) {
    const from=queue[i];
    for (const to of nodes[from].links) {
      if (first[to]!==-1) continue;
      first[to]=from===start?to:first[from];
      if (to===goal) return first[to];
      queue.push(to);
    }
  }
  return -1;
}

export function navigateBot(bot, enemy, nodes, world, tick) {
  // Each bot follows one local edge at a time. Throttle searches for moving targets.
  if (!bot.nav || tick>=bot.nav.until || bot.nav.enemy!==enemy?.id) {
    const start=nearest(nodes,bot);
    const {links}=nodes[start];
    let next=enemy?nextHop(nodes,start,nearest(nodes,enemy)):-1;
    if (next===-1 && links.length) {
      const choices=links.filter(to=>to!==bot.nav?.from);
      const candidates=choices.length?choices:links;
      next=candidates[(bot.id+tick)%candidates.length];
    }
    bot.nav={from:start,next,until:tick+30+bot.id,enemy:enemy?.id};
  }
  const target=nodes[bot.nav.next]?.pos;
  if (!target) return;
  const dx=target[0]-bot.x, dz=target[2]-bot.z;
  const horizontal=Math.hypot(dx,dz);
  if (horizontal<0.16) {
    bot.nav.until=tick;
    world.move(bot,{forward:0,right:0,yaw:bot.yaw,buttons:0});
    return;
  }
  const yaw=Math.atan2(-dx,-dz);
  world.move(bot,{forward:Math.min(1,horizontal*3),right:0,yaw,buttons:0});
  bot.yaw=yaw;
}
