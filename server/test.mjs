import test from "node:test";
import assert from "node:assert/strict";
import { Room, readInput, world } from "./room.mjs";
import { decodeSnapshot, encodeInput } from "../game/client/net.js";
import { OnlineKills } from "../game/client/online-kills.js";
import { MatchReportGate } from "../game/client/online-results.js";
import { ToyAccount } from "../game/client/toy-account.js";
import { Career, profileID } from "./career.mjs";
import { randomUUID } from "node:crypto";
import { fixture } from "../game/client/toy-fixture.js";

const peer=()=>({events:[],send(e){this.events.push(e);}});
test("captured client packets ↔ server: movement, shot, kill, respawn, result and rematch",()=>{
  const a=peer(), b=peer(), room=new Room(), p=room.join(a,{name:"Host"}), q=room.join(b,{name:"Guest"});
  const packet=Buffer.from(encodeInput({seq:14,forward:1,yaw:0}));
  p.input=readInput(packet); room.step(); room.step();
  const state=decodeSnapshot(room.packet(p));
  assert.equal(state.players[0].ack,14); assert.equal(state.phase,"live");
  assert.equal(state.players.filter(p=>p.bot).length,8);
  assert.equal(readInput(packet.subarray(0,24)),undefined);
  packet.writeFloatLE(NaN,8); assert.equal(readInput(packet),undefined);
  assert.equal(world.blocked(p,1.8),false);
  // Two actors on a clear section of floor, facing one another.
  Object.assign(p,{x:0,y:0,z:7.6}); Object.assign(q,{x:0,y:0,z:6.3});
  for(const weapon of ["pistol","ar"]) {
    room.command(p,{type:"equip",weapon}); assert.equal(decodeSnapshot(room.packet(p)).players[0].weapon,weapon);
  }
  room.command(p,{type:"melee",yaw:0,pitch:0});
  assert.equal(q.hp,0); assert.deepEqual(room.scores,[1,0]);
  for(let i=0;i<121;i++)room.step();
  assert.equal(q.hp,100); assert.ok(b.events.some(e=>e.type==="spawn" && e.id===q.id));
  room.remaining=1; room.step();
  const result=a.events.at(-1); assert.equal(result.phase,"over");
  assert.equal(result.winner,p.team);
  const gate=new MatchReportGate(); assert.ok(gate.claim(result)); assert.ok(!gate.claim(result));
  const awards=[], records=[];
  const kills=new OnlineKills({record:(mode,n)=>records.push([mode,n]),flush(){}});
  kills.progression={kill(){},finish:(score,won)=>awards.push([score,won])};
  for (const e of a.events) kills.event(e,p.id);
  assert.deepEqual(records,[["online",1]]); assert.deepEqual(awards,[[100,true]]);
  room.command(p,{type:"ready",ready:true}); assert.equal(room.round,2); assert.deepEqual(room.scores,[0,0]);
});
function storage() {const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
test("Toy client writes and restores a dev identity; denied, read-only and failed writes stay distinct",async()=>{
  const disk=storage();
  const account=(user,mode="")=>new ToyAccount({sdk:fixture("?toy="+user+"&fixture="+mode,disk),storage:disk});
  const alice=account("alice","unlocked"); await alice.authorize();
  assert.equal(alice.state.status,"ready");
  await alice.record("online",3); await alice.flush();
  const restored=account("alice"); await restored.authorize(); assert.equal(restored.state.online,3);
  assert.equal(await restored.sdk.isSupport("submitScore"),false);
  const bob=account("bob","readonly"); await bob.authorize(); assert.equal(bob.state.online,0);
  assert.equal(bob.state.sync,"readonly");
  const denied=account("guest","denied"); await denied.authorize(); assert.equal(denied.state.authenticated,false);
  const fail=account("fail","write-error"); await fail.authorize(); await fail.record("training",1);
  await fail.flush(); assert.equal(fail.state.sync,"error");
});

test("ten verified opposing-player gun kills unlock each primary, persist, and credit the board once", async t => {
  const {mkdtempSync,rmSync} = await import("node:fs");
  const {tmpdir} = await import("node:os");
  const {join} = await import("node:path");
  const dir=mkdtempSync(join(tmpdir(),"gh-career-"));
  const filename=join(dir,"test.sqlite");
  let career=new Career(filename);
  t.after(()=>{career.db.close();rmSync(dir,{recursive:true,force:true});});
  const room=new Room("regular",480000,career);
  const key=randomUUID(), a=peer(), b=peer();
  const shooter=room.join(a,{name:"Pilot",unlocked:["shotgun"],kills:{ar:999}},key);
  const victim=room.join(b,{name:"Other"},randomUUID());
  function equip(weapon) { room.command(shooter,{type:"equip",weapon}); return shooter.weapon; }
  function frag() {
    // Last shot of a firefight on a known clear patch of floor.
    Object.assign(shooter,{x:0,y:0,z:7.6,cooldown:0});
    Object.assign(victim,{x:0,y:0,z:6.3,hp:1,alive:true});
    room.command(shooter,{type:"shot",yaw:0,pitch:0,weapon:"shotgun",kills:999});
    assert.equal(victim.alive,false);
  }
  room.command(shooter,{type:"career",kills:{ar:10}});
  assert.equal(equip("smg"),"ar");
  for (let i=0;i<9;i++) frag();
  assert.equal(equip("smg"),"ar");
  frag();
  assert.equal(equip("smg"),"smg");
  for (let i=0;i<9;i++) frag();
  assert.equal(equip("shotgun"),"smg");
  frag();
  assert.equal(equip("shotgun"),"shotgun");
  const id=key;
  assert.deepEqual(career.progress(id).kills,{ar:10,smg:10});
  assert.equal(career.record(room.matchID,room.round,room.elimination,shooter,victim,"smg"),false);
  for (const excluded of [room.players[3],{...victim,peer:null},{...victim,profile:id},{...victim,team:shooter.team}]) {
    assert.equal(career.record(room.matchID,1,21,shooter,excluded,"ar"),false);
  }
  shooter.peer=null;
  assert.throws(()=>room.join(peer(),{resume:shooter.token},randomUUID()));
  room.join(peer(),{resume:shooter.token},key);
  room.end(); room.command(shooter,{type:"ready",ready:true});
  career.db.close(); career=new Career(filename);
  assert.equal(career.board(id).mine.score,20);
  assert.equal(career.board(profileID(randomUUID())).mine.ranked,false);
  assert.deepEqual(career.progress(id).unlocked,["ar","pistol","m200","smg","shotgun"]);
});

test("walls withhold enemy records and shot coordinates per recipient; openings restore them",()=>{
  const room=new Room();
  const viewer=room.join(peer(),{}), enemy=room.join(peer(),{}), ally=room.join(peer(),{});
  Object.assign(viewer,{x:-9,y:0,z:-6}); Object.assign(enemy,{x:-9,y:0,z:-10});
  Object.assign(ally,{x:-9,y:0,z:-11});
  const ids=who=>decodeSnapshot(room.packet(who)).players.map(p=>p.id);
  assert.ok(!ids(viewer).includes(enemy.id));
  assert.ok(ids(viewer).includes(ally.id));
  assert.ok(ids(ally).includes(enemy.id));
  room.command(enemy,{type:"shot",yaw:0,pitch:0});
  assert.ok(!viewer.peer.events.some(e=>e.type==="shot"));
  assert.ok(ally.peer.events.some(e=>e.type==="shot"));
  viewer.x=enemy.x=2.9; // authored doorway at z=-8
  assert.ok(ids(viewer).includes(enemy.id));
  viewer.x=enemy.x=-9;
  assert.ok(!ids(viewer).includes(enemy.id));
  const roster=viewer.peer.events.findLast(e=>e.type==="room");
  assert.equal(roster.players.length,10);
  assert.ok(roster.players.every(p=>!("x" in p) && !("weapon" in p)));
});
