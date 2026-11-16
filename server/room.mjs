import { clearSegment, traceDischarge } from "./ballistics.mjs";
import { models, familyOf } from "../game/client/weapon-models.js";
import { visibleEnemy } from "./visibility.mjs";

import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { World, motion, clamp, ADS } from "../game/client/simulation.js";
import { WEAPONS } from "../game/client/net.js";

const map = JSON.parse(readFileSync(new URL("./world.json", import.meta.url)));
export const world = new World(map.colliders);
const specs = Object.fromEntries(map.weapons.map(w => [w.id, w]));
for (const [id, model] of Object.entries(models)) {
  specs[id] = {id, interval:60/model.rpm, mag:model.mag, reserve:model.mag*5, pellets:model.pellets,
    damage:model.dmg[0], farDamage:model.dmg[1], range:model.range, hip:model.hip[0], ads:model.ads};
}
const bulletCover = map.colliders.filter(c => !c.noRay);
const emptyInput = { forward: 0, right: 0, yaw: 0, pitch: 0, buttons: 0, seq: 0 };
const phases = ["lobby", "countdown", "live", "over"];
const stepMs = 1000 / 60;

export function readInput(data) {
  if (!Buffer.isBuffer(data) || data.length !== 25 || data.readUInt32LE() !== 0x01014748) return;
  const [forward,right,yaw,pitch] = [8,12,16,20].map(i => data.readFloatLE(i));
  if (![forward,right,yaw,pitch].every(Number.isFinite)) return;
  return {seq:data.readUInt32LE(4), forward:clamp(forward,-1,1), right:clamp(right,-1,1),
    yaw, pitch:clamp(pitch,-Math.PI/2,Math.PI/2), buttons:data[24] & 31};
}

function equip(p, weapon) {
  p.weapon = weapon;
  p.ammo = p.inventory[weapon].ammo;
  p.reserve = p.inventory[weapon].reserve;
  p.reload = 0;
}
function spawn(p) {
  const [x,y,z] = map.nodes[p.id-1];
  Object.assign(p,motion({x,y,z}),{yaw:0,pitch:0,hp:100,alive:true,respawn:0,cooldown:0,
    input:{...emptyInput,seq:p.ack},inputAge:0,
    threat:null, modelsThisLife:{}, inventory:Object.fromEntries(Object.values(specs).map(w=>[w.id,{ammo:w.mag,reserve:w.reserve}]))});
  equip(p,"ar");
}
function seat(id) {
  const p = {id,team:(id-1)%2,bot:true,name:"靶标 "+id,kills:0,deaths:0,score:0,ack:0};
  spawn(p);
  return p;
}

export class Room {
  constructor(difficulty = "regular", duration = 480000, career = null) {
    this.id=randomBytes(4).toString("hex").toUpperCase();
    this.matchID = randomUUID();
    this.elimination = 0;
    this.career = career;
    this.players=Array.from({length:10},(_,i)=>seat(i+1));
    this.tick=0; this.round=0; this.duration=duration; this.difficulty=difficulty;
    this.start();
  }
  start() {
    this.round++; this.phase="live"; this.scores=[0,0]; this.winner=-1; this.remaining=this.duration;
    for (const p of this.players) { spawn(p); p.kills=p.deaths=p.score=0; }
    this.broadcast({type:"round-start",round:this.round}); this.roster();
  }
  end() {
    this.phase="over"; this.winner=this.scores[0]===this.scores[1]?-1:Number(this.scores[1]>this.scores[0]);
    this.career?.finishRound(this.matchID,this.round,this.winner,this.players);
    this.broadcast({type:"round-end",round:this.round,winner:this.winner}); this.roster();
  }
  broadcast(event) { for (const p of this.players) p.peer?.send(event); }
  summary() {
    const humans=this.players.filter(p=>!p.bot);
    return {room:this.id,phase:this.phase,difficulty:this.difficulty,hostName:humans[0]?.name,
      humans:humans.length,bots:10-humans.length,capacity:10,joinable:humans.length<10};
  }
  roster() {
    this.broadcast({type:"room",room:this.id,round:this.round,host:this.players.find(p=>!p.bot)?.id,
      phase:this.phase,scores:this.scores,winner:this.winner,scoreLimit:40,difficulty:this.difficulty,
      players:this.players.map(({id,team,name,bot,peer,kills,deaths,score,alive})=>({id,team,name,bot,alive,connected:!!peer,kills,deaths,score}))});
  }
  join(peer,msg,profile = null) {
    const p=msg.resume ? this.players.find(p=>p.token===msg.resume && p.profile===profile && !p.peer) : this.players.find(p=>p.bot);
    if (!p) throw Error(msg.resume?"error.resume":"error.room_full");
    if (!msg.resume) { const team=p.team; Object.assign(p,seat(p.id),{team}); p.name=String(msg.name||"本机干员").replace(/[<>&]/g,"").slice(0,32); }
    p.profile=profile; p.bot=false; p.peer=peer; p.token=randomBytes(16).toString("hex"); clearTimeout(p.expiry);
    peer.send({type:"welcome",room:this.id,id:p.id,resume:p.token,inputSeq:p.ack,career:this.career?.progress(profile),weapons:Object.values(specs)});
    this.roster(); return p;
  }
  remove(p) { clearTimeout(p.expiry); const team=p.team; Object.assign(p,seat(p.id),{team,profile:null,peer:null,token:null}); this.roster(); }
  command(p,e) {
    if (e.type==="ping" && Number.isFinite(e.nonce)) return p.peer.send({type:"pong",nonce:e.nonce});
    if (this.phase==="over" && e.type==="ready" && e.ready===true) return this.start();
    if (this.phase==="over" && e.type==="team" && [0,1].includes(e.team) && p.team!==e.team) {
      const swap=this.players.find(q=>q.bot && q.team===e.team);
      if (swap) { swap.team=p.team; p.team=e.team; this.roster(); }
    }
    if (this.phase!=="live" || !p.alive) return;
    if (e.type==="equip" && WEAPONS.includes(e.weapon) && e.weapon!==p.weapon) {
      const family=familyOf(e.weapon);
      const allowed = family==="ar" || family==="pistol" || this.career?.progress(p.profile).unlocked.includes(family);
      if (!allowed) return p.peer.send({type:"error", code:"error.weapon_locked", params:[]});
      if (p.modelsThisLife[family] && p.modelsThisLife[family] !== e.weapon) return;
      p.modelsThisLife[family] = e.weapon;
      equip(p,e.weapon);
    }
    if (e.type==="reload" && !p.reload && p.reserve && p.ammo<specs[p.weapon].mag) p.reload=1200;
    if (!["shot","melee"].includes(e.type) || ![e.yaw,e.pitch].every(Number.isFinite) || p.cooldown || p.reload) return;
    const melee=e.type==="melee", weapon=melee?"melee":p.weapon;
    if (!melee && !p.ammo) return;
    const pitch=clamp(e.pitch,-Math.PI/2,Math.PI/2);
    const dir=[-Math.sin(e.yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(e.yaw)*Math.cos(pitch)];
    const pos=[p.x,p.y+(p.crouch?1:1.55),p.z];
    p.cooldown=melee?500:specs[weapon].interval*1000;
    if (!melee) {
      p.inventory[weapon].ammo=--p.ammo;
      const shot = {type:"shot",id:p.id,weapon,x:pos[0],y:pos[1],z:pos[2],dx:dir[0],dy:dir[1],dz:dir[2]};
      for (const viewer of this.players) {
        if (viewer.peer && visibleEnemy(viewer,p,map.walls)) viewer.peer.send(shot);
      }
    }
    const gun=specs[p.weapon];
    const hits=traceDischarge({origin:pos,yaw:e.yaw,pitch,pellets:melee?1:gun.pellets,
      spread:melee?0:(p.input.buttons & ADS ? gun.ads : gun.hip), reach:melee?2:140,
      damage:melee?[100,100]:[gun.damage,gun.farDamage], falloff:gun.range},
      this.players.filter(q=>q.alive && q.team!==p.team),bulletCover);
    for (const [target,amount] of hits) {
      if (this.phase!=="live") break;
      this.hit(p,target,weapon,Math.round(amount));
    }
  }
  hit(p,target,weapon,amount) {
    target.hp=Math.max(0,target.hp-amount);
    const damage = {type:"damage",attacker:p.id,id:target.id,hp:target.hp,head:false,weapon};
    p.peer?.send(damage);
    if (target.bot && target.hp && !p.bot && target.threat?.id!==p.id) {
      target.threat={id:p.id, next:this.tick+32+target.id, until:this.tick+300};
    }
    target.peer?.send(damage);
    if (!target.hp) {
      target.alive=false; target.deaths++; target.respawn=2000;
      p.kills++; p.score+=100; this.scores[p.team]++;
      if (this.career?.record(this.matchID, this.round, ++this.elimination, p, target, weapon)) {
        p.peer.send({type:"career",career:this.career.progress(p.profile)});
      }
      this.broadcast({type:"kill",round:this.round,killer:p.id,victim:target.id,kills:p.kills,weapon,head:false});
      if (this.scores[p.team]>=40) this.end();
      else this.roster();
    }
  }
  returnFire(bot) {
    const threat=bot.threat, enemy=this.players.find(p=>p.id===threat.id);
    if (!enemy?.alive || !enemy.peer || enemy.team===bot.team || this.tick>threat.until) {
      bot.threat=null;
      return;
    }
    if (this.tick<threat.next) return;
    threat.next=this.tick+12;
    const eye=[bot.x,bot.y+1.55,bot.z], target=[enemy.x,enemy.y+(enemy.crouch?0.9:1.2),enemy.z];
    const dx=target[0]-eye[0], dz=target[2]-eye[2], horizontal=Math.hypot(dx,dz);
    if (horizontal>30 || !clearSegment(eye,target,bulletCover)) return;
    bot.yaw=Math.atan2(-dx,-dz);
    const muzzle=[eye[0]+.2*Math.cos(bot.yaw)-.35*Math.sin(bot.yaw),eye[1]-.25,
      eye[2]-.2*Math.sin(bot.yaw)-.35*Math.cos(bot.yaw)];
    if (!clearSegment(eye,muzzle,bulletCover) || !clearSegment(muzzle,target,bulletCover)) return;
    if (!bot.ammo) { this.command(bot,{type:"reload"}); return; }
    bot.pitch=Math.atan2(target[1]-eye[1],horizontal);
    this.command(bot,{type:"shot",yaw:bot.yaw,pitch:bot.pitch});
    const cadence={recruit:75,regular:55,hardened:38,veteran:26};
    threat.next=this.tick+(cadence[this.difficulty] ?? cadence.regular);
  }
  step() {
    this.tick++;
    if (this.phase!=="live") return;
    this.remaining=Math.max(0,this.remaining-stepMs);
    if (!this.remaining) return this.end();
    for (const p of this.players) {
      if (!p.alive) {
        p.respawn=Math.max(0,p.respawn-stepMs);
        if (!p.respawn) { spawn(p); this.broadcast({type:"spawn",id:p.id}); }
        continue;
      }
      p.cooldown=Math.max(0,p.cooldown-stepMs);
      if (p.reload) {
        p.reload=Math.max(0,p.reload-stepMs);
        if (!p.reload) {
          const n=Math.min(p.reserve,specs[p.weapon].mag-p.ammo);
          p.inventory[p.weapon].ammo=p.ammo+=n; p.inventory[p.weapon].reserve=p.reserve-=n;
        }
      }
      if (p.bot && p.threat) this.returnFire(p);
      if (!p.bot) {
        const i=p.input;
        if (++p.inputAge>15) i.forward=i.right=i.buttons=0;
        world.move(p,i); p.ack=i.seq; p.yaw=i.yaw; p.pitch=i.pitch;
      }
    }
  }
  packet(viewer) {
    const visible = this.players.filter(target => visibleEnemy(viewer,target,map.walls));
    const b=Buffer.alloc(24+64*visible.length);
    b.writeUInt32LE(0x02014748); b.writeUInt32LE(this.tick>>>0,4); b.writeUInt32LE(Math.floor(this.tick*stepMs)>>>0,8);
    b[12]=phases.indexOf(this.phase); b[13]=visible.length; b.writeUInt16LE(this.scores[0],14);
    b.writeUInt16LE(this.scores[1],16); b.writeUInt32LE(Math.ceil(this.remaining),18); b.writeInt8(this.winner,22);
    visible.forEach((p,i)=>{
      const o=24+i*64;
      b.writeUInt32LE(p.id,o); b.writeUInt32LE(p.ack,o+4);
      ["x","y","z","vx","vy","vz","yaw","pitch"].forEach((k,j)=>b.writeFloatLE(p[k],o+8+j*4));
      ["hp","ammo","reserve","kills","deaths","score","respawn","reload"].forEach((k,j)=>b.writeUInt16LE(Math.min(65535,Math.ceil(p[k])),o+40+j*2));
      b[o+56]=p.team; b[o+57]=+p.alive | (+p.crouch<<1) | (+p.ground<<2) | (+(p.bot || !!p.peer)<<3) |
        (+p.jumpHeld<<5) | (+p.bot<<6) | (+p.sliding<<7);
      b[o+58]=WEAPONS.indexOf(p.weapon); b[o+59]=Math.round(p.slideCooldown*100);
      b.writeUInt16LE(Math.ceil(p.cooldown),o+60); b.writeUInt16LE(Math.round(p.slideTime*1000),o+62);
    });
    return b;
  }
}
