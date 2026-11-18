// A non-functional stage prop in a shallow display pocket. It only observes the
// game's existing animation; there is no independent timer, ammo or event path.
const shared = new WeakMap();

function prop(T) {
  if (shared.has(T)) return shared.get(T);
  const p=[],colors=[],idx=[],bands=[
    [-.020,.0061,0xb08b56],[-.018,.0071,0xb08b56],[-.015,.0071,0xb08b56],
    [-.015,.0068,0xa73c2f],[.015,.0068,0xa73c2f],[.018,.0061,0x78322c],
  ], sides=12;
  for(const [z,r,hex] of bands) {
    const c=new T.Color(hex);
    for(let i=0;i<sides;i++){
      const angle=2*Math.PI*i/sides;
      p.push(r*Math.cos(angle),r*Math.sin(angle),z);
      colors.push(c.r,c.g,c.b);
    }
  }
  for(let j=0;j<bands.length-1;j++)for(let i=0;i<sides;i++){
    const a=j*sides+i,b=j*sides+(i+1)%sides;
    idx.push(a,b,a+sides,b,b+sides,a+sides);
  }
  for(let i=1;i<sides-1;i++){
    idx.push(0,i+1,i);
    const k=(bands.length-1)*sides;idx.push(k,k+i,k+i+1);
  }
  const g=new T.BufferGeometry();
  g.setAttribute("position",new T.Float32BufferAttribute(p,3));
  g.setAttribute("color",new T.Float32BufferAttribute(colors,3));
  g.setIndex(idx);g.computeVertexNormals();
  const m=new T.MeshStandardMaterial({vertexColors:true,roughness:.48,metalness:.16});
  m.name="Lin-Bei display cartridge";
  const stock={g,m};shared.set(T,stock);return stock;
}

export function mountLinbeiWindow(T,gun,body,detail) {
  if (detail!=="view" || !gun.parts?.pump || !gun.clips) return;
  const {g,m}=prop(T), mesh=new T.Mesh(g,m);
  mesh.name="LinBeiWindowCartridge";
  // Kept in the gun's body space without modifying the retained native shell,
  // hull or liftShell transforms used by the game's reload/ejection effects.
  gun.root.add(mesh);
  const base=body.position.clone().add(new T.Vector3(.011,.049,-.124));
  const pump=gun.parts.pump, rest=pump.userData.rest.z;
  gun.updateShopWindow=function(rounds) {
    const phase=Math.min(1,Math.max(0,(pump.position.z-rest)/.075));
    mesh.position.copy(base);
    mesh.position.z+=.046*phase;
    mesh.visible=rounds>0;
  };
  gun.updateShopWindow(0);
}
