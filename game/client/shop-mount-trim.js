// Presentation-only trim underneath existing optic assets. Dimensions are in
// native game coordinates; neither the camera nor the attachment is moved.
// The pistol optic has a different parent transform, so use mount-local space.
const trims = {
  gbull:  { width:.022, height:.0058, length:.030, y:-.00275, z:0 },
  chingi: { width:.024, height:.0140, length:.044, y:-.0067, z:.002 },
  linbei: { width:.024, height:.0191, length:.044, y:-.0092, z:.002 },
};
const geometries = new WeakMap();

function bevelShell(T) {
  let geometry = geometries.get(T);
  if (geometry) return geometry;
  const pos = [];
  const ring = (y,x,z) => [
    [-.76*x,y,-z],[.76*x,y,-z],[x,y,-.78*z],[x,y,.78*z],
    [.76*x,y,z],[-.76*x,y,z],[-x,y,.78*z],[-x,y,-.78*z],
  ];
  const rows = [ring(-.5,.46,.46),ring(-.29,.50,.50),ring(.30,.50,.50),ring(.5,.43,.45)];
  const tri=(a,b,c)=>pos.push(...a,...b,...c);
  for(let i=0;i<8;i++){
    const j=(i+1)%8;
    for(let k=0;k<rows.length-1;k++){
      const a=rows[k],b=rows[k+1];
      tri(a[i],b[i],b[j]);tri(a[i],b[j],a[j]);
    }
    tri([0,-.5,0],rows[0][i],rows[0][j]);
    tri([0,.5,0],rows[3][j],rows[3][i]);
  }
  geometry=new T.BufferGeometry();
  geometry.setAttribute("position",new T.Float32BufferAttribute(pos,3));
  geometry.computeVertexNormals();
  geometries.set(T,geometry);
  return geometry;
}

export function dressShopOptic(T,gun,body,id) {
  const mount=gun.mounts?.optic, trim=trims[id];
  if (!trim || !mount?.children.length || !gun.build?.optic || gun.build.optic==="irons") return;
  const surface=body.children.find(p=>/anodized frame|blued graphite/i.test(p.material?.name));
  if (!surface) return;
  const shell=new T.Mesh(bevelShell(T),surface.material);
  shell.name="ShopOpticTrim";
  shell.scale.set(trim.width,trim.height,trim.length);
  shell.position.set(0,trim.y,trim.z);
  mount.add(shell);
}

// The family rig puts these decorative laser housings below the long barrel,
// past the replacement fore-end. Seat them on the replacement art instead.
// Apply the same translation to the view-model beam origin; no projectile,
// camera, recoil, damage or input state is touched.
export function seatShopLaser(T,gun,id) {
  if (gun.build?.underbarrel !== "laser" || !gun.mounts?.underbarrel?.children.length) return;
  const delta = id === "chingi" ? [0,-.016,.14] : id === "linbei" ? [0,-.030,.16] : null;
  if (!delta) return;
  const offset = new T.Vector3(...delta);
  gun.mounts.underbarrel.position.add(offset);
  gun.anchors.laser?.add(offset);
}
