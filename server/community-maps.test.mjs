import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { builtinMap, loadMapCatalog } from "./maps.mjs";
import { acceptsMap, findTdmRoom, selectTdmMap } from "./room-content.mjs";
import { Room } from "./room.mjs";
import { decodeSnapshot } from "../game/client/net.js";
import { Career } from "./career.mjs";

const box=(min,max)=>({min,max,noMove:false,noRay:false});
const floor=box([-20,-1,-20],[20,0,20]);
const wall=box([-0.25,0,-5],[0.25,4,5]);
const nodes=[{ pos:[-2,0,0],links:[1] },{ pos:[-2,0,3],links:[0] }];
const spawns=[0,1].flatMap(team=>Array.from({length:5},(_,i)=>({
  team, pos:[team ? 2 : -2,0,i*1.5], yaw:team ? Math.PI/2 : -Math.PI/2,
})));
const peer=()=>({events:[],send(event){this.events.push(structuredClone(event));}});
const ids=(room,viewer)=>decodeSnapshot(room.packet(viewer)).players.map(player=>player.id);
const hello=map=>({mapProtocol:1,mapId:map.ref.id,mapVersion:map.ref.version,mapRevision:map.ref.revision,modeId:"tdm"});

function registry(t) {
  const root=mkdtempSync(join(tmpdir(),"gh-community-maps-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  function write(path,value) { writeFileSync(join(root,path),JSON.stringify(value)); }
  function fixture(id,colliders,version="3") {
    const path=id+"/"+version;
    mkdirSync(join(root,path),{recursive:true});
    write(path+"/manifest.json",{ schema:1, id, version, name:id, clientScene:"gltf",
      sceneAsset:"assets/maps/"+path+"/scene.glb", sceneBytes:20, sceneSHA256:"0".repeat(64),
      worldAsset:"world.json", gameplayAsset:"gameplay.json",
      environment:{background:"1b2228",fogColor:"191919",fogDensity:0.01} });
    write(path+"/world.json",{bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10},colliders,nodes});
    write(path+"/gameplay.json",{spawns});
    return {id,version};
  }
  const coverage=fixture("blocked",[floor,wall]);
  const open=fixture("open",[floor]);
  const otherVersion=fixture("blocked",[floor],"4");
  const broken=fixture("broken",[floor,box([0,0,0],[-10,1,1])]);
  write("catalog.json",{schema:1,maps:[coverage,open,otherVersion,broken,{id:"blocked",version:"../../"}]});
  const warnings=[];
  return {root,write,warnings,maps:loadMapCatalog(root,warning=>warnings.push(warning))};
}

test("JSON-only catalog validates map content and partitions TDM by exact room revision", t=>{
  const {maps,root,write,warnings}=registry(t);
  const blocked=maps.get("blocked/3"), open=maps.get("open/3"), alternate=maps.get("blocked/4");
  assert.deepEqual([...maps.keys()],["hotel/builtin","blocked/3","open/3","blocked/4"]);
  assert.equal(warnings.length,2);
  assert.equal(selectTdmMap(maps,{}),builtinMap);
  assert.equal(selectTdmMap(maps,hello(blocked)),blocked);
  for (const invalid of [{...hello(blocked),mapRevision:open.ref.revision},{...hello(blocked),modeId:"zombie-coop"},
    {...hello(blocked),mapProtocol:2},{...hello(blocked),mapProtocol:undefined}])
    assert.throws(()=>selectTdmMap(maps,invalid),/error.map_version/);
  assert.ok(acceptsMap({},builtinMap));
  assert.ok(!acceptsMap({},blocked));
  assert.ok(!acceptsMap({mapProtocol:2},builtinMap));
  assert.ok(acceptsMap({mapProtocol:1},blocked));
  assert.ok(!acceptsMap(hello(alternate),blocked));
  const existing=[new Room(),new Room("regular",60000,null,{map:alternate}),new Room("regular",60000,null,{map:blocked})];
  assert.equal(findTdmRoom(existing.values(),open),undefined);
  assert.equal(findTdmRoom(existing.values(),blocked),existing[2]);
  existing[2].end();
  assert.equal(findTdmRoom(existing.values(),blocked),undefined);
  write("blocked/3/gameplay.json",{spawns,anchors:{extra:[[1,0,1]]}});
  const revised=loadMapCatalog(root,()=>{}).get("blocked/3");
  assert.notEqual(revised.ref.revision,blocked.ref.revision);
  assert.throws(()=>selectTdmMap(loadMapCatalog(root,()=>{}),hello(blocked)),/error.map_version/);
  assert.deepEqual([...loadMapCatalog(join(root,"unimported")).keys()],["hotel/builtin"]);
});

test("each room applies its own navigation, spawn, cover, movement, reconnect and settlement",t=>{
  const {maps}=registry(t);
  const career=new Career(":memory:");
  t.after(()=>career.db.close());
  const blocked=new Room("regular",10000,career,{map:maps.get("blocked/3")});
  const open=new Room("regular",10000,career,{map:maps.get("open/3")});
  const pilot=peer(), guest=peer(), profile=randomUUID();
  const shooter=blocked.join(pilot,{name:"Pilot"},profile), target=blocked.join(guest,{name:"Guest"},randomUUID());
  const other=open.join(peer(),{name:"Pilot"},randomUUID()), victim=open.join(peer(),{name:"Guest"},randomUUID());
  assert.notEqual(blocked.world,open.world);
  assert.deepEqual([shooter.x,shooter.y,shooter.z,shooter.yaw],[-2,0,0,-Math.PI/2]);
  assert.deepEqual([target.x,target.y,target.z,target.yaw],[2,0,0,Math.PI/2]);
  assert.equal(blocked.summary().mapVersion,"3");
  const welcome=guest.events.find(event=>event.type==="welcome");
  assert.equal(welcome.mapRevision,blocked.map.ref.revision);
  assert.equal(guest.events.at(-1).modeId,"tdm");
  assert.ok(!ids(blocked,shooter).includes(target.id));
  assert.ok(ids(open,other).includes(victim.id));
  target.hp=victim.hp=1;
  blocked.command(shooter,{type:"shot",yaw:-Math.PI/2,pitch:0});
  open.command(other,{type:"shot",yaw:-Math.PI/2,pitch:0});
  assert.ok(target.alive);
  assert.ok(!guest.events.some(event=>event.type==="shot"));
  assert.ok(!victim.alive);
  const movingBot=blocked.players[2], spawnZ=movingBot.z;
  for (const player of [shooter,other]) {
    player.input={...player.input,forward:1,seq:8};
    player.inputAge=-100;
  }
  for (let i=0;i<70;i++) { blocked.step(); open.step(); }
  assert.ok(shooter.x<0 && other.x>0);
  assert.notEqual(movingBot.z,spawnZ);
  assert.equal(shooter.ack,8);
  const saved=[shooter.x,shooter.y,shooter.z], token=shooter.token;
  shooter.peer=null;
  assert.throws(()=>blocked.join(peer(),{resume:token},randomUUID()),/error.resume/);
  const reconnected=peer();
  assert.equal(blocked.join(reconnected,{resume:token},profile),shooter);
  assert.deepEqual([shooter.x,shooter.y,shooter.z],saved);
  assert.notEqual(shooter.token,token);
  assert.equal(reconnected.events[0].inputSeq,8);
  assert.equal(reconnected.events[0].mapRevision,welcome.mapRevision);
  Object.assign(shooter,{x:2,y:0,z:1.4,cooldown:0});
  blocked.command(shooter,{type:"melee",yaw:0,pitch:0});
  assert.deepEqual(blocked.scores,[1,0]);
  blocked.remaining=1;
  blocked.step();
  assert.equal(blocked.phase,"over");
  assert.equal(career.board(profile).mine.score,1);
  blocked.end();
  assert.equal(reconnected.events.filter(event=>event.type==="round-end").length,1);
  blocked.command(shooter,{type:"ready",ready:true});
  assert.equal(blocked.round,2);
  assert.equal(shooter.x,-2);
  assert.equal(reconnected.events.at(-1).mapRevision,welcome.mapRevision);
});
