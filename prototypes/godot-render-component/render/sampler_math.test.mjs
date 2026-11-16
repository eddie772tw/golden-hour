// Independent CPU sampler/Jacobian reference, not a GPU or High-parity oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
const mod=(a,n)=>((a%n)+n)%n;
function at(data,i,wrap){if(wrap==='clamp')return data[Math.min(data.length-1,Math.max(0,i))];if(wrap==='repeat')return data[mod(i,data.length)];const k=mod(i,data.length*2);return data[k<data.length?k:2*data.length-1-k];}
function linear(data,u,wrap){const x=u*data.length-.5,i=Math.floor(x),f=x-i;return at(data,i,wrap)*(1-f)+at(data,i+1,wrap)*f;}
const mirrored=data=>data.concat(data.slice().reverse());
const reduce=data=>data.length===1?data.slice():Array.from({length:data.length/2},(_,i)=>(data[i*2]+data[i*2+1])*.5);
function chain(data){const out=[data];while(data.length>1){data=reduce(data);out.push(data);}return out;}
function sampleMip(mips,u,wrap,lod){lod=Math.min(mips.length-1,Math.max(0,lod));const k=Math.floor(lod),f=lod-k;return linear(mips[k],u,wrap)*(1-f)+linear(mips[Math.min(k+1,mips.length-1)],u,wrap)*f;}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
test('POT mirrored extension preserves GL clamp/mirror bilinear edges including negative and outside UVs',()=>{
  const data=[.01,.75,.2,.9,.15,.6,.4,1],tile=mirrored(data);
  for(const u of[-9,-2.25,-1,-.01,-1e-9,0,1e-9,.01,.17,.5,.99,1-1e-9,1,1+1e-9,1.01,2.25,9]){
    close(linear(data,u,'clamp'),linear(tile,Math.min(1,Math.max(0,u))/2,'repeat'));
    close(linear(data,u,'mirror'),linear(tile,u/2,'repeat'));
  }
});
test('same box-filter mip chain and trilinear samples preserve POT mirrored seams and terminal mips',()=>{
  const data=[.01,.75,.2,.9,.15,.6,.4,1],source=chain(data),tile=chain(mirrored(data));
  for(let level=0;level<source.length;level++)assert.deepEqual(tile[level],mirrored(source[level]));
  for(let lod=0;lod<=5;lod+=.125)for(const u of[-.1,0,.001,.08,.2,.51,.97,1,1.1])
    close(sampleMip(source,u,'clamp',lod),sampleMip(tile,Math.min(1,Math.max(0,u))/2,'repeat',lod));
});
test('textureGrad coordinate derivative and doubled dimensions preserve texture-space footprint/LOD',()=>{
  for(const [w,h]of[[1024,512],[2048,2048]])for(const [dx,dy]of[[[.002,.009],[.01,-.003]],[[-.02,.03],[.04,.05]]]){
    for(const d of[dx,dy]){close(Math.hypot(d[0]*w,d[1]*h),Math.hypot(d[0]*w,d[1]/2*(h*2)));}
  }
});
test('independent alpha filtering product cannot be replaced by pre-multiplied texel baking',()=>{
  const a=[0,1],b=[1,0];close(linear(a,.5,'clamp')*linear(b,.5,'clamp'),.25);close(linear(a.map((v,i)=>v*b[i]),.5,'clamp'),0);
});
function basis(px,py,ux,uy){const det=ux[0]*uy[1]-ux[1]*uy[0];const t=px.map((v,i)=>(v*uy[1]-py[i]*ux[1])/det),b=py.map((v,i)=>(v*ux[0]-px[i]*uy[0])/det);const scale=1/Math.sqrt(Math.max(t.reduce((n,v)=>n+v*v,0),b.reduce((n,v)=>n+v*v,0)));return[t.map(v=>v*scale),b.map(v=>v*scale)];}
test('signed UV Jacobian basis survives framebuffer-Y and mirrored UV orientation with nonunit XY scales',()=>{
  const reference=basis([1,0,0],[0,1,0],[2,0],[0,3]);
  const flipped=basis([1,0,0],[0,-1,0],[2,0],[0,-3]);for(let i=0;i<2;i++)for(let j=0;j<3;j++)close(flipped[i][j],reference[i][j]);
  close(reference[0][0],1);close(reference[1][1],2/3);
  const mirror=basis([1,0,0],[0,1,0],[-2,0],[0,3]);close(mirror[0][0],-1);close(mirror[1][1],2/3);
  const sx=1.3,sy=.2;close(reference[0][0]*.5*sx,.65);close(reference[1][1]*.5*sy,1/15);
});
