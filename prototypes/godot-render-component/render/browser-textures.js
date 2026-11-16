/* Explicit same-session CPU asset capture, after geometry capture and before its
 * release. No renderer/RAF/WebGL calls. Root owns browser and binary file writes. */
(() => {
  'use strict';
  const slots={map:{channel:'rgb+a',color:'srgb'},normalMap:{channel:'rgb_xyz',color:'linear'},roughnessMap:{channel:'g',color:'linear'},
    metalnessMap:{channel:'b',color:'linear'},alphaMap:{channel:'g',color:'linear'},emissiveMap:{channel:'rgb',color:'srgb'},aoMap:{channel:'r',color:'linear'}};
  let manifest=null;const assets=new Map();
  const values=v=>v?.toArray?.()??null;
  function bytes64(bytes){let result='';for(let i=0;i<bytes.length;i+=16384)result+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(result);}
  function textureMetadata(t){if(t.matrixAutoUpdate)t.updateMatrix();return{id:t.uuid,type:t.type,format:t.format,internalFormat:t.internalFormat??null,colorSpace:t.colorSpace,
    channel:t.channel??0,flipY:t.flipY!==false,premultiplyAlpha:!!t.premultiplyAlpha,unpackAlignment:t.unpackAlignment,
    wrapS:t.wrapS,wrapT:t.wrapT,magFilter:t.magFilter,minFilter:t.minFilter,anisotropy:t.anisotropy,
    generateMipmaps:!!t.generateMipmaps,manualMipmaps:t.mipmaps?.length??0,matrix:Array.from(t.matrix.elements),
    offset:values(t.offset),repeat:values(t.repeat),center:values(t.center),rotation:t.rotation,mapping:t.mapping,
    isRenderTargetTexture:!!t.isRenderTargetTexture,isDataTexture:!!t.isDataTexture};}
  async function pixels(t){
    const image=t.image||t.source?.data;
    if(t.isRenderTargetTexture||t.isCubeTexture||t.isCompressedTexture||t.isVideoTexture||t.isDataArrayTexture||t.isData3DTexture)throw Error('GPU-only/RT/cube/compressed/video/array/3D texture unsupported');
    if(t.type!==1009||t.format!==1023)throw Error('Only unsigned-byte RGBA first-scope; float/half/depth/other channel formats retained as unsupported');
    if(!image||!image.width||!image.height)throw Error('No ready CPU image');
    const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
    if(image.data){
      if(!(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray)||image.data.byteLength!==width*height*4)throw Error('Non-RGBA8 CPU buffer layout');
      return{bytes:new Uint8Array(image.data),encoding:'rgba8',width,height,lossless:'exact-source-cpu-rgba8',readPath:'data-buffer-copy'};
    }
    if(typeof image.getContext==='function'){
      const ctx=image.getContext('2d');if(!ctx)throw Error('Canvas has no CPU2D context (possibly GPU-only)');
      const colorSpace=ctx.getContextAttributes?.().colorSpace??'srgb';if(colorSpace!=='srgb')throw Error('Non-sRGB Canvas2D backing unsupported, no implicit conversion');
      const data=ctx.getImageData(0,0,width,height).data;
      return{bytes:new Uint8Array(data),encoding:'rgba8',width,height,lossless:'exact-canonical-canvas-getImageData-rgba8',readPath:'existing-canvas2d',alphaNote:'Canvas canonical unpremultiplied8-bit readback; transparent RGB rounding may differ from encoded source'};
    }
    // Preserve original PNG bytes when available; no canvas re-rasterization.
    if(image.src){const url=new URL(image.currentSrc||image.src,location.href);
      if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol))throw Error('Cross-origin image fetch not authorized by this capture');
      const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw Error('Original image fetch '+response.status);
      const data=new Uint8Array(await response.arrayBuffer());
      if(data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71)return{bytes:data,encoding:'png',width,height,lossless:'exact-original-encoded-png',readPath:'same-origin-original-png'};
      throw Error('Original image is not PNG; no lossy re-encode or silent rasterization');
    }
    throw Error('ImageBitmap/unknown image has no exact byte source; not silently canvas-converted');
  }
  async function capture(options={}){
    const gh=globalThis.GH,gfx=gh?.debug?.gfx,snapshot=globalThis.__ghGodotSnapshot;
    if(!gh?.ready||gh.G.state==='playing'||!snapshot)throw Error('Ready paused same-session geometry capture must remain stored');
    assets.clear();manifest=null;const missing=[],liveMaterials=new Map();gfx.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])liveMaterials.set(m.uuid,m);});
    const textures={},materials={},unsupported=[];
    for(const id of Object.keys(snapshot.materials)){
      const m=liveMaterials.get(id);if(!m){missing.push(id);continue;}
      const maps={};for(const[slot,semantic]of Object.entries(slots)){const t=m[slot];if(!t)continue;
        maps[slot]={texture:t.uuid,...semantic};if(textures[t.uuid])continue;
        const meta=textureMetadata(t);textures[t.uuid]=meta;
        try{const asset=await pixels(t);assets.set(t.uuid,asset.bytes);const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',asset.bytes));textures[t.uuid]={...meta,...asset,bytes:undefined,sha256:Array.from(digest,b=>b.toString(16).padStart(2,'0')).join(''),byteLength:asset.bytes.length,file:'textures/t_'+t.uuid+'.'+asset.encoding,status:'captured'};}
        catch(error){textures[t.uuid]={...meta,status:'unsupported',reason:String(error.message)};unsupported.push({kind:'texture-transfer',id:t.uuid,reason:String(error.message)});}
      }
      materials[id]={id,type:m.type,shaderMaterial:!!(m.isShaderMaterial||m.isRawShaderMaterial),customCompile:!!m._ghUser,maps,normalScale:values(m.normalScale),normalMapType:m.normalMapType,aoMapIntensity:m.aoMapIntensity??1,
        bumpMapUnsupported:!!m.bumpMap,displacementMapUnsupported:!!m.displacementMap,envMapUnsupported:!!m.envMap};
      if(m.isShaderMaterial||m.isRawShaderMaterial||m._ghUser)unsupported.push({kind:'custom-shader-not-translated',material:id,type:m.type});
      if(m.envMap)unsupported.push({kind:'environment-not-captured',material:id,texture:m.envMap.uuid});
    }
    if(missing.length)throw Error('Snapshot material IDs do not match live session: '+missing.join(','));
    manifest={schema:'gh-godot-pbr-textures-v1',sessionId:options.sessionId??crypto.randomUUID(),source:{coreSHA256:snapshot.source.coreSHA256,geometryCapturedAt:snapshot.source.capturedAt,tick:snapshot.source.tick,materialIDs:Object.keys(snapshot.materials)},
      textures,materials,unsupported,counts:{textures:Object.keys(textures).length,captured:assets.size,unsupported:Object.values(textures).filter(t=>t.status==='unsupported').length,bytes:[...assets.values()].reduce((n,b)=>n+b.length,0)},
      parity:{highParity:false,transferOnly:true,losslessBaseLevelOnly:true,gaps:['GPU RT/env/float and inaccessible originals unsupported','Original mipmaps not captured; Godot regeneration differs','Separate alphaMap product/UV and per-map sampler differences may not fit StandardMaterial3D','Texture colorSpace/flip/transform metadata is source-authoritative; importer rejects unsupported binding rather than recolor']}};
    return manifest;
  }
  globalThis.__ghGodotTextures={capture,manifest(){if(!manifest)throw Error('Capture first');return manifest;},
    readAsset(id,offset=0,maxBytes=262144){const b=assets.get(id);if(!b)throw Error('Unknown captured asset');offset=Math.max(0,Math.floor(offset));maxBytes=Math.max(1,Math.min(1048576,Math.floor(maxBytes)));const end=Math.min(b.length,offset+maxBytes);return{id,offset,nextOffset:end,done:end===b.length,base64:bytes64(b.subarray(offset,end)),byteLength:b.length};},
    release(){assets.clear();manifest=null;return{released:true};}};
  return{installed:true,api:'await __ghGodotTextures.capture({sessionId}); manifest(); readAsset(id,offset,maxBytes); release()'};
})();
