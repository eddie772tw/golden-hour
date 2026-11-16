// Explicit solo-only benchmark. Native bot/K9 updates and damage are never replaced.
import { commandAt, manifest as scripted, seedBenchmarkRandom } from './benchmark-scenario.js';

export const manifest = Object.freeze({
  version: 'solo-full-ai-v3', seed: scripted.seed, fixedDelta: 1 / 60, renderWallClock:true, totalTicks: 3600,
  player: scripted.player, botStarts: scripted.botStarts, botWeapons: scripted.botWeapons,
  control: 'Native decisions from fixed initial state, logical clock and per-actor RNG; outputs observed, not overwritten.',
  stimuli: { enemyK9ReadySeconds: 4, playerK9Ready: true, playerK9InputTicks: [480, 510, 540],
    playerGrenadeInputTicks: [180, 1980], deathTicks: [900, 1800, 2700], scoreLimit: 10000 },
  limits: [
    'All nine native bot updates run once per accepted tick, including their normal dead/respawn branch.',
    'Rendering uses the native clamped wall delta; fixed simulation time does not throttle shadow/reflection work.',
    'Perception, tactical decisions, navigation, attacks, damage, corpses, ragdolls, grenades and K9 remain native.',
    'Conditional branches keep native cadence; full AI does not mean executing mutually exclusive branches every tick.',
    'K9 initial charge/timer, player grenade inputs and scheduled deaths provide opportunities within 60 logic seconds.',
    'Bot grenade choices are unmodified native decisions; attempts, accepted throws and explosions are counted separately.',
    'No zero-damage, immortality or copied movement; player may die and native respawn changes the route.',
    'Logical decisions are intended to repeat approximately; exported decisions/coverage/state must be compared.',
    'Cosmetic pixels, driver/shader/audio wall clocks and exact physical trajectories are not guaranteed identical.',
    'Native corpse residual animation has a wall-clock fade; it is retained and may affect physical replay precision.',
    'Fresh isolated page only; this controller is single-use and stop pauses the altered test world.',
  ],
});

const legacyManifest = manifest;
const nativeLoopManifest = Object.freeze({ ...manifest,
  version: 'solo-full-ai-native-loop-v1', followNativeLoop: true,
  limits: [...manifest.limits,
    'Uses the real native solo accumulator: bounded 60 Hz logical ticks, at most three ticks per RAF.',
    'Rendering is independently capped at 60 Hz; a RAF may submit zero or one frame.',
    'Input edges are consumed once per logical tick. HUD and audio maintenance run once per visual submit.',
    'Wall timing and loop counter deltas are reported separately from deterministic logical state.'],
});

const round = n => Math.round(n * 1e6) / 1e6;
const pos = actor => [actor.pos.x, actor.pos.y, actor.pos.z].map(round);
const occupied = pool => pool.st.reduce((n, state) => n + Number(state !== 0), 0);

export async function installBenchmarkScenario(gh, { seed = legacyManifest.seed, followNativeLoop = false } = {}) {
  const manifest = followNativeLoop ? nativeLoopManifest : legacyManifest;
  const d = gh?.debug, document = d?.input?.el?.ownerDocument;
  if (!document || !new URL(document.defaultView.location.href).searchParams.has('solo') ||
      document.body.classList.contains('online-session')) throw Error('Full AI benchmark requires an isolated solo page');
  if (!gh.ready || gh.G.state !== 'playing' || gh.benchmark) throw Error('Deploy normally before installing one benchmark');
  const { ctx, input, player, match, physics, glass, fx, gfx, fpbody } = d;
  const bots = match.bots.slice(), actors = [player, ...bots], ids = new Map(actors.map((a, i) => [a, i]));
  if (bots.length !== 9 || bots.some((b, i) => b.def.id !== manifest.botWeapons[i])) throw Error('Native bot roster differs');
  const rng = seedBenchmarkRandom(seed), restores = [], events = [], checkpoints = [];
  const coverage = { botTicks: bots.map(() => 0), botAliveTicks: bots.map(() => 0), botDeadTicks: bots.map(() => 0),
    modes: {}, calls: {}, k9Phases: {}, k9ActiveTicks: 0, playerAliveTicks: 0, scheduledDeaths: 0,
    nativeFragQueued: 0, bodySubsteps: {}, perceptionLOS: { calls:0, clear:0 }, nadeOwner: {}, timeScaleTicks:{} };
  let tick = 0, frameOpen = false, stopped = false, audioEvent = 0, fxEvent = 0, shotEvent = 0, perceiving = false;
  const shots = actors.map(() => 0), decisionTrace = [], botCalls = bots.map(() => ({}));
  const timing = followNativeLoop ? { startWallMs: null, endWallMs: null, startLoopStats: null, endLoopStats: null,
    endBoundary: 'logical tick 3600 after input endFrame; final visual submit may follow' } : null;
  function loopSnapshot() {
    const stats = gh.loopStats;
    if (!stats) return null;
    return Object.fromEntries(['logicalTicks','renderFrames','playingRenders','logicalSeconds','activeSeconds','wallSeconds','dropped'].map(key => [key, stats[key]]));
  }
  function timingSnapshot() {
    const end = timing.endWallMs ?? performance.now(), endStats = timing.endLoopStats ?? loopSnapshot();
    const delta = timing.startLoopStats && endStats ? Object.fromEntries(Object.keys(endStats).map(key => [key, endStats[key] - timing.startLoopStats[key]])) : null;
    const elapsedMs = end - timing.startWallMs;
    return { ...timing, elapsedMs, loopStatsDelta: delta,
      logicalHz: delta && elapsedMs > 0 ? delta.logicalTicks * 1000 / elapsedMs : null,
      renderHz: delta && elapsedMs > 0 ? delta.renderFrames * 1000 / elapsedMs : null };
  }

  function count(key) { coverage.calls[key] = (coverage.calls[key] || 0) + 1; }
  function scoped(channel, fn) {
    const isolated = seedBenchmarkRandom((seed ^ Math.imul(tick, 0x9e3779b9) ^ Math.imul(channel, 0x85ebca6b)) >>> 0);
    try { return fn(); } finally { isolated.restore(); }
  }
  function patch(object, key, make) {
    if (typeof object?.[key] !== 'function') throw Error('Missing native benchmark path: ' + key);
    const own = Object.hasOwn(object, key), original = object[key], wrapped = make(original);
    object[key] = wrapped;
    restores.push(() => { if (object[key] === wrapped) { if (own) object[key] = original; else delete object[key]; } });
  }
  function observe(object, key, label = key) {
    patch(object, key, original => function (...args) { if (frameOpen) count(label); return original.apply(this, args); });
  }
  function clearInput() {
    for (const key of ['keys', 'down', 'up', 'touchKeys', 'touchDown', 'touchUp']) input[key]?.clear();
    for (const key of ['mx','my','wheel','touchForward','touchRight','touchMx','touchMy']) input[key] = 0;
  }
  function state() {
    return { tick, actors: actors.map((a, i) => ({ id:i, position:pos(a), yaw:round(a.yaw), alive:a.alive,
      health:round(a.health), ammo:i ? a.ammo : ctx.arsenal.slot.ammo, shots:shots[i], kills:a.kills, deaths:a.deaths,
      mode:a.mode, target:ids.get(a.target) ?? (a.target?.isK9 ? 'k9' : null), goal:a.goal, path:a.path?.slice(), pi:a.pi })),
      scores:match.scores.slice(), props:physics.props.filter(p => !p.dead).length,
      awakeBodies:physics.bodies.filter(b => !b.dead && !b.sleeping).length,
      ragdolls:physics.bodies.filter(b => !b.dead && b.type === 'rag').length,
      grenades:physics.bodies.filter(b => !b.dead && b.type === 'nade').length,
      k9:match.k9.units.map(u => ({ team:u.team, alive:u.alive, phase:u.phase, position:pos(u) })),
      glassActive:glass.active, chunks:occupied(physics.chunks), cases:occupied(physics.cases) };
  }
  const badge = document.createElement('div');
  badge.dataset.benchmarkScenario = manifest.version;
  badge.style.cssText = 'position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#18202de8;color:#ffdd77;padding:6px 12px;font:12px monospace;pointer-events:none';
  document.body.appendChild(badge);
  function label() { badge.textContent = `DIAGNOSTIC · ${manifest.version} · ${tick}/${manifest.totalTicks} · FULL NATIVE AI / live damage`; }

  try {
    // Reset before installing observers: setup is not counted as measured AI work.
    gh.G.state = 'paused'; gh.G.time = 0; gh.G.timeScale = 1; gh.G.freeCam = null;
    clearInput(); match.k9.reset(); physics.reset(); glass.reset(); ctx.resetWorld(); fx.reset?.();
    physics.chunks.i = physics.cases.i = 0;
    physics.time = 0; physics.h = physics.hPrev = manifest.fixedDelta / 2;
    const phaseRig = (rig, i) => { rig.time = 0; rig._br = ((seed >>> 0) % 6000 + i * 977) % 6000 / 1000;
      rig.phase = 0; rig.stepCool = 0; rig._peak = 0; rig.vy = 0; rig._warp = -1; };
    for (const [j,b] of bots.entries()) {
      for (const corpse of b.corpses.slice()) { corpse.char.root.visible = false; b._freeCorpse(corpse.char); }
      b.rigI = 0; b.char = b.rigs[0];
      for (const rig of b.rigs) phaseRig(rig,j+1);
      b.fragP = null; b.think = (j % 6) / 60; b.skill = .85 + (j % 5) * .07;
      b.wantYaw = undefined; b.wantYawK = 0; b.lastShot = -99; b._k9n = -1;
      b.kills = b.deaths = b.score = b.streak = 0;
    }
    if (fpbody) { phaseRig(fpbody.op,100); fpbody.reset(); }
    if (ctx.vm) { ctx.vm.t = 0; for (const s of [...Object.values(ctx.vm.sp),...Object.values(ctx.vm.mv)]) s.reset(); }
    ctx.settings.primary = manifest.player.weapon; ctx.arsenal.reset(manifest.player.weapon); ctx.arsenal.recoil.seed(seed);
    player.spawn(...manifest.player.spawn,0); player.spawnT = 0;
    player.kills = player.deaths = player.score = player.streak = 0;
    player.stats.shots = player.stats.hits = player.stats.head = 0;
    for (const [j,b] of bots.entries()) scoped(j+1,() => b.spawn(...manifest.botStarts[j],0));
    match.state = 'live'; match.live = true; match.time = 3600; match.scores = [0,0];
    const oldLimit = match.scoreLimit; match.scoreLimit = manifest.stimuli.scoreLimit;
    restores.push(() => { match.scoreLimit = oldLimit; });
    match.feed.length = 0; match.lastFrag = -99; match.lastKillT = -99; match.multi = 0; match.respawnT = 3.6;
    match.k9.charge = 1; match.k9.enemyT = manifest.stimuli.enemyK9ReadySeconds;
    await gfx.whenReady?.();

    // Sound/FX randomness must not affect a bot's next tactical decision.
    const seen = new Set();
    function isolateAudio(object) {
      if (!object || seen.has(object)) return;
      seen.add(object);
      for (const [key,value] of Object.entries(object)) {
        if (typeof value === 'function') patch(object,key,original => function (...args) {
          return frameOpen ? scoped(100000 + ++audioEvent,() => original.apply(this,args)) : original.apply(this,args);
        });
        else if (value && typeof value === 'object' && (!key.startsWith('_') || key === '_debug')) isolateAudio(value);
      }
    }
    isolateAudio(ctx.audio);
    const prototype = Object.getPrototypeOf(fx);
    for (const key of new Set([...Object.keys(fx),...(prototype === Object.prototype ? [] : Object.getOwnPropertyNames(prototype))]))
      if (key !== 'constructor' && key !== 'update' && !key.startsWith('_') && typeof fx[key] === 'function')
        patch(fx,key,original => function (...args) {
          return frameOpen ? scoped(200000 + ++fxEvent,() => original.apply(this,args)) : original.apply(this,args);
        });
    patch(ctx.combat,'fire',original => function (actor,...args) {
      if (!frameOpen) return original.call(this,actor,...args);
      const id = ids.get(actor);
      if (id !== undefined) { shots[id]++; events.push({type:'shot',tick,actor:id,weapon:args[2].id}); }
      return scoped(300000 + ++shotEvent,() => original.call(this,actor,...args));
    });
    patch(match,'damage',original => function (actor,amount,attacker,info) {
      if (frameOpen) events.push({type:'damage',tick,actor:ids.get(actor) ?? 'k9',amount:round(amount),weapon:info?.weapon});
      return original.call(this,actor,amount,attacker,info);
    });
    patch(match,'respawn',original => function (actor,...args) {
      if (!frameOpen) return original.call(this,actor,...args);
      count('respawn'); events.push({type:'respawn',tick,actor:ids.get(actor)});
      return scoped(400 + (ids.get(actor) ?? 99),() => original.call(this,actor,...args));
    });
    observe(physics,'addRagdoll');
    patch(physics,'throwGrenade',original => function (...args) {
      if(frameOpen) { count('throwGrenade'); const id=ids.get(args[4]) ?? 'other';
        coverage.nadeOwner[id]=(coverage.nadeOwner[id] || 0)+1; events.push({type:'grenade-born',tick,actor:id}); }
      return original.apply(this,args);
    });
    patch(physics,'_step',original => function (body,...args) {
      if(frameOpen) coverage.bodySubsteps[body.type]=(coverage.bodySubsteps[body.type] || 0)+1;
      return original.call(this,body,...args);
    });
    observe(ctx.combat,'explode','grenadeExplode');
    patch(d.nav,'path',original => function (...args) {
      const path=original.apply(this,args);
      if(frameOpen) { count('nav.path'); events.push({type:'path',tick,from:args[0],to:args[1],nodes:path.slice()}); }
      return path;
    });
    patch(d.world,'clear',original => function (...args) {
      const value=original.apply(this,args);
      if(frameOpen && perceiving) { coverage.perceptionLOS.calls++; if(value)coverage.perceptionLOS.clear++; }
      return value;
    });
    observe(match.k9,'_enemyTimer','k9.enemyTimer'); observe(match.k9,'_enemyThrow','k9.enemyThrow');
    observe(match.k9,'release','k9.release');
    for (const [j,bot] of bots.entries()) {
      for (const key of ['_perceive','_pickGoal','_goTo','_maybeFrag','die']) patch(bot,key,original => function (...args) {
        if (frameOpen) { count(key); botCalls[j][key] = (botCalls[j][key] || 0) + 1; }
        const was=perceiving, pending=this.fragP;
        if(key==='_perceive')perceiving=true;
        try { return original.apply(this,args); }
        finally {
          perceiving=was;
          if(frameOpen && key==='_maybeFrag' && !pending && this.fragP) {
            coverage.nativeFragQueued++; events.push({type:'native-frag-queued',tick,actor:j+1});
          }
        }
      });
      patch(bot,'update',original => function (dt,...args) {
        if (!frameOpen) return original.call(this,dt,...args);
        coverage.botTicks[j]++; coverage[this.alive ? 'botAliveTicks' : 'botDeadTicks'][j]++;
        coverage.modes[this.mode] = (coverage.modes[this.mode] || 0) + 1;
        return scoped(j+1,() => original.call(this,dt,...args));
      });
    }
    const instrumentedUnits = new Set();
    function instrumentUnit(unit) {
      if(instrumentedUnits.has(unit))return;
      instrumentedUnits.add(unit);
      const team=unit.team,index=match.k9.pool[team].indexOf(unit);
      for (const key of ['_brain','_think','_pickTarget','_route','_plan','_attack','_leap','_takedown','_wreck'])
        observe(unit,key,'k9.'+key);
      patch(unit,'update',original => function (...args) {
        if (!frameOpen) return original.apply(this,args);
        count('k9.unitUpdate'); coverage.k9Phases[this.phase] = (coverage.k9Phases[this.phase] || 0) + 1;
        if (this.alive) coverage.k9ActiveTicks++;
        return scoped(500+team*10+index,() => original.apply(this,args));
      });
    }
    for (const pool of match.k9.pool) for (const unit of pool) instrumentUnit(unit);
    patch(match.k9,'_make',original => function (...args) { const unit=original.apply(this,args);instrumentUnit(unit);return unit; });
    for (const [object,channel] of [[match,30],[physics,31],[glass,32],[fx,33]])
      patch(object,'update',original => function (...args) {
        return frameOpen ? scoped(channel,() => original.apply(this,args)) : original.apply(this,args);
      });

    function stimuli() {
      if (manifest.stimuli.deathTicks.includes(tick)) {
        const bot = bots[Math.floor(tick/900)*3-2];
        const attacker = bots.find(b => b.team !== bot.team && b.alive);
        events.push({type:'death-stimulus',tick,actor:ids.get(bot),alreadyDead:!bot.alive});
        if (bot.alive) { coverage.scheduledDeaths++; match.damage(bot,1000,attacker || bot,{weapon:'ar',dir:bot.vel,point:bot.pos}); }
      }
    }
    patch(player,'update',original => function (dt,...args) {
      if (stopped || tick >= manifest.totalTicks) return;
      if (Math.abs(dt-manifest.fixedDelta)>1e-10) throw Error('Full AI benchmark requires fixedDelta for the whole native frame');
      tick++; frameOpen = true; audioEvent = fxEvent = shotEvent = 0;
      coverage.timeScaleTicks[gh.G.timeScale]=(coverage.timeScaleTicks[gh.G.timeScale] || 0)+1;
      rng.reset((seed ^ Math.imul(tick,0x9e3779b9)) >>> 0);
      clearInput(); input.enabled = true;
      if (this.alive) {
        coverage.playerAliveTicks++;
        const c=commandAt(tick), dx=c.look[0]-this.e.x, dz=c.look[2]-this.e.z;
        this.yaw=Math.atan2(-dx,-dz); this.pitch=Math.atan2(c.look[1]-this.e.y-1.62,Math.hypot(dx,dz));
        const mx=c.target[0]-this.e.x,mz=c.target[1]-this.e.z;
        if (Math.hypot(mx,mz)>.2) {
          const f=-Math.sin(this.yaw)*mx-Math.cos(this.yaw)*mz,r=Math.cos(this.yaw)*mx-Math.sin(this.yaw)*mz;
          if (Math.abs(f)>.1) input.keys.add(f>0?'KeyW':'KeyS');
          if (Math.abs(r)>.1) input.keys.add(r>0?'KeyD':'KeyA');
        }
        if(c.fire && tick%24<12) input.keys.add('Mouse0');
        if(c.reload) input.down.add('KeyR');
        if(manifest.stimuli.playerK9InputTicks.includes(tick)) input.down.add('KeyB');
        if(manifest.stimuli.playerGrenadeInputTicks.includes(tick)) input.down.add('KeyG');
      }
      stimuli();
      return original.call(this,dt,...args);
    });
    patch(input,'endFrame',original => function (...args) {
      const value=original.apply(this,args);
      if(frameOpen) {
        frameOpen=false;
        if(tick%60===0) {
          checkpoints.push(state());
          decisionTrace.push({tick,bots:bots.map(b => [b.alive,b.mode,ids.get(b.target) ?? (b.target?.isK9?'k9':null),b.goal,b.pi,b.ammo]),
            k9:match.k9.units.map(u => [u.team,u.alive,u.phase,ids.get(u.target) ?? null])}); label();
        }
        if(tick===manifest.totalTicks) {
          gh.G.state='paused'; clearInput();
          if(timing) timing.endWallMs=performance.now(), timing.endLoopStats=loopSnapshot();
        }
      }
      return value;
    });
    checkpoints.push(state()); label();
    const controller={ manifest,fixedDelta:manifest.fixedDelta,renderWallClock:true,...(followNativeLoop?{followNativeLoop:true}:{}),get tick(){return tick;},get done(){return tick>=manifest.totalTicks;},
      export(){return JSON.parse(JSON.stringify({manifest,seed:seed>>>0,tick,done:this.done,state:state(),coverage,botCalls,
        decisionTrace,checkpoints,events,equipment:{player:ctx.arsenal.slots.map(s=>({id:s.def.id,profileId:s.def.profileId,build:s.def.build})),
          bots:bots.map(b=>({id:b.def.id,build:b.build}))},...(timing?{timing:timingSnapshot()}:{} )}));},
      stop(){if(stopped)return;stopped=true;frameOpen=false;gh.G.state='paused';clearInput();
        for(const undo of restores.reverse())undo();rng.restore();badge.remove();if(gh.benchmark===this)delete gh.benchmark;}
    };
    if(timing) timing.startWallMs=performance.now(), timing.startLoopStats=loopSnapshot();
    gh.benchmark=controller;gh.G.state='playing';return controller;
  } catch(error) {
    for(const undo of restores.reverse())undo();rng.restore();badge.remove();gh.G.state='paused';throw error;
  }
}
