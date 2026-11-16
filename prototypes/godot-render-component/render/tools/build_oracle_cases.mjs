import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sampler,evaluate } from './hm_reference.mjs';
export function build(fixture,bytes){
  const texture=sampler(bytes,60,18,46),cases=[];
  const add=(name,p,n,baseOnly=false)=>cases.push({name,position:p,normal:n,baseOnly,expected:evaluate(fixture,texture,p,n,{baseOnly})});
  for(const n of [[0,1,0],[0,-1,0],[1,0,0]]){
    const q=[20.5/60,4.5/9,18.5/46],p=q.map((v,i)=>fixture.uniforms.ghLVOrg.vector[i]+v/[1/60,1/9,1/46][i]-n[i]*.42);
    add('texel-center-normal-'+n.join('_'),p,n,true);
  }
  add('clamp-outside',[100,-20,-100],[0,1,0],true);
  add('interpolate-offset-plus',[1.23,2.18,-3.71],[.3,.8,.4],true);
  add('interpolate-offset-minus',[1.23,2.18,-3.71],[-.3,-.8,-.4],true);
  let pool=null,chandelier=null;
  for(let z=14.5;z<=20.5;z+=.25)for(let x=-5;x<=5;x+=.25){const p=[x,-.3,z],r=evaluate(fixture,texture,p,[0,1,0]);if(!pool||r.caustics[1]>pool.score)pool={p,score:r.caustics[1]};}
  add('pool-caustic-witness',pool.p,[0,1,0]);
  for(let yi=-8;yi<=8;yi++)for(let j=0;j<720;j++){
    const y=yi/10,a=j*Math.PI/360,h=Math.sqrt(1-y*y),c=fixture.uniforms.ghChand.vector,p=[c[0]+h*Math.cos(a)*5,c[1]+y*5,c[2]+h*Math.sin(a)*5],r=evaluate(fixture,texture,p,[0,1,0]);
    if(!chandelier||r.sparkle[0]>chandelier.score)chandelier={p,score:r.sparkle[0]};
  }
  add('chandelier-sparkle-witness',chandelier.p,[0,1,0]);
  add('full-source-clock',[0,1.6,0],[.4,.7,-.1]);
  return {schema:'gh-hm-oracle-cases-v1',sourceManifestSHA256:fixture.sourceManifestSHA256,volumeSHA256:fixture.asset.sha256,sourceTYSHA256:fixture.sourceTYSHA256,clock:fixture.uniforms.ghLVT.vector[0],clockContract:'Fixed actual source lighting accumulator, not G.time/tick/60 or Godot TIME',cases,witnesses:{pool:pool.score,chandelier:chandelier.score},scope:'CPU reference; native GPU values reported separately without assuming bit-identical trigonometry/LPF'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv.length!==5)throw Error('Usage: build_oracle_cases.mjs FIXTURE VOLUME-BYTES OUTPUT');
  const out=build(JSON.parse(fs.readFileSync(process.argv[2])),fs.readFileSync(process.argv[3]));fs.writeFileSync(process.argv[4],JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({cases:out.cases.length,witnesses:out.witnesses,clock:out.clock}));
}
