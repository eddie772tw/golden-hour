const gradient={addColorStop(){}};
const ctx=new Proxy({createLinearGradient(){return gradient},createRadialGradient(){return gradient},measureText(){return {width:12}},getImageData(x,y,w,h){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)}},createImageData(w,h){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)}}},{get(o,k){return o[k]??(()=>{})}});
global.document={createElement(){return {width:0,height:0,getContext(){return ctx}}}};

// Geometry-only QA, not a browser capture. The shim above supplies the blank
// 2D canvases requested by procedural material generators; no WebGL is used.
global.document.documentElement={dataset:{}};
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const {resolve}=require("node:path"),{pathToFileURL,fileURLToPath}=require("node:url");
const repo=resolve(__dirname,"../..");
(async()=>{
 const mod=await import(pathToFileURL(repo+"/game/client/shop-weapon-art.js"));
 global.fetch=async url=>{
   const buf=fs.readFileSync(fileURLToPath(url));
   return {ok:true,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)};
 };
 global.createImageBitmap=async()=>({width:1,height:1});
 await mod.loadShopWeaponArt();
 global.GHBoot={policy:{},hydrateGrips:()=>false,limitTextureCanvas:x=>x,mountShopWeapon:mod.mountShopWeapon};
 const src=fs.readFileSync(repo+"/game/core/game.js","utf8"),cut=src.indexOf("var Nk = Z2;");
 assert(cut>0,"Can't locate native rig factory checkpoint");
 vm.runInThisContext(src.slice(0,cut)+"globalThis.rigFixture={Ky,Ct};})();");
 const {Ky,Ct:T}=rigFixture;
 const box=m=>new T.Box3().setFromObject(m);
 const finite=p=>p.toArray().every(Number.isFinite);
 const bodyRay=(body,x,z,top)=>{
   const d=top?-1:1;
   return new T.Raycaster(new T.Vector3(x,-d,z),new T.Vector3(0,d,0))
     .intersectObjects(body.children.filter(o=>o.visible),false)[0]?.point;
 };
 for(const [family,id] of [["pistol","gbull"],["smg","chingi"],["shotgun","linbei"]]){
   const options=["irons","reflex",...(family==="smg"?["holo"]:[])];
   for(const optic of options) for(const detail of ["view","world"]){
     const base=optic==="irons";
     const gun=Ky(family,{detail,modelId:id,build:{optic,
       muzzle:base?"none":family==="shotgun"?"choke":"suppressor",
       underbarrel:base?"none":"laser",magazine:base?"std":"ext",stock:"std",camo:"factory"}});
     gun.root.updateMatrixWorld(true);
     const body=gun.root.getObjectByName(id+(detail==="world"?"_world_lod":""));
     assert(body&&finite(gun.anchors.sight)&&finite(gun.anchors.muzzle));
     const trim=gun.root.getObjectByName("ShopOpticTrim"), mount=gun.mounts?.optic;
     assert.equal(!!trim,!base && !!mount?.children.some(c=>c!==trim),id+" "+optic+" "+detail+" trim visibility");
     for(const m of body.children.filter(c=>c.userData.removableIrons))assert.equal(m.visible,base);
     if(base && id!=="gbull"){
       const s=gun.anchors.sight, f=gun.anchors.frontSight;
       assert(f.z<s.z && Math.hypot(s.x-f.x,s.y-f.y)<1e-5);
     }
     let delta=null;
     if(trim){
       const b=box(trim),c=b.getCenter(new T.Vector3()),shell=bodyRay(body,c.x,c.z,true);
       assert(shell,"No supporting receiver surface");
       delta=b.min.y-shell.y;
       assert(delta < .0015 && delta>-.004,"trim-to-shell gap "+id+" "+optic+" "+detail+" "+delta);
       const lens=box(mount.children.find(o=>o!==trim));
       assert(b.max.y>=lens.min.y && b.max.y<lens.max.y,"trim intersects sight window envelope");
     }
     if(detail==="view"&&!base){
       const laser=gun.mounts.underbarrel,b=box(laser),c=b.getCenter(new T.Vector3());
       const hit=bodyRay(body,0,c.z,false);assert(hit,"floating laser");
       const clearance=hit.y-b.max.y;
       assert(Math.abs(clearance)<.005,"laser-to-body gap "+id+" "+clearance);
     }
     if(id==="linbei"&&base){
       const findRay=(z,direction=-1)=>{
         const o=body.position.clone().add(new T.Vector3(direction<0?1:-1,.049,z));
         return new T.Raycaster(o,new T.Vector3(direction,0,0)).intersectObjects(body.children,false)[0];
       };
       const back=findRay(-.101),rim=findRay(-.045),opposite=findRay(-.101,1);
       assert(back&&rim&&opposite,"missing opening, rim or far wall");
       assert(rim.point.x-back.point.x>.010,"port is still a flat patch");
       assert(/recess/.test(back.object.material.name),"exterior still covers pocket");
       assert(/graphite/.test(opposite.object.material.name),"opposite exterior perforated");
       const prop=gun.root.getObjectByName("LinBeiWindowCartridge");
       assert.equal(!!prop,detail==="view");
       if(prop){
         const z=[];
         gun.rounds=3;
         const nativeClip=gun.clips.pump,events=nativeClip.events;
         const pose={pos:new T.Vector3(),rot:new T.Euler()};
         for(const t of [0,.10,.16,.34]){
           gun.clips.pump.apply(t,pose);gun.updateShopWindow(3);
           assert(prop.visible);z.push(prop.position.z);
         }
         assert(z[1]>z[0] && z[2]>z[1] && Math.abs(z[3]-z[0])<1e-6);
         gun.updateShopWindow(0);assert(!prop.visible);assert.equal(gun.rounds,3);
         assert.equal(nativeClip.events,events);assert.equal(prop.geometry.index.count/3,140);
         const still=new T.Raycaster(body.position.clone().add(new T.Vector3(1,.049,-.124)),new T.Vector3(-1,0,0));
         gun.updateShopWindow(3);gun.root.updateMatrixWorld(true);
         const near=still.intersectObjects([prop,...body.children],false)[0];
         assert.equal(near.object,prop,"cartridge hidden behind surface");
       }
     }
     console.log(id,optic,detail,"OK",delta===null?"no active optic trim":"center contact "+(delta*1000).toFixed(2)+" game mm");
   }
 }
})().catch(e=>{console.error(e);process.exitCode=1});
