// Independent CPU reference for the captured TY, not a GPU bit-identical claim.
export const mix=(a,b,t)=>a+(b-a)*t;
export const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const fract=x=>x-Math.floor(x);
export const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function half(word){const s=word>>15?-1:1,e=(word>>10)&31,f=word&1023;return e===0?s*f*2**-24:e===31?f?NaN:s*Infinity:s*(1+f/1024)*2**(e-15);}
const norm=n=>{const length=Math.hypot(...n);if(!length)throw Error('Zero normal');return n.map(x=>x/length);};
const vec=(m,v,w)=>[0,1,2].map(i=>m[i]*v[0]+m[4+i]*v[1]+m[8+i]*v[2]+m[12+i]*w);
export function sampler(bytes,width,height,depth){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.byteLength!==width*height*depth*8)throw Error('RGBAH exact volume size required');
  const at=(x,y,z,c)=>half(view.getUint16((((clamp(z,0,depth-1)*height+clamp(y,0,height-1))*width+clamp(x,0,width-1))*4+c)*2,true));
  return {at,sample(q){
    const p=[q[0]*width-.5,q[1]*height-.5,q[2]*depth-.5],i=p.map(Math.floor),f=p.map((x,k)=>x-i[k]);
    return [0,1,2].map(c=>{let sum=0;for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)sum+=at(i[0]+x,i[1]+y,i[2]+z,c)*(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);return sum;});
  }};
}
export function hash21(p){
  let a=[p[0],p[1],p[0]].map(x=>fract(x*.1031));
  const d=a[0]*(a[1]+33.33)+a[1]*(a[2]+33.33)+a[2]*(a[0]+33.33);a=a.map(x=>x+d);
  return fract((a[0]+a[1])*a[2]);
}
export function evaluate(fixture,texture,worldPos,worldNormal,options={}){
  const u=fixture.uniforms,m=u.ghLVMat.matrix,p=vec(m,worldPos,1),n=norm(vec(m,norm(worldNormal),0));
  const origin=u.ghLVOrg.vector,inv=u.ghLVInv.vector,k=u.ghLVK.vector.slice(),pool=u.ghPool.vector,ch=u.ghChand.vector;
  if(options.baseOnly){k[2]=0;k[3]=0;}
  const time=options.time??u.ghLVT.vector[0];
  const q=p.map((v,i)=>clamp((v+n[i]*.42-origin[i])*inv[i]));
  const y=clamp(q[1],k[1],1-k[1])*.5;
  const above=texture.sample([q[0],y,q[2]]),below=texture.sample([q[0],y+.5,q[2]]);
  const base=above.map((a,i)=>mix(below[i],a,n[1]*.5+.5)*k[0]);
  const caustics=[0,0,0],sparkle=[0,0,0];
  const pd=[Math.max(Math.abs(p[0]-pool[0])-pool[2],0),Math.max(Math.abs(p[2]-pool[1])-pool[3],0)];
  const nearPool=(1-smooth(0,4.2,Math.hypot(...pd)))*(1-smooth(.3,3.6,p[1]))*k[2];
  if(nearPool>.002){
    const v=[p[0]*1.5+p[1]*.8,p[2]*1.5+p[1]*.45];
    const a=[v[0]+.7*Math.sin(v[1]*1.3+time),v[1]+.7*Math.cos(v[0]*1.1-time*.8)];
    const b=[v[0]*1.37-.6*Math.cos(v[1]*.9-time*1.2),v[1]*1.37-.6*Math.sin(v[0]*1.5+time*.7)];
    const c=(.5+.5*Math.sin(a[0]*2.1)*Math.sin(a[1]*2.3))**6+(.5+.5*Math.sin(b[0]*2.4+1)*Math.sin(b[1]*2))**6;
    const under=p[1]<-.12?1:0,factor=c*nearPool*mix(.55*(1-.6*Math.max(n[1],0)),1.6,under);
    [.16,.62,.6].forEach((x,i)=>caustics[i]=x*factor);
  }
  const cd=p.map((v,i)=>v-ch[i]),length=Math.hypot(...cd),nearCh=(1-smooth(4,11,length))*k[3];
  if(nearCh>.002){
    const dn=cd.map(x=>x/Math.max(length,.001)),sp=[Math.atan2(dn[2],dn[0])*5+time*.02,dn[1]*11],cell=sp.map(Math.floor),f=sp.map(fract),h=hash21(cell);
    const distance=Math.hypot(f[0]-.3-.4*h,f[1]-.3-.4*fract(h*7.31));
    const g=smooth(.13,0,distance)*(fract(h*13.7)>=.5?1:0);
    const factor=g*nearCh*(.5+.5*Math.sin(time*(.7+h)+h*40))*.55;
    [1,.8,.52].forEach((x,i)=>sparkle[i]=x*factor);
  }
  return {value:base.map((v,i)=>v+caustics[i]+sparkle[i]),base,caustics,sparkle,q,above,below,time};
}
