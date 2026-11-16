// Immutable, pre-deploy world configuration. Never contains actor/live body poses.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export function applyInitialProps(graph,path,{seed=0x47484d31}={}) {
  const bytes=readFileSync(path),raw=JSON.parse(bytes),input=raw.initializer;
  assert.equal(raw.ok,true);assert.equal(raw.godotInitializationCaptureOnly,true);
  assert.equal(raw.coreSHA256,graph.sourceSHA256);assert.deepEqual(raw.consoleErrors,[]);
  assert.equal(input.schema,'gh-browser-initial-world-v1');assert.equal(input.seed,seed);
  assert.equal(input.state,'menu');assert.equal(input.tick,null);
  assert.equal(input.world.cols,graph.world.cols.length);
  assert.equal(input.world.panes,graph.glass.panes.length);
  assert.equal(input.world.nodes,graph.nav.nodes.length);
  assert.equal(input.world.props,graph.physics.props.length);
  assert.equal(input.props.length,graph.physics.props.length);
  const differences=[];
  // Validate the entire input before changing any native home settings.
  for(const [index,item]of input.props.entries()) {
    const body=graph.physics.props[index];
    assert.equal(item.index,index);assert.equal(item.name,body.obj.name);
    assert.equal(item.type,'box');assert.equal(body.type,'box');assert.equal(item.temp,false);
    assert.ok(!body.temp);assert.ok(!body.dead);assert.equal(item.homeS,null);
    assert.ok(Array.isArray(item.homeP)&&item.homeP.length===3&&item.homeP.every(Number.isFinite));
    assert.ok(Array.isArray(item.homeQ)&&item.homeQ.length===4&&item.homeQ.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...item.homeQ)-1)<1e-6);
    const previousP=body.home.p.toArray([]),previousQ=body.home.q.toArray([]);
    if(!isDeepStrictEqual(previousP,item.homeP)||!isDeepStrictEqual(previousQ,item.homeQ))
      differences.push({index,name:item.name,previousP,previousQ,homeP:item.homeP,homeQ:item.homeQ});
  }
  for(const item of input.props) {
    const body=graph.physics.props[item.index];
    body.home.p.fromArray(item.homeP);body.home.q.fromArray(item.homeQ);
  }
  // Owning reset/_placeBox build the actual object transforms and Verlet points.
  graph.physics.reset();
  return {kind:'original-pre-deploy-world-configuration',path:String(path),
    sha256:createHash('sha256').update(bytes).digest('hex'),schema:input.schema,seed:input.seed,
    originalCount:input.props.length,changedCount:differences.length,differences,
    sourceState:input.state,sourceTick:input.tick,actorStateLoaded:false,liveBodyStateLoaded:false,
    owner:'Original ND constructs all props; original physics.reset/_placeBox adopts immutable homeP/homeQ.'};
}
