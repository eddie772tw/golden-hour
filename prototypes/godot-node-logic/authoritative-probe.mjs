// CPU Gate A: actual owning world/classes and exact extracted ghSimulate body.
// Fixed logical stepping is not a render loop or a Godot performance result.
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {buildWorld} from './world-probe.mjs';
import {applyInitialProps} from './initial-props.mjs';
import {readFixtures} from './fixtures.mjs';
import {REPO} from './load-runtime.mjs';
import {VirtualAudioContext} from './virtual-audio.mjs';
import * as nativeCanvas from './native-canvas.mjs';
const {seedBenchmarkRandom}=await import(new URL('game/client/benchmark-scenario.js',REPO));
const {installBenchmarkScenario}=await import(new URL('game/client/benchmark-full-ai.js',REPO));
const report={kind:'node-original-authoritative-GateA',fullFixturePassed:false,logicalTicksExecuted:0,
  allEightExportsCompared:false,stages:[],platformCalls:[],nativeCanvas:nativeCanvas.metadata,
  limits:['CPU logic proof only; no browser/Godot/GPU/audio hardware.',
    'Fixed logical steps exercise the owning ghSimulate body; native RAF cadence/IPC/pose age not tested.',
    'Canvas backend uses Windows fonts with real rasterization; Chrome pixel parity not claimed.',
    'HUD output is a recorded presentation boundary; original hit/score UI audio is forwarded; full DOM animation not executed.',
    'Virtual audio records original graph and scheduled ended bookkeeping; no DSP fidelity acceptance.']};
report.implementationSHA256=Object.fromEntries(['authoritative-probe.mjs','world-probe.mjs','load-runtime.mjs','asset-boot.mjs','native-canvas.mjs','virtual-audio.mjs','initial-props.mjs','fixtures.mjs','package-lock.json'].map(file=>
  [file,createHash('sha256').update(readFileSync(new URL(file,import.meta.url))).digest('hex')]));
const seed=seedBenchmarkRandom();let graph,controller,audioContext;
const tickLimit=Number(process.argv.find(x=>x.startsWith('--ticks='))?.slice(8)??3600);
try {
  const fixtures=readFixtures();report.fixtureProvenance=fixtures.provenance;
  graph=buildWorld(report);const r=graph.runtime;
  const initialPropsPath=process.argv.find(x=>x.startsWith('--initial-props='))?.slice(16);
  if(!process.argv.includes('--no-initial-props'))report.initialWorldConfig=applyInitialProps(graph,initialPropsPath||fixtures.initialURL);
  const document=graph.hostContext.document;
  document.defaultView=graph.hostContext;document.body={classList:{contains:()=>false},appendChild:node=>node};
  const originalCreate=document.createElement;
  document.createElement=type=>type==='div'?{dataset:{},style:{},remove(){},textContent:''}:originalCreate(type);
  const input=new r.Input({ownerDocument:document});
  const outputCalls={};let hitT=-Infinity;
  const hud={stat:{streak:0,medals:{},unlocked:[]},map:{blips:[]}};
  for(const key of ['loading','attach','damageFrom','died','respawnIn','respawned','killfeed','count','matchStart','k9','hint','banner','unlock'])
    hud[key]=()=>{outputCalls[key]=(outputCalls[key]??0)+1;};
  hud.matchEnd=()=>{throw Error('Unexpected match end during fixed fixture');};
  hud.hit=(head,kill)=>{const now=performance.now();if(!kill&&now-hitT<45)return;hitT=now;r.audio.hitmarker(kill?'kill':head?'head':'body');};
  hud.kill=(victim,medals)=>{for(const name of medals)hud.stat.medals[name]=(hud.stat.medals[name]??0)+1;r.audio.ui(medals.length?'medal':'score');};
  hud.update=(dt,{player})=>{hud.stat.streak=Math.max(hud.stat.streak,player.streak);};
  console.log('START original-player/VM/arsenal/combat/match/9bots');const at=performance.now();
  const gameplay=await r.setupGameplay({...graph,input,hud});Object.assign(graph,gameplay,{input,hud});
  for(const gun of Object.values(gameplay.vm.guns))if(gun.warm){let count=0;while(gun.warm())if(++count>32)throw Error('Unbounded owning weapon warm');}
  // Original renderer preparation creates this lazy material before live bullets.
  // Cloning a Three Material consumes UUID RNG; omitting this changes first fracture.
  const paneProbe=graph.glass._preparePaneMaterial();paneProbe.removeFromParent();paneProbe.geometry.dispose();
  const fadeMaterials=new Set();
  for(const bot of gameplay.match.bots)for(const rig of bot.rigs)if(!fadeMaterials.has(rig._mat)) {
    fadeMaterials.add(rig._mat);rig._prepareFade()();
  }
  report.stages.push({name:'original-player/VM/arsenal/combat/match/9bots',ok:true,elapsedMs:performance.now()-at});
  report.actors={bots:gameplay.match.bots.length,rigs:gameplay.match.bots.flatMap(b=>b.rigs).length,
    originalUpdate:gameplay.match.bots.every(b=>b.update===r.Bot.prototype.update),
    originalPhysics:graph.physics.update===r.Physics.prototype.update};
  report.originalMethods=Object.fromEntries([
    ['player',gameplay.player,r.Player],['viewmodel',gameplay.vm,r.VM],['firstPerson',gameplay.fpbody,r.FirstPerson],
    ['arsenal',gameplay.arsenal,r.Arsenal],['match',gameplay.match,r.Match],['K9',gameplay.match.k9,r.K9],
    ['physics',graph.physics,r.Physics],['glass',graph.glass,r.Glass],['FX',graph.fx,r.FX]
  ].map(([name,object,Class])=>[name,object.update===Class.prototype.update]));
  report.originalMethods.combatFrame=gameplay.combat.frame===r.Combat.prototype.frame;
  report.originalMethods.combatFire=gameplay.combat.fire===r.Combat.prototype.fire;
  report.originalMethods.inputEndFrame=input.endFrame===r.Input.prototype.endFrame;
  report.clock={kind:'CPU fixed-step semantic proof, not real-time',fixedDelta:1/60,
    simulation:'Exact owning ghSimulate body; no actor update replacement',
    RNG:'Original seedBenchmarkRandom and original full-AI per-tick/per-actor/subsystem scopes; VM shares host Math',
    sharedMath:graph.hostContext.Math===Math,
    audio:'Virtual sample clock advances 1/60 per logic tick; original audio maintenance once per modeled submit',
    modeledPresentationHz:60,nativeRAFTested:false,IPCMeasured:false};
  report.sourceSHA256=graph.sourceSHA256;
  console.log('START original-eZ-init/real-PCM/virtual-hardware');const audioAt=performance.now();
  audioContext=new VirtualAudioContext();
  if(!r.audio.init({context:audioContext}))throw Error('Original audio init failed: '+r.audio._errors.join(';'));
  r.audio.setVolumes({master:.8,sfx:1,music:.6});r.audio.setOcclusionTester((a,b)=>!graph.world.clear(a,b));
  if(r.audio._errors.length)throw Error('Audio errors: '+r.audio._errors.join(';'));
  report.stages.push({name:'original-eZ-init/real-PCM/virtual-hardware',ok:true,elapsedMs:performance.now()-audioAt});
  const gh=graph.hostContext.GH;gh.ready=true;gh.G.state='playing';
  gh.debug={...graph,ctx:gameplay.ctx};
  controller=await installBenchmarkScenario(gh,{followNativeLoop:true});
  const simulate=r.makeSimulation(graph);
  graph.scene.updateMatrixWorld();graph.gfx.vmScene.updateMatrixWorld();
  report.lateBoxCheckpoints=[];
  console.log('START original-full-AI-ticks');
  for(let tick=1;tick<=Math.min(tickLimit,controller.manifest.totalTicks);tick++) {
    audioContext.advance((tick-1)/60,tick);simulate(1/60,true);
    // Presentation cadence model is explicit 60 Hz for Gate A only.
    input.endFrame();r.audio.update(1/60);hud.update(1/60,{player:gameplay.player});
    // Preserve the CPU transform snapshot normally owned by BM.render, without WebGL.
    graph.scene.updateMatrixWorld();graph.gfx.vmScene.updateMatrixWorld();
    report.logicalTicksExecuted=controller.tick;
    if(tick>=2640&&tick<=3000&&tick%60===0)report.lateBoxCheckpoints.push({tick,
      boxes:graph.physics.bodies.map((body,index)=>({body,index})).filter(({body})=>body.type==='box'&&!body.dead&&!body.sleeping).map(({body,index})=>({
        index,propIndex:graph.physics.props.indexOf(body),name:body.obj?.name,temp:body.temp??false,life:body.life??null,
        cx:body.cx,cy:body.cy,cz:body.cz,still:body.still,home:body.home?.p.toArray(),
        x:Array.from(body.x),previous:Array.from(body.o)}))});
    if(r.audio._errors.length)throw Error('Audio errors: '+r.audio._errors.join(';'));
    if(tick%600===0)console.log('TICK',tick);
  }
  report.scenario=controller.export();report.completed=controller.done;
  report.nativeCoverage={allNineBots3600:report.scenario.coverage.botTicks.length===9&&report.scenario.coverage.botTicks.every(n=>n===3600),
    botTicks:report.scenario.coverage.botTicks,calls:report.scenario.coverage.calls,
    bodySubsteps:report.scenario.coverage.bodySubsteps,perceptionLOS:report.scenario.coverage.perceptionLOS};
  const reference=fixtures.baseline;
  const keys=['manifest','seed','equipment','decisionTrace','events','checkpoints','state','coverage'];
  report.reference='fixtures/baseline.json';
  report.exportsEqual=Object.fromEntries(keys.map(key=>[key,isDeepStrictEqual(report.scenario[key],reference[key])]));
  report.botCallsEqual=isDeepStrictEqual(report.scenario.botCalls,reference.botCalls);
  report.allEightExportsCompared=true;
  report.fullFixturePassed=controller.done&&Object.values(report.exportsEqual).every(Boolean);
  report.hudOutputCalls=outputCalls;
} catch(error){report.error=String(error);report.stack=error.stack;}
finally {
  if(controller&&!report.scenario){report.partialScenario=controller.export();report.logicalTicksExecuted=controller.tick;}
  if(audioContext)report.audio={...audioContext.snapshot(),engine:graph?.runtime.audio._engine.stats,errors:graph?.runtime.audio._errors};
  controller?.stop();seed.restore();
}
const name=process.argv.find(x=>x.startsWith('--name='))?.slice(7)??'authoritative-probe';
if(!/^[\w-]+$/.test(name))throw Error('Simple evidence name required');
mkdirSync(new URL('./evidence/',import.meta.url),{recursive:true});
writeFileSync(new URL('./evidence/'+name+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({fullFixturePassed:report.fullFixturePassed,logicalTicksExecuted:report.logicalTicksExecuted,error:report.error,exportsEqual:report.exportsEqual,audio:report.audio},null,2));
process.exitCode=report.fullFixturePassed?0:2;
