import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Room } from "./room.mjs";
import { Career } from "./career.mjs";
import { clearSegment, traceDischarge } from "./ballistics.mjs";
import { decodeSnapshot, WEAPONS } from "../game/client/net.js";

test("each pellet stops at cover and can hit a different opponent",()=>{
  const shot={origin:[0,1.55,0],yaw:0,pitch:0,pellets:2,spread:5,damage:[20,10],falloff:[20,40]};
  const left={x:-0.87,y:0,z:-10}, right={x:0.87,y:0,z:-10};
  const fire=cover=>{
    const samples=[0,1,0.5,1];
    return traceDischarge(shot,[left,right],cover,()=>samples.shift());
  };
  assert.deepEqual([...fire([])],[[right,20],[left,20]]);
  const doorframe={min:[0,0,-5.2],max:[1,3,-5]};
  assert.deepEqual([...fire([doorframe])],[[left,20]]);
  assert.equal(fire([{min:[-3,0,-5.2],max:[3,3,-5]}]).size,0);
});

test("eyes can see past a ledge while the muzzle is blocked",()=>{
  const eye=[0,1.55,0], muzzle=[.2,1.30,-.35], target=[0,1.55,-5];
  const ledge=[{min:[-1,0,-1.1],max:[1,1.4,-.8]}];
  assert.ok(clearSegment(eye,target,ledge));
  assert.ok(!clearSegment(muzzle,target,ledge));
});

test("a hit alerts a fill bot; a wall prevents return fire and a doorway permits it",()=>{
  const room=new Room(), peer={send(){}}, shooter=room.join(peer,{});
  const bot=room.players[1];
  Object.assign(shooter,{x:-9,y:0,z:-6});
  Object.assign(bot,{x:-9,y:0,z:-10});
  room.hit(shooter,bot,"ar",10);
  room.tick=bot.threat.next;
  room.returnFire(bot);
  assert.equal(bot.ammo,30);
  shooter.x=bot.x=2.9;
  room.tick=bot.threat.next;
  room.returnFire(bot);
  assert.equal(bot.ammo,29);
  assert.ok(shooter.hp<100);
  shooter.peer=null;
  room.returnFire(bot);
  assert.equal(bot.threat,null);
});

test("M12 registers nine pellets, spends one shell and credits one elimination",()=>{
  const career=new Career();
  try {
    const events=[], peer={send:e=>events.push(e)};
    const room=new Room("regular",480000,career);
    const p=room.join(peer,{},randomUUID()), q=room.join({send(){}},{},randomUUID());
    for (let i=0;i<10;i++) career.record("setup",1,i,p,q,"smg");
    room.command(p,{type:"equip",weapon:"shotgun"});
    Object.assign(p,{x:0,y:0,z:7.6});
    Object.assign(q,{x:0,y:0,z:6.3,hp:250});
    room.command(p,{type:"shot",yaw:0,pitch:0,pellets:99,damage:999});
    assert.equal(q.hp,43);
    room.command(p,{type:"shot",yaw:0,pitch:0});
    assert.equal(p.ammo,5);
    p.cooldown=0;
    room.command(p,{type:"shot",yaw:0,pitch:0});
    assert.equal(events.filter(e=>e.type==="kill").length,1);
    assert.equal(p.kills,1);
    assert.equal(career.progress(p.profile).kills.shotgun,1);
  } finally {career.db.close();}
});

test("model selection uses server gates, separate kill IDs and append-only wire indices",()=>{
  assert.deepEqual(WEAPONS.slice(0,4),["ar","smg","shotgun","pistol"]);
  const career=new Career();
  try {
    const room=new Room("regular",480000,career);
    const p=room.join({send(){}},{},randomUUID()), q=room.join({send(){}},{},randomUUID());
    const equip=weapon=>{room.command(p,{type:"equip",weapon}); return decodeSnapshot(room.packet(p)).players.find(a=>a.id===p.id);};
    assert.equal(equip("chingi").weapon,"ar");
    assert.equal(equip("linbei").weapon,"ar");
    assert.equal(equip("gbull").ammo,20);
    assert.equal(equip("pistol").weapon,"gbull");
    for (let i=0;i<10;i++) career.record("setup",1,i,p,q,"ar");
    assert.equal(equip("chingi").ammo,30);
    for (let i=0;i<10;i++) career.record("setup",2,i,p,q,"chingi");
    assert.equal(equip("linbei").weapon,"chingi");
    for (let i=0;i<10;i++) career.record("setup",3,i,p,q,"smg");
    assert.equal(equip("linbei").weapon,"linbei");
    Object.assign(p,{x:0,y:0,z:7.6});
    Object.assign(q,{x:0,y:0,z:6.3,hp:100});
    room.command(p,{type:"shot",yaw:0,pitch:0});
    assert.equal(q.hp,28);
    assert.equal(p.ammo,5);
  } finally {career.db.close();}
});
