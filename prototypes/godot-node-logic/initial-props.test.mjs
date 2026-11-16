import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRuntime} from './load-runtime.mjs';
import {applyInitialProps} from './initial-props.mjs';
const {runtime:r,sourceSHA256}=loadRuntime({boot:{policy:{}}}),T=r.THREE,scene=new T.Scene(),world=new r.World();
const physics=new r.Physics(scene,world,{}),group=new T.Group();group.name='test-native-prop';
const body=physics.addProp(group,{size:[1,1,1]});
const graph={world,physics,sourceSHA256,nav:{nodes:[]},glass:{panes:[]}};
const input={ok:true,godotInitializationCaptureOnly:true,coreSHA256:sourceSHA256,consoleErrors:[],
  initializer:{schema:'gh-browser-initial-world-v1',seed:0x47484d31,state:'menu',tick:null,
    world:{cols:0,panes:0,nodes:0,props:1},props:[{index:0,type:'box',name:group.name,temp:false,
      homeP:[2,3,4],homeQ:[0,0,0,1],homeS:null}]}};
const directory=mkdtempSync(join(tmpdir(),'gh-native-initial-')),path=join(directory,'initial.json');
try {
  writeFileSync(path,JSON.stringify(input));const result=applyInitialProps(graph,path);
  assert.equal(result.changedCount,1);assert.deepEqual(body.home.p.toArray([]),[2,3,4]);
  assert.deepEqual(group.position.toArray([]),[2,3,4]);
  // Owning Verlet corners are Float32; centroid reflects that real storage.
  assert.ok(Math.abs(body.cx-2)<1e-6);assert.ok(Math.abs(body.cy-3.5)<1e-6);assert.ok(Math.abs(body.cz-4)<1e-6);
  assert.equal(body.sleeping,true);assert.equal(body.n,8);
  input.initializer.props[0].name='wrong-owner';writeFileSync(path,JSON.stringify(input));
  assert.throws(()=>applyInitialProps(graph,path));assert.deepEqual(body.home.p.toArray([]),[2,3,4]);
  input.initializer.props[0].name=group.name;input.initializer.tick=1;writeFileSync(path,JSON.stringify(input));
  assert.throws(()=>applyInitialProps(graph,path));
  console.log('PASS immutable init validation + original _w.reset/_placeBox adoption; no actors used');
} finally {rmSync(directory,{recursive:true,force:true});}
