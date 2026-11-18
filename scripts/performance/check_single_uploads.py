"""Native WebGL2 whole-buffer oracle. Not a renderer/FPS acceptance benchmark."""
import argparse, hashlib, json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser()
p.add_argument('--browser',default='/usr/bin/chromium')
p.add_argument('--baseline-ref',default='c767e8f')
p.add_argument('--output',type=Path)
a=p.parse_args(); root=Path(__file__).resolve().parents[2]
base=subprocess.check_output(['git','show',a.baseline_ref+':game/core/game.js'],cwd=root).decode()
candidate=(root/'game/core/game.js').read_text()
scenario=r'''async () => {
 const {Physics,Attributes,THREE:T}=__singles, canvas=document.createElement('canvas'), gl=canvas.getContext('webgl2');
 if(!gl)throw Error('WebGL2 unavailable');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 const renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 const events=[],world={overlap:()=>false},p=new Physics(new T.Scene(),world,{audio:{casing:(v,s,k)=>events.push([v.x,v.y,v.z,s,k])}});
 let up=Attributes(gl),payload=0,calls=0;
 const original=gl.bufferSubData.bind(gl);gl.bufferSubData=(target,offset,data,start=0,count=data.length-start)=>{payload+=count*data.BYTES_PER_ELEMENT;calls++;original(target,offset,data,start,count);};
 const attrs=()=>[p.chunkMesh.instanceMatrix,p.chunkMesh.instanceColor,p.caseMesh.instanceMatrix,p.caseMesh.instanceColor];
 const hash=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const result=[];
 async function checkpoint(label){
   const hashes=[];
   for(const a of attrs()){
     up.update(a,gl.ARRAY_BUFFER);gl.bindBuffer(gl.ARRAY_BUFFER,up.get(a).buffer);
     const gpu=new Uint8Array(a.array.byteLength);gl.getBufferSubData(gl.ARRAY_BUFFER,0,gpu);
     const cpu=new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength);
     if(!gpu.every((x,i)=>x===cpu[i]))throw Error(label+': GPU/CPU mismatch');
     hashes.push(await hash(gpu));
   }
   const physics=[];
   for(const pool of [p.chunks,p.cases]){
     for(const key of ['x','v','s','ax','ang','w','life','st','b','kind'])physics.push(await hash(pool[key]));
     physics.push(pool.live,pool.i);
   }
   const error=gl.getError();if(error)throw Error(label+': GL error '+error);
   result.push({label,hashes,physics,rng:__singles.rng(),events:JSON.stringify(events),payload,calls});payload=0;calls=0;
 }
 const spawn=(kind,slot)=>{p[kind].i=slot;if(kind==='cases')p.casing({x:1,y:3,z:2},{x:.2,y:.4,z:.6},slot%3);else p.debris(1,3,2,.2,.4,.6,.2,0x123456,5);};
 const tick=(dt=1/60)=>{p._simSingles(p.cases,p.caseMesh,dt,true);p._simSingles(p.chunks,p.chunkMesh,dt,false);};
 spawn('chunks',7);tick();await checkpoint('first-allocation-with-pending');
 p.reset();await checkpoint('reset');spawn('cases',3);tick();await checkpoint('one-case');
 p.reset();await checkpoint('reset-again');spawn('chunks',2);tick();await checkpoint('one-chunk');
 spawn('cases',85);tick();spawn('cases',2);tick();p.cases.life[85]=0;tick();await checkpoint('deferred-retirement-union');
 for(let i=0;i<190;i++){spawn('cases',i%90);tick();}await checkpoint('ring-wrap');
 for(let i=0;i<90;i++){p.cases.st[i]=2;p.cases.life[i]=3;}tick();await checkpoint('settled');
 tick(2.5);await checkpoint('fade');tick(2);await checkpoint('expiry');
 spawn('cases',4);p.cases.x[13]=-41;tick();await checkpoint('below-world');
 world.overlap=()=>({y1:4,surf:'metal'});spawn('cases',0);p.cases.x[1]=4;p.cases.v[1]=-3;tick();await checkpoint('bounce-audio-rng');
 p.reset();spawn('chunks',5);tick();up=Attributes(gl);await checkpoint('recreated-backend');
 await checkpoint('unchanged-no-upload');
 return {renderer,result};
}'''
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=a.browser,args=['--enable-unsafe-swiftshader','--disable-background-networking'])
 runs=[]
 for enabled,source in [(False,base),(True,candidate)]:
  page=b.new_page();page.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body='<html></html>'));page.goto('http://localhost/oracle')
  page.evaluate("value => globalThis.__GH_SINGLE_UPLOAD_RANGES=value",enabled)
  cut=source.rindex('\n  As0().catch(')
  source=source[:cut]+ '\nglobalThis.__singles={Physics:_w,Attributes:KG,THREE:Ct,rng:()=>[seed,draws]};\n})();'
  source=source.replace('(() => {','(() => { let seed=8171,draws=0; const Math=Object.create(globalThis.Math); Math.random=()=>{draws++; return ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);};',1)
  page.evaluate(source);runs.append(page.evaluate(scenario));page.close()
 b.close()
rows=[]
for x,y in zip(runs[0]['result'],runs[1]['result'],strict=True):
 for key in ['label','hashes','physics','rng','events']:assert x[key]==y[key],(x['label'],key)
 rows.append({'label':x['label'],'baselineBytes':x['payload'],'candidateBytes':y['payload'],'baselineCalls':x['calls'],'candidateCalls':y['calls'],'equal':True})
out={'baselineRef':a.baseline_ref,'baselineSHA256':hashlib.sha256(base.encode()).hexdigest(),'candidateSHA256':hashlib.sha256(candidate.encode()).hexdigest(),'renderer':runs[1]['renderer'],'checkpoints':rows,'allEqual':True,'limitations':'Native WebGL2 buffer/physics oracle only; software renderer is not target GPU, no FPS or endpoint latency claim. Backend recreation is not context loss.'}
print(json.dumps(out,indent=2))
if a.output:a.output.write_text(json.dumps(out,indent=2)+'\n')
