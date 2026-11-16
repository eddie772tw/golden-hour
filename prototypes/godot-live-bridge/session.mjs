// Reuse the frozen, independently 8/8-verified setup; do not fork gameplay logic.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {LOGIC,REPO} from './logic.mjs';
const [{buildWorld},{applyInitialProps},{readFixtures},{VirtualAudioContext}]=await Promise.all(
  ['world-probe.mjs','initial-props.mjs','fixtures.mjs','virtual-audio.mjs'].map(file=>import(new URL(file,LOGIC))));
const {seedBenchmarkRandom}=await import(new URL('game/client/benchmark-scenario.js',REPO));
const {installBenchmarkScenario}=await import(new URL('game/client/benchmark-full-ai.js',REPO));
// Read the published LF Gate A source, never a private work-directory copy.
const source=readFileSync(new URL('authoritative-probe.mjs',LOGIC),'utf8');
export const setupSHA256=createHash('sha256').update(source).digest('hex');
assert.equal(setupSHA256,'9668f729c2d49bb45a779f9e5e34f8046b8b0d82462682d60ecfd840261a56d8','Published frozen Gate A setup changed');
const begin=source.indexOf('  const fixtures=readFixtures();');
const end=source.indexOf('  controller=await installBenchmarkScenario',begin);
assert.ok(begin>0&&end>begin);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const factory=new AsyncFunction('report','buildWorld','applyInitialProps','readFixtures','VirtualAudioContext',
  'seedBenchmarkRandom','installBenchmarkScenario',`
  const seed=seedBenchmarkRandom();let graph,controller,audioContext;
  try {
    ${source.slice(begin,end)}
    return {graph,gh,audioContext,fixtures,
      async startController() {
        if(controller)throw Error('Single-use session already started');
        controller=await installBenchmarkScenario(gh,{followNativeLoop:true});
        const simulate=r.makeSimulation(graph);
        graph.scene.updateMatrixWorld();graph.gfx.vmScene.updateMatrixWorld();
        return {controller,simulate};
      },
      close(){controller?.stop();seed.restore();}
    };
  } catch(error){controller?.stop();seed.restore();throw error;}
`);
export function createSession(report) {
  return factory(report,buildWorld,applyInitialProps,readFixtures,VirtualAudioContext,seedBenchmarkRandom,installBenchmarkScenario);
}
