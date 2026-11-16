// Independent CPU scalar reference for selected source operators, not full post.
export const clamp=x=>Math.min(1,Math.max(0,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export const film=x=>clamp(x*(2.36*x+.035)/(x*(2.18*x+.66)+.16));
export function reference(proof,row){
  if(row.input.length!==3||row.input.some(x=>!Number.isFinite(x)||x<0))throw Error('Finite positive HDR input required');
  const u=proof.actualUniforms,E=proof.sourceRead.nativeDecoded.exposure;
  const factor=u.uExposure*(1+(E-1)*row.auto)*(1-.06*u.uSuppress-.16*u.uHurt);
  const c=row.input.map(x=>x*factor),peak=Math.max(...c),mappedPeak=film(peak*1.05);
  const out=c.map(x=>film(x*1.05)*(1-row.hueKeep)+x*mappedPeak/Math.max(peak,1e-5)*row.hueKeep);
  const luminance=out[0]*.2126+out[1]*.7152+out[2]*.0722,k=smooth(.8,1,Math.max(...out))*.3;
  return out.map(x=>x*(1-k)+luminance*k);
}
export function build(proof){
  const raw=[['black',[0,0,0],1,.3],['gray-auto0',[.18,.18,.18],0,.3],['gray-auto1',[.18,.18,.18],1,.3],
    ['toe',[.001,.002,.004],1,.3],['warm',[.6,.25,.05],1,.3],['orange',[4,1,.1],1,.3],
    ['HDR-window',[16,8,2],1,.3],['blue',[.03,.2,3],1,.3],['white',[1,1,1],1,.3],
    ['orange-per-channel-control',[4,1,.1],1,0],['orange-hue-control',[4,1,.1],1,1],['HDR-cool',[.25,2,8],1,.3]];
  return {schema:'gh-post-film-unit-cases-v1',sourceCaptureSHA256:proof.sourceCaptureSHA256,
    sourceFinalFragmentSHA256:proof.sourceFinalFragmentSHA256,fixedExposure:proof.sourceRead.nativeDecoded.exposure,
    cases:raw.map(([name,input,auto,hueKeep])=>{const row={name,input,auto,hueKeep};return {...row,expectedLinear:reference(proof,row)};}),
    witnessPairs:[['gray-auto0','gray-auto1'],['orange-per-channel-control','orange-hue-control']],
    scope:proof.scope};
}
