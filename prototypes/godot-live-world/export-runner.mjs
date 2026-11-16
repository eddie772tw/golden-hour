// One original initialization -> read-only assets -> close. No controller, AI loop, Godot or GPU.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSession,setupSHA256} from '../godot-live-bridge/session.mjs';
import {exportPropAssets} from './export-prop-assets.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
function fingerprint(graph){
  const state=createHash('sha256'),arrays=new WeakSet(),materials=new WeakSet();
  let objectCount=0,arrayCount=0,arrayBytes=0,materialCount=0;
  const value=data=>state.update(JSON.stringify(data));
  function array(a){if(!a||arrays.has(a))return;arrays.add(a);arrayCount++;arrayBytes+=a.byteLength;
    value([a.constructor.name,a.length]);state.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));}
  function tree(root){
    const stack=[root];
    while(stack.length){
      const node=stack.pop();objectCount++;
      value([node.id,node.uuid,node.type,node.name,node.parent?.uuid,node.visible,node.matrixAutoUpdate,
        node.position?.toArray(),node.quaternion?.toArray(),node.scale?.toArray(),node.matrix?.elements,node.matrixWorld?.elements,
        node.children.map(c=>c.uuid)]);
      const g=node.geometry;
      if(g){
        value([g.id,g.uuid,g.type,g.drawRange,g.groups]);
        for(const [key,a]of Object.entries(g.attributes)){value([key,a.itemSize,a.count,a.normalized,a.version]);array(a.array??a.data.array);}
        if(g.index)array(g.index.array);
        for(const [key,list]of Object.entries(g.morphAttributes??{}))for(const a of list){value(key);array(a.array??a.data.array);}
      }
      array(node.instanceMatrix?.array);array(node.instanceColor?.array);
      if(node.skeleton){array(node.skeleton.boneMatrices);value(node.skeleton.bones.map(b=>[b.uuid,b.matrix.elements,b.matrixWorld.elements]));}
      for(const m of Array.isArray(node.material)?node.material:node.material?[node.material]:[]){
        if(materials.has(m))continue;materials.add(m);materialCount++;
        value([m.uuid,m.version,m.type,m.name,m.opacity,m.transparent,m.side,m.depthWrite,m.colorWrite,m.visible,
          m.color?.toArray(),m.emissive?.toArray(),m.roughness,m.metalness]);
      }
      for(let i=node.children.length-1;i>=0;i--)stack.push(node.children[i]);
    }
  }
  tree(graph.scene);tree(graph.gfx.vmScene);
  value(graph.physics.props.map((b,index)=>({index,obj:b.obj.uuid,homeP:b.home.p.toArray(),homeQ:b.home.q.toArray(),
    dead:b.dead,temp:b.temp??false,sleeping:b.sleeping,still:b.still,cx:b.cx,cy:b.cy,cz:b.cz,x:Array.from(b.x),o:Array.from(b.o)})));
  value({time:graph.runtime.state.time,bodyCount:graph.physics.bodies.length,propCount:graph.physics.props.length,
    audioCreated:graph.runtime.audio._engine.stats.created,controllerInstalled:!!graph.hostContext.GH?.benchmark});
  return {sha256:state.digest('hex'),objectCount,arrayCount,arrayBytes,materialCount,props:graph.physics.props.length};
}
function validateChildren(graph,assets){
  const T=graph.runtime.THREE;let children=0,sampledVertices=0,matrixMaxError=0,vertexMaxError=0;
  const sourcePoint=new T.Vector3();
  const multiply=(a,b)=>{const o=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;};
  const point=(m,x,y,z)=>[m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];
  for(const prop of assets.packet.props){
    const body=graph.physics.props[prop.sourcePropIndex],nodes=new Map();
    function visit(node,path=''){nodes.set(path,node);node.children.forEach((child,i)=>visit(child,path+'/'+i+':'+child.name));}
    visit(body.obj);
    for(const child of prop.children){
      const node=nodes.get(child.path);assert.equal(node.uuid,child.sourceUUID);
      const geometry=assets.packet.geometries[child.geometry];
      for(const [name,record]of Object.entries(geometry.attributes)){
        const a=node.geometry.attributes[name];assert.ok(!a.isInterleavedBufferAttribute,'Add separate actual interleaved proof if encountered');
        assert.deepEqual(assets.binary.subarray(record.byteOffset,record.byteOffset+record.byteLength),Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength));
      }
      const m=multiply(body.obj.matrixWorld.elements,child.relativeMatrix),original=node.matrixWorld.elements;
      for(let i=0;i<16;i++)matrixMaxError=Math.max(matrixMaxError,Math.abs(m[i]-original[i]));
      const a=node.geometry.attributes.position,indices=new Set([0,a.count-1]);
      for(let i=0;i<32;i++)indices.add(Math.floor(i*(a.count-1)/31));
      for(const index of indices){
        sourcePoint.fromBufferAttribute(a,index);
        const target=point(m,sourcePoint.x,sourcePoint.y,sourcePoint.z);
        sourcePoint.applyMatrix4(node.matrixWorld);
        vertexMaxError=Math.max(vertexMaxError,Math.abs(target[0]-sourcePoint.x),Math.abs(target[1]-sourcePoint.y),Math.abs(target[2]-sourcePoint.z));sampledVertices++;
      }
      children++;
    }
  }
  assert.ok(matrixMaxError<1e-9&&vertexMaxError<1e-9,'Original child-world transform differs from live-root/rest-relative equation');
  return {children,sampledVertices,matrixMaxError,vertexMaxError,allAttributesByteExact:true,
    source:'Original child.matrixWorld and native Three Vector3 attribute/world transform versus independently multiplied bodyWorld*exportedChildRelative'};
}

const directory=resolve(process.argv[2]||fileURLToPath(new URL('./evidence/rest-props',import.meta.url)));
assert.ok(!existsSync(join(directory,'export-report.json'))&&!existsSync(join(directory,'props.rest.json')),'Choose new evidence directory');
const report={kind:'original-101-prop-readonly-export-proof',ok:false,fullAI:false,logicalTicksExecuted:0,controllerInstalled:false,
  GPU:false,stages:[],platformCalls:[],setupFrozenSHA256:setupSHA256,
  implementationSHA256:Object.fromEntries(['export-runner.mjs','export-prop-assets.mjs'].map(name=>[name,hash(readFileSync(new URL(name,import.meta.url)))]))};
let session;
try{
  const started=performance.now();console.log('PROP_EXPORT initialize original world; no controller/START');
  session=await createSession(report);
  report.initializeMs=performance.now()-started;
  assert.equal(session.graph.physics.props.length,101);
  assert.ok(!session.gh.benchmark,'No controller may be installed');
  report.coreSHA256=session.graph.sourceSHA256;
  report.before=fingerprint(session.graph);
  const originalRandom=Math.random;let randomCalls=0,assets;
  assert.equal(session.graph.hostContext.Math,Math,'RNG observation must cover the original source Math owner');
  const spy=function(...args){randomCalls++;return originalRandom.apply(this,args);};
  const exportStarted=performance.now();
  try{
    Math.random=spy;
    assets=exportPropAssets(session.graph,{outputDirectory:directory,initializerSHA256:report.initialWorldConfig.sha256});
    report.exportMs=performance.now()-exportStarted;
    const validationStarted=performance.now();
    report.childWorldValidation=validateChildren(session.graph,assets);
    report.validationMs=performance.now()-validationStarted;
  }finally{Math.random=originalRandom;}
  report.exportAndValidationMs=performance.now()-exportStarted;
  report.randomCallsDuringExport=randomCalls;report.originalRandomReferenceRestored=Math.random===originalRandom;
  report.after=fingerprint(session.graph);
  report.graphStateUnchanged=report.before.sha256===report.after.sha256;
  report.assets={jsonPath:assets.jsonPath,binaryPath:assets.binaryPath,jsonSHA256:assets.jsonSHA256,binarySHA256:assets.binarySHA256,
    initializerSHA256:report.initialWorldConfig.sha256,counts:assets.counts,bytes:assets.binary.length};
  assert.equal(randomCalls,0,'Source scoped RNG advanced during export');
  assert.deepEqual(report.after,report.before,'Original graph/typed bytes/physics homes/materials changed');
  report.audioErrors=Array.from(session.graph.runtime.audio._errors);
  assert.ok(!session.gh.benchmark);assert.equal(report.audioErrors.length,0);
  report.ok=true;
  console.log(JSON.stringify({event:'PROP_EXPORT complete',ok:true,assets:report.assets,graphStateUnchanged:true,randomCalls:0}));
}catch(error){report.error=String(error);report.stack=error.stack;}
finally{session?.close();mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'export-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
process.exitCode=report.ok?0:2;
