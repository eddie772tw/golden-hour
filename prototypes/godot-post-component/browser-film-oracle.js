// Explicit tiny offscreen source-operator oracle, never a game/compositor draw.
(() => {
  const errors=gl=>{const out=[];for(let i=0;i<16;i++){const e=gl.getError();if(!e)return out;out.push(e);}out.push('cap');return out;};
  const delta=(a,b)=>a.slice(0,3).map((v,i)=>Math.abs(v-b[i]));
  function run({proof,cases,coreSHA256}={}){
    const g=globalThis.GH?.debug?.gfx,r=g?.renderer,quad=g?.final?._fsQuad;
    if(!GH.ready||GH.G.state!=='paused'||GH.benchmark?.tick!==240||!r||!quad||r.xr?.isPresenting)throw Error('Ready paused tick240 owning renderer/fullscreen quad required');
    if(coreSHA256!==proof.sourceCoreSHA256||cases.sourceCaptureSHA256!==proof.sourceCaptureSHA256||cases.fixedExposure!==.90869140625||proof.currentCompiledFinal.id!==123)throw Error('Reviewed source/actual-meter/current-program proof required');
    if(cases.cases.length!==12)throw Error('Exact bounded12 cases required');
    for(const text of Object.values(proof.selection))if(!g.final.material.fragmentShader.includes(text.trimEnd()))throw Error('Actual owning final selected source differs');
    const gl=r.getContext(),report={schema:'gh-three-post-film-unit-v1',ok:false,sourceCoreSHA256:coreSHA256,
      sourceCaptureSHA256:proof.sourceCaptureSHA256,sourceCompiledFinal:proof.currentCompiledFinal,
      fixedExposure:cases.fixedExposure,scope:proof.scope,cases:[],witnesses:[],initialGLErrors:errors(gl),restoreErrors:[],finalGLErrors:[],
      sourceFinalFragment:g.final.material.fragmentShader,sourceFinalVertex:g.final.material.vertexShader,
      restoreContract:'Original shared fullscreen quad material restored; never dispose shared geometry. Native resetState/RT/viewport/scissor/clear/renderer settings restored, no arbitrary rawGL replay or game refresh draw.',
      RNG:'Temporary local stream during synchronous constructor/draw only; original Math.random function restored, original stream not consumed',
      outputContract:'Same native source target/pipeline, explicit source toSRGB once for both sample/reference. Reference linear values come from independent CPU math. No cross-engine literal RGB equality assumption.'};
    if(report.initialGLErrors.length)return report;
    let clearColor;
    g.scene.traverse(o=>{if(clearColor)return;for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])if(m.color?.isColor){clearColor=m.color.clone();break;}});
    if(!clearColor)throw Error('Actual source Color owner required');
    const originalRandom=Math.random;let seed=0x50f11a3b,target,material,saved;
    Math.random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
    try{
      const RT=g.composer.readBuffer.constructor;
      target=new RT(65,65,{type:1009,format:1023,minFilter:1003,magFilter:1003,generateMipmaps:false,depthBuffer:false,stencilBuffer:false,samples:0});
      target.texture.colorSpace='';
      saved={target:r.getRenderTarget(),face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),viewport:r.getViewport(target.viewport.clone()),scissor:r.getScissor(target.scissor.clone()),scissorTest:r.getScissorTest(),
        clear:r.getClearColor(clearColor),alpha:r.getClearAlpha(),autoClear:r.autoClear,tone:r.toneMapping,clipping:r.clippingPlanes,quadMaterial:quad.material,
        shadowEnabled:r.shadowMap.enabled,shadowAuto:r.shadowMap.autoUpdate,shadowNeeds:r.shadowMap.needsUpdate};
      const u=proof.actualUniforms,vec=()=>g.uniforms.uBalance.value.clone();
      const uniforms={uExposure:{value:u.uExposure},uAuto:{value:1},uHueKeep:{value:u.uHueKeep},uSuppress:{value:u.uSuppress},uHurt:{value:u.uHurt},fixedExposure:{value:cases.fixedExposure},hdr_input:{value:vec()},reference_linear:{value:vec()},reference_mode:{value:false}};
      const select=proof.selection;
      const code=select.definitions+'\nuniform float uExposure,uAuto,uHueKeep,uSuppress,uHurt,fixedExposure;\nuniform vec3 hdr_input,reference_linear;uniform bool reference_mode;\n'+select.toSRGB+
        'vec3 sourceExposureFilm(vec3 col){vec4 meter=vec4(fixedExposure,0.0,0.0,1.0);\n'+select.exposureLine+select.filmBlock+'return col;}\nvoid main(){vec3 c=reference_mode?reference_linear:sourceExposureFilm(hdr_input);gl_FragColor=vec4(toSRGB(c),1.0);}';
      material=new g.final.material.constructor({uniforms,vertexShader:g.final.material.vertexShader,fragmentShader:code,depthTest:false,depthWrite:false,blending:0,toneMapped:false});
      quad.material=material;r.autoClear=true;r.toneMapping=0;r.clippingPlanes=[];r.shadowMap.enabled=false;r.setClearColor(0,1);
      const sample=(row,reference=false)=>{
        uniforms.hdr_input.value.fromArray(row.input);uniforms.reference_linear.value.fromArray(row.expectedLinear);uniforms.uAuto.value=row.auto;uniforms.uHueKeep.value=row.hueKeep;uniforms.reference_mode.value=reference;
        r.setRenderTarget(target);r.setViewport(0,0,65,65);r.setScissorTest(false);r.clear();quad.render(r);
        const bytes=new Uint8Array(4);r.readRenderTargetPixels(target,32,32,1,1,bytes);
        const program=r.properties.get(material).currentProgram;
        if(!report.unitCode){if(!gl.isShader(program.vertexShader)||!gl.isShader(program.fragmentShader))throw Error('Existing unit shader handle required');report.unitCode={vertex:gl.getShaderSource(program.vertexShader),fragment:gl.getShaderSource(program.fragmentShader)};}
        return {pixel:Array.from(bytes,x=>x/255),GLErrors:errors(gl)};
      };
      const samples={};let invalid=0,exact=true;
      for(const row of cases.cases){
        const a=sample(row),b=sample(row,true),repeat=sample(row),difference=delta(a.pixel,b.pixel),aa=Math.max(...delta(a.pixel,repeat.pixel));
        if(aa!==0||(row.name!=='black'&&Math.max(...a.pixel.slice(0,3))===0)||[a,b,repeat].some(s=>s.GLErrors.length))invalid++;
        if(Math.max(...difference)!==0)exact=false;
        report.cases.push({case:row,sample:a,reference:b,AAmaxDiff:aa,differencePerChannel:difference});samples[row.name]=a;
      }
      for(const pair of cases.witnessPairs){const difference=delta(samples[pair[0]].pixel,samples[pair[1]].pixel);report.witnesses.push({pair,differencePerChannel:difference});if(Math.max(...difference)===0)invalid++;}
      report.invalidCases=invalid;report.allReferenceChannelsExact=exact;report.ok=invalid===0&&exact;
      report.target={size:[65,65],type:target.texture.type,format:target.texture.format,colorSpace:target.texture.colorSpace,samples:target.samples};
    }catch(error){report.error=String(error);report.ok=false;}
    finally{
      Math.random=originalRandom;
      try{if(saved)quad.material=saved.quadMaterial;material?.dispose();target?.dispose();}catch(error){report.restoreErrors.push(String(error));}
      try{if(saved){r.resetState();r.autoClear=saved.autoClear;r.toneMapping=saved.tone;r.clippingPlanes=saved.clipping;r.shadowMap.enabled=saved.shadowEnabled;r.shadowMap.autoUpdate=saved.shadowAuto;r.shadowMap.needsUpdate=saved.shadowNeeds;r.setClearColor(saved.clear,saved.alpha);r.setRenderTarget(saved.target,saved.face,saved.mip);r.setViewport(saved.viewport);r.setScissor(saved.scissor);r.setScissorTest(saved.scissorTest);}}catch(error){report.restoreErrors.push(String(error));}
      report.finalGLErrors=errors(gl);if(report.restoreErrors.length||report.finalGLErrors.length)report.ok=false;
    }
    if(new TextEncoder().encode(JSON.stringify(report)).byteLength>262144)throw Error('Bounded film report exceeded; no truncation');
    return report;
  }
  globalThis.__ghThreePostFilm=Object.freeze({run});
})();
