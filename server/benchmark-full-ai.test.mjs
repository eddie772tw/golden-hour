import test from 'node:test';
import assert from 'node:assert/strict';
import { installBenchmarkScenario, manifest } from '../game/client/benchmark-full-ai.js';

function fixture() {
  const vector = () => ({x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});return this;},
    copy(v){return this.set(v.x,v.y,v.z);},distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z);}});
  const document={defaultView:{location:{href:'http://localhost/?solo'}},body:{classList:{contains(){return false;}},appendChild(){}},
    createElement(){return {dataset:{},style:{},remove(){}};}};
  const input={el:{ownerDocument:document},endFrame(){this.down.clear();}};
  for(const k of ['keys','down','up','touchKeys','touchDown','touchUp'])input[k]=new Set();
  const bodies=[],nativeCalls=Array(9).fill(0),damageAmounts=[];
  const physics={props:[],bodies,chunks:{st:new Uint8Array(3)},cases:{st:new Uint8Array(3)},reset(){bodies.length=0;},
    addRagdoll(){const b={type:'rag'};bodies.push(b);return b;},throwGrenade(){bodies.push({type:'nade'});},_step(){},
    update(){for(const b of bodies)this._step(b);}};
  const nav={path(from,to){return [from,to];}},world={clear(){return true;}};
  const audio={shot(){Math.random();}},fx={reset(){},update(){},muzzle(){Math.random();}};
  const combat={fire(){audio.shot();fx.muzzle();},explode(){}};
  let match;
  function actor(id,j) {
    const rig=()=>({root:{visible:true},reset(){}}),a={def:{id,mag:30},build:{},e:{},pos:vector(),vel:vector(),yaw:0,
      rigs:[rig(),rig()],corpses:[],alive:true,health:100,kills:0,deaths:0,score:0,streak:0,ammo:30,
      spawn(x,y,z,yaw){this.pos.set(x,y,z);Object.assign(this.e,{x,y,z});this.yaw=yaw;this.alive=true;this.health=100;this.path=[];},
      _freeCorpse(){},_perceive(){world.clear();this.mode='engage';},_pickGoal(){},
      _goTo(goal){this.path=nav.path(0,goal);this.goal=goal;},_maybeFrag(){this.fragP={t:1};},
      die(){this.alive=false;this.health=0;this.deaths++;physics.addRagdoll();},
      update(dt){nativeCalls[j]++;if(!this.alive){match.respawn(this);return;}
        this._perceive(dt);this._goTo(2);this._maybeFrag();
        this.pos.x+=Math.random();this.ammo--;combat.fire(this,null,null,this.def);}};
    a.char=a.rigs[0];return a;
  }
  const player=actor('ar',0);player.team=0;player.stats={shots:0,hits:0,head:0};player.update=()=>{};
  const bots=manifest.botWeapons.map((id,j)=>{const b=actor(id,j);b.team=j<4?0:1;return b;});
  function unit(team){const u={team,pos:vector(),alive:true,inUse:true,phase:'hunt',update(){this._brain();}};
    for(const k of ['_brain','_think','_pickTarget','_route','_plan','_attack','_leap','_takedown','_wreck'])u[k]=()=>{};
    return u;}
  const k9={pool:[[unit(0)],[unit(1)]],units:[],reset(){},_enemyTimer(){},_enemyThrow(){},release(){},
    _make(team){const u=unit(team);this.pool[team].push(u);return u;},
    update(){this._enemyTimer();for(const p of this.pool)for(const u of p)u.update();}};
  match={bots,k9,scores:[0,0],feed:[],scoreLimit:75,damage(a,n){damageAmounts.push(n);a.health-=n;if(a.health<=0)a.die();},
    respawn(a){a.spawn(1,0,1,0);},update(){this.k9.update();}};
  const arsenal={slot:{ammo:30},slots:[{def:{id:'ar'}}],reset(){},recoil:{seed(){}}};
  const glass={active:0,reset(){},update(){}};
  const ctx={physics,world,nav,audio,fx,combat,match,player,arsenal,glass,settings:{},resetWorld(){}};
  const gh={ready:true,G:{state:'playing',timeScale:1},debug:{ctx,input,player,match,physics,world,nav,fx,glass,
    gfx:{async whenReady(){}}}};
  function step(){gh.G.time+=manifest.fixedDelta;player.update(manifest.fixedDelta);
    for(const bot of bots)bot.update(manifest.fixedDelta);match.update(manifest.fixedDelta);
    physics.update(manifest.fixedDelta);glass.update(manifest.fixedDelta);fx.update(manifest.fixedDelta);input.endFrame();}
  return {gh,step,nativeCalls,damageAmounts};
}

test('full AI executes native updates once, retains real damage and observes dynamic K9 units',async()=>{
  const f=fixture(),{gh}=f,originalUpdate=gh.debug.match.bots[0].update,originalDamage=gh.debug.match.damage,random=Math.random;
  const c=await installBenchmarkScenario(gh);
  try {
    f.step();gh.debug.match.damage(gh.debug.match.bots[0],120);
    assert.equal(gh.debug.match.bots[0].alive,false);
    const extra=gh.debug.match.k9._make(0);
    f.step();
    const r=c.export();
    assert.deepEqual(f.nativeCalls,Array(9).fill(2));
    assert.deepEqual(r.coverage.botTicks,Array(9).fill(2));
    assert.equal(f.damageAmounts[0],120);
    assert.equal(r.coverage.botDeadTicks[0],1);
    assert.equal(r.coverage.calls['k9.unitUpdate'],5,'new pool unit must be observed too');
    assert.ok(Object.hasOwn(extra,'update'));
    assert.ok(r.coverage.bodySubsteps.rag>0);
    assert.ok(r.coverage.perceptionLOS.calls>0);
    assert.throws(()=>gh.debug.player.update(.05),/fixedDelta/);
  } finally {c.stop();}
  assert.equal(gh.debug.match.bots[0].update,originalUpdate);
  assert.equal(gh.debug.match.damage,originalDamage);
  assert.equal(gh.debug.match.scoreLimit,75);
  assert.equal(Math.random,random);
  assert.equal(gh.benchmark,undefined);
});

test('full AI seeded decisions resist ambient random consumption without replaying actions',async()=>{
  async function replay(ambient){const f=fixture(),c=await installBenchmarkScenario(f.gh);
    try {for(let i=0;i<60;i++){for(let j=0;j<ambient;j++)Math.random();f.step();}
      return c.export();}finally{c.stop();}}
  assert.deepEqual(await replay(0),await replay(17));
});

test('full AI installer rejects online and unmarked pages',async()=>{
  const f=fixture();f.gh.debug.input.el.ownerDocument.defaultView.location.href='http://localhost/';
  await assert.rejects(installBenchmarkScenario(f.gh),/isolated solo/);
  f.gh.debug.input.el.ownerDocument.defaultView.location.href='http://localhost/?solo';
  f.gh.debug.input.el.ownerDocument.body.classList.contains=()=>true;
  await assert.rejects(installBenchmarkScenario(f.gh),/isolated solo/);
});

test('default v3 keeps its export shape while native-loop opt-in adds a versioned manifest and timing',async()=>{
  const legacy=fixture(),old=await installBenchmarkScenario(legacy.gh);
  try {
    const result=old.export();
    assert.equal(old.manifest,manifest);
    assert.equal(result.manifest.version,'solo-full-ai-v3');
    assert.equal(Object.hasOwn(old,'followNativeLoop'),false);
    assert.equal(Object.hasOwn(result,'timing'),false);
  } finally {old.stop();}
  const f=fixture();
  f.gh.loopStats={logicalTicks:10,renderFrames:8,playingRenders:8,logicalSeconds:10/60,activeSeconds:.2,wallSeconds:.2,dropped:0};
  const c=await installBenchmarkScenario(f.gh,{followNativeLoop:true});
  try {
    assert.equal(c.followNativeLoop,true);
    assert.equal(c.manifest.version,'solo-full-ai-native-loop-v1');
    assert.equal(c.manifest.totalTicks,3600);
    for(let i=0;i<2;i++) {
      f.gh.loopStats.logicalTicks++; f.gh.loopStats.logicalSeconds+=1/60;
      f.gh.loopStats.renderFrames++; f.step();
    }
    const result=c.export();
    assert.deepEqual(result.coverage.botTicks,Array(9).fill(2));
    assert.equal(result.timing.loopStatsDelta.logicalTicks,2);
    assert.equal(result.timing.loopStatsDelta.renderFrames,2);
    assert.ok(result.timing.startWallMs>=0);
    assert.equal(result.timing.endWallMs,null);
    assert.ok(result.timing.elapsedMs>=0);
  } finally {c.stop();}
});

test('native-loop full AI completion records logical tick 3600 timing without disabling native AI',async()=>{
  const f=fixture();
  f.gh.loopStats={logicalTicks:0,renderFrames:0,playingRenders:0,logicalSeconds:0,activeSeconds:0,wallSeconds:0,dropped:0};
  const c=await installBenchmarkScenario(f.gh,{followNativeLoop:true});
  try {
    for(let i=0;i<3600;i++) {
      f.gh.loopStats.logicalTicks++; f.gh.loopStats.logicalSeconds+=1/60;
      if(i%4!==3)f.gh.loopStats.renderFrames++;
      f.step();
    }
    const result=c.export();
    assert.equal(c.done,true);
    assert.equal(f.gh.G.state,'paused');
    assert.deepEqual(result.coverage.botTicks,Array(9).fill(3600));
    assert.equal(result.timing.loopStatsDelta.logicalTicks,3600);
    assert.equal(result.timing.loopStatsDelta.renderFrames,2700);
    assert.ok(result.timing.endWallMs>=result.timing.startWallMs);
    assert.ok(Math.abs(result.timing.logicalHz-3600000/result.timing.elapsedMs)<1e-6);
  } finally {c.stop();}
});
