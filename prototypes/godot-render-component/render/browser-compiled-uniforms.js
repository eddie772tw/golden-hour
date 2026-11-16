/* Explicit paused-tick asset evidence. Read already compiled properties only:
 * no render/compile/onBeforeCompile/updateMatrixWorld/RAF/audio/RNG operation.
 * Metadata is bounded JSON; CPU texture payloads use bounded separate readers. */
(() => {
  'use strict';
  let manifest=null;
  const payloads=new Map();
  const finite=x=>{if(!Number.isFinite(x))throw Error('Non-finite source number');return x;};
  const nums=a=>Array.from(a,finite);
  const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
  function base64(b){let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);}
  async function capture(options={}) {
    manifest=null;payloads.clear();
    const gh=globalThis.GH,d=gh?.debug,g=d?.gfx;
    if(!gh?.ready||!g?.scene||gh.G.state!=='paused'||gh.benchmark?.tick!==240)throw Error('Ready native paused tick240 required');
    if(typeof options.coreSHA256!=='string'||!/^[a-f0-9]{64}$/.test(options.coreSHA256))throw Error('Owning source core SHA256 required');
    const caps={materials:2048,owners:20000,textures:512,assetBytes:512*1024*1024,metadataBytes:64*1024*1024,codeChars:32*1024*1024};
    const start=performance.now(),textures={},assets={},materials={},objects=[],codes={},gaps=[];
    const codeIndex=new Map(),sourceTextures=new Map(),links=new WeakMap();
    let assetBytes=0,codeChars=0;
    const gap=(kind,id,reason)=>gaps.push({kind,id,reason});
    function code(text,role){
      if(typeof text!=='string')return null;
      if(codeIndex.has(text))return codeIndex.get(text);
      codeChars+=text.length;if(codeChars>caps.codeChars)throw Error('Compiled code cap exceeded; no truncated capture');
      const id='c'+Object.keys(codes).length;codeIndex.set(text,id);codes[id]={role,text,sha256:null};return id;
    }
    function own(root,owner,path=''){
      if(!root?.isObject3D)return;
      const row=links.get(root)||[];row.push({...owner,path});links.set(root,row);
      root.children.forEach((c,i)=>own(c,owner,path+'/'+i+':'+c.name));
    }
    (d.match?.bots||[]).forEach((b,i)=>(b.rigs||[]).forEach((r,j)=>own(r.root,{kind:'actor',actor:i+1,rig:j,stableKey:`actor/${i+1}/rig/${j}`})));
    if(d.fpbody?.rig?.root)own(d.fpbody.rig.root,{kind:'actor',actor:0,rig:0,stableKey:'actor/0/fp'});
    (d.physics?.bodies||[]).forEach((b,i)=>own(b.obj||b.char?.root,{kind:'physics',index:i,propIndex:d.physics.props.indexOf(b),type:b.type,temp:!!b.temp,stableKey:'physics/body/'+i}));
    const imageOf=t=>t.image||t.source?.data;
    function tex(t,role){
      if(!textures[t.uuid]){
        if(sourceTextures.size>=caps.textures)throw Error('Texture cap exceeded; no truncated capture');
        const im=imageOf(t);sourceTextures.set(t.uuid,t);
        textures[t.uuid]={id:t.uuid,name:t.name??'',type:t.type,format:t.format,internalFormat:t.internalFormat??null,colorSpace:t.colorSpace??'',
          dimension:t.isData3DTexture?3:2,width:im?.width??null,height:im?.height??null,depth:im?.depth??1,
          flags:{renderTarget:!!t.isRenderTargetTexture,data:!!t.isDataTexture,data3D:!!t.isData3DTexture,cube:!!t.isCubeTexture,compressed:!!t.isCompressedTexture,depth:!!t.isDepthTexture},
          wrap:[t.wrapS,t.wrapT,t.wrapR??null],filter:[t.minFilter,t.magFilter],anisotropy:t.anisotropy??1,
          flipY:!!t.flipY,premultiplyAlpha:!!t.premultiplyAlpha,unpackAlignment:t.unpackAlignment,generateMipmaps:!!t.generateMipmaps,manualMipmaps:t.mipmaps?.length??0,
          channel:t.channel??0,matrix:t.matrix?.elements?nums(t.matrix.elements):null,matrixAutoUpdate:!!t.matrixAutoUpdate,
          offset:t.offset?.toArray()??null,repeat:t.repeat?.toArray()??null,center:t.center?.toArray()??null,rotation:t.rotation??null,
          roles:[],status:'pending',asset:null};
      }
      if(!textures[t.uuid].roles.includes(role))textures[t.uuid].roles.push(role);
      return {texture:t.uuid};
    }
    function value(v,role,depth=0){
      if(v==null||typeof v==='boolean'||typeof v==='string')return v;
      if(typeof v==='number')return finite(v);
      if(v.isTexture)return tex(v,role);
      if(v.isColor)return {color:[v.r,v.g,v.b].map(finite)};
      if(v.isVector2||v.isVector3||v.isVector4)return {vector:nums(v.toArray())};
      if(v.isMatrix3||v.isMatrix4)return {matrix:nums(v.elements)};
      if(Array.isArray(v)&&depth<2&&v.length<=64)return v.map(x=>value(x,role,depth+1));
      gap('uniform',role,'Unsupported value type; not recursively traversed');
      return {unsupportedType:v.constructor?.name??typeof v};
    }
    function uniforms(input,scope,predicate){
      const out={};let n=0;
      for(const [key,u] of Object.entries(input||{})){
        if(!predicate(key))continue;
        if(++n>256)throw Error('Uniform count cap exceeded');
        out[key]=value(u?.value,scope+'/'+key);
      }return out;
    }
    const wanted=key=>key.startsWith('gh');
    const gl=g.renderer.getContext();
    function compiled(program){
      if(!program)return null;
      const out={id:program.id,cacheKey:program.cacheKey??null,vertex:null,fragment:null};
      for(const [slot,handle] of [['vertex',program.vertexShader],['fragment',program.fragmentShader]]){
        if(!handle||!gl.isShader(handle)){gap('program',program.id,'No valid '+slot+' shader handle');continue;}
        // WebGL shader source query is a read, never draw/readPixels/compile.
        try{out[slot]=code(gl.getShaderSource(handle),'compiled-'+slot);}catch(e){gap('program',program.id,String(e));}
      }return out;
    }
    function material(m){
      if(!m||materials[m.uuid])return;
      if(Object.keys(materials).length>=caps.materials)throw Error('Material cap exceeded');
      const p=g.renderer.properties.get(m),variants=[];
      if(p.programs instanceof Map)for(const program of new Set(p.programs.values()))variants.push(compiled(program));
      const user=m._ghUser?String(m._ghUser):null;
      let proto=m,accessor=false;
      while(proto){if(Object.getOwnPropertyDescriptor(proto,'onBeforeCompile')?.get){accessor=true;break;}proto=Object.getPrototypeOf(proto);}
      const row={id:m.uuid,nativeID:m.id,type:m.type,name:m.name??'',defines:{...m.defines},userHook:code(user,'_ghUser'),
        globalHookAccessor:accessor,
        scalarFlags:{side:m.side,transparent:!!m.transparent,opacity:m.opacity,depthWrite:m.depthWrite!==false,depthTest:m.depthTest!==false,colorWrite:m.colorWrite!==false,stencilWrite:!!m.stencilWrite,blending:m.blending,vertexColors:!!m.vertexColors},
        sourceFactors:{color:m.color?value(m.color,'factor'):null,emissive:m.emissive?value(m.emissive,'factor'):null,emissiveIntensity:m.emissiveIntensity??1,roughness:m.roughness??null,metalness:m.metalness??null,normalScale:m.normalScale?value(m.normalScale,'factor'):null},
        ghUniforms:uniforms(m.ghUniforms,m.uuid+'/ghUniforms',()=>true),
        compiledUniforms:uniforms(p.uniforms,m.uuid+'/compiled',wanted),
        compiledCurrentProgram:p.currentProgram?.id??null,compiledVariants:variants,standardMaps:{},owners:[]};
      for(const slot of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap'])if(m[slot]){
        // Only ORM CPU assets are new inputs here. Other map relations point to
        // a same-session texture identity but do not trigger another full capture.
        row.standardMaps[slot]={texture:m[slot].uuid};
        if(slot==='roughnessMap'||slot==='metalnessMap'||slot==='aoMap')tex(m[slot],m.uuid+'/standard/'+slot);
      }
      if(!p.uniforms)gap('material',m.uuid,'No existing compiled uniform table; no compile forced');
      materials[m.uuid]=row;
    }
    function visit(o,path,visible){
      visible=visible&&o.visible!==false;
      const list=Array.isArray(o.material)?o.material:o.material?[o.material]:[];
      if(list.length){
        if(objects.length>=caps.owners)throw Error('Owner cap exceeded');
        list.forEach(material);
        const geo=o.geometry;
        const row={id:o.uuid,nativeID:o.id,name:o.name??'',path,type:o.type,parentID:o.parent?.uuid??null,owners:links.get(o)||[],
          materials:list.map((m,slot)=>({material:m.uuid,slot})),geometry:geo?.uuid??null,
          geometryType:geo?.type??null,vertices:geo?.attributes.position?.count??0,indexCount:geo?.index?.count??null,
          groups:geo?.groups?.map(x=>({...x}))??[],drawRange:geo?{start:geo.drawRange.start,count:Number.isFinite(geo.drawRange.count)?geo.drawRange.count:null}:null,
          attributes:geo?Object.fromEntries(Object.entries(geo.attributes).map(([k,a])=>[k,{count:a.count,itemSize:a.itemSize,normalized:!!a.normalized}])):{},
          matrix:nums(o.matrixWorld.elements),effectiveVisible:visible,ownVisible:o.visible!==false,layers:o.layers.mask,renderOrder:o.renderOrder,
          castShadow:!!o.castShadow,receiveShadow:!!o.receiveShadow,instanceCount:o.isInstancedMesh?o.count:null};
        objects.push(row);row.materials.forEach(x=>materials[x.material].owners.push({object:o.uuid,path,slot:x.slot,effectiveVisible:visible}));
      }
      o.children.forEach((c,i)=>visit(c,path+'/'+i+':'+c.name,visible));
    }
    visit(g.scene,'world',true);
    // Independent authoritative identity/shape proof: never infer LV from a
    // generic 3D texture or particle tNoise. Snapshot half words synchronously.
    const lv=d.fx?.lightVolume;
    const lightVolume=lv?{role:'HM baked irradiance A/B; not particle noise',classSource:code(String(lv.constructor),'authoritative-HM-class'),texture:tex(lv.texture,'FX.lightVolume.texture'),
      origin:[lv.x0,lv.y0,lv.z0],dimensions:[lv.nx,lv.ny,lv.nz],cellSize:lv.s,halfWords:lv.half?.length??null,
      gpuTextureDimensions:[lv.texture.image.width,lv.texture.image.height,lv.texture.image.depth]}:null;
    const lights=[];g.scene.traverse(o=>{if(o.isLight)lights.push({id:o.uuid,nativeID:o.id,type:o.type,visible:o.visible,layers:o.layers.mask,
      color:value(o.color,'light'),intensity:o.intensity,distance:o.distance??null,decay:o.decay??null,matrix:nums(o.matrixWorld.elements),target:o.target?nums(o.target.matrixWorld.elements):null,castShadow:!!o.castShadow});});
    const source={coreSHA256:options.coreSHA256,sessionId:options.sessionId??null,tick:gh.benchmark.tick,state:gh.G.state,quality:g.quality,
      capturedAt:performance.timeOrigin+performance.now(),pageBundle:globalThis.document?.documentElement?.dataset?.bundle??null,cameraMatrix:nums(g.camera.matrixWorld.elements),scene:'GH.debug.gfx.scene',
      provenance:'Existing compiled renderer.properties.get(material).uniforms + material.ghUniforms; no recompilation; no UUID cross-session binding'};
    const pending=[];
    function addBytes(id,bytes,encoding,provenance,arrayType=null){
      assetBytes+=bytes.byteLength;if(assetBytes>caps.assetBytes)throw Error('CPU texture payload cap exceeded; no truncated capture');
      const asset='a'+Object.keys(assets).length, file='assets/'+asset+'.bin';
      const copy=new Uint8Array(bytes);payloads.set(asset,copy);assets[asset]={id:asset,texture:id,file,encoding,provenance,arrayType,byteOrder:'little-endian',byteLength:copy.byteLength,sha256:null};
      textures[id].asset=asset;textures[id].status='captured';
    }
    if(new Uint8Array(new Uint16Array([0x102]).buffer)[0]!==2)throw Error('Little-endian browser required for exact typed asset contract');
    for(const [id,t] of sourceTextures){
      const meta=textures[id],im=imageOf(t);
      const reject=reason=>{meta.status='unsupported';meta.reason=reason;gap('texture',id,reason);};
      if(meta.flags.renderTarget||meta.flags.cube||meta.flags.compressed||meta.flags.depth){reject('GPU-only/unsupported texture source; no GPU readback');continue;}
      if(im?.data&&ArrayBuffer.isView(im.data)){
        const array=im.data;
        if(!['Uint8Array','Uint8ClampedArray','Uint16Array','Float32Array'].includes(array.constructor.name)){reject('Unsupported typed CPU texture array');continue;}
        const cells=meta.width*meta.height*meta.depth,channels=array.length/cells;
        if(!Number.isInteger(channels)||channels<1||channels>4){reject('CPU texture shape/channel mismatch');continue;}
        meta.channels=channels;
        addBytes(id,new Uint8Array(array.buffer,array.byteOffset,array.byteLength),'typed-raw','exact original CPU typed-array byte slice',array.constructor.name);
      }else if(im?.getContext){
        try{const ctx=im.getContext('2d');if(!ctx)throw Error('No existing 2D context');
          const settings=ctx.getContextAttributes?.();if(settings?.colorSpace&&settings.colorSpace!=='srgb')throw Error('Unsupported non-sRGB canvas backing');
          const pixels=ctx.getImageData(0,0,im.width,im.height);meta.channels=4;
          addBytes(id,new Uint8Array(pixels.data.buffer,pixels.data.byteOffset,pixels.data.byteLength),'rgba8','canonical existing Canvas2D RGBA8; unpremultiply rounding may affect transparent RGB','Uint8ClampedArray');
        }catch(e){reject(String(e));}
      }else{
        const src=im?.currentSrc||im?.src;
        if(!src){reject('No exact CPU array/canvas/original PNG source');continue;}
        const url=new URL(src,location.href);
        if(url.origin!==location.origin||!url.pathname.toLowerCase().endsWith('.png')){reject('Only original same-origin PNG bytes supported');continue;}
        pending.push((async()=>{try{const response=await fetch(url.href,{credentials:'same-origin'});if(!response.ok)throw Error('PNG HTTP '+response.status);
          const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length<8||[137,80,78,71,13,10,26,10].some((v,i)=>bytes[i]!==v))throw Error('Invalid PNG signature');
          addBytes(id,bytes,'png','original same-origin encoded PNG; never re-encoded');
        }catch(e){reject(String(e));}})());
      }
    }
    // All uniforms, roles and CPU typed/canvas bytes above were frozen before
    // this first await. Only immutable original PNG fetch/hash work yields.
    await Promise.all(pending);
    for(const c of Object.values(codes))c.sha256=await sha(new TextEncoder().encode(c.text));
    for(const a of Object.values(assets))a.sha256=await sha(payloads.get(a.id));
    const expectedLV=lightVolume?.texture.texture;
    const lvRefs=Object.values(materials).filter(m=>m.compiledUniforms.ghLV);
    const wrongLV=lvRefs.filter(m=>m.compiledUniforms.ghLV.texture!==expectedLV).map(m=>m.id);
    if(wrongLV.length)gap('lightVolume','compiled','Compiled ghLV differs from FX.lightVolume.texture: '+wrongLV.join(','));
    const result={schema:'gh-compiled-material-evidence-v1',source,caps,materials,objects,textures,assets,codes,lightVolume,lights,gaps,
      counts:{materials:Object.keys(materials).length,owners:objects.length,visibleOwners:objects.filter(o=>o.effectiveVisible).length,
        textures:Object.keys(textures).length,assets:Object.keys(assets).length,assetBytes,codes:Object.keys(codes).length,codeChars,
        compiledLVMaterials:lvRefs.length,compiledLVIdentityMismatches:wrongLV.length},
      captureMS:performance.now()-start,scope:'Paused native source evidence only; no geometry buffers/no new render/no performance acceptance'};
    const text=JSON.stringify(result);if(new TextEncoder().encode(text).byteLength>caps.metadataBytes)throw Error('Metadata cap exceeded; no truncated capture');
    manifest=result;return result;
  }
  function readAsset(id,offset=0,maxBytes=262144){
    const bytes=payloads.get(id);if(!manifest||!bytes)throw Error('Capture first/unknown asset');
    if(!Number.isInteger(offset)||offset<0||offset>bytes.length)throw Error('Invalid asset offset');
    maxBytes=Math.max(1,Math.min(1048576,Math.floor(maxBytes)));
    const end=Math.min(bytes.length,offset+maxBytes);
    return {id,offset,nextOffset:end,done:end===bytes.length,byteLength:bytes.length,base64:base64(bytes.subarray(offset,end))};
  }
  globalThis.__ghCompiledMaterials={capture,manifest:()=>manifest,readAsset,release(){manifest=null;payloads.clear();}};
})();
