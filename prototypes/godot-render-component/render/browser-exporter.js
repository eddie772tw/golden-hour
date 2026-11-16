/* Explicit diagnostic eval on a ready PAUSED native scene, outside measurements.
 * No renderer/RAF/audio/network call. Caches/matrices are refreshed, not simulation.
 * __ghGodotExport.capture({coreSHA256}) returns JSON-safe real-scene data. */
(() => {
  'use strict';
  const finite = (value, label) => { if (!Number.isFinite(value)) throw Error('Non-finite ' + label); return value; };
  const nums = value => Array.from(value, v => finite(v, 'array'));
  const color = c => c ? [c.r, c.g, c.b] : [1, 1, 1];
  let stream = null, pending = '', streamDone = false, streamChars = 0;
  function* tokens(value) {
    if (Array.isArray(value)) {
      yield '[';
      if (value.length && typeof value[0] === 'number') {
        // The largest temporary serialization is16K numbers, never the full scene.
        for(let i=0;i<value.length;i+=16384){if(i)yield ',';yield JSON.stringify(value.slice(i,i+16384)).slice(1,-1);}
      } else for(let i=0;i<value.length;i++){if(i)yield ',';yield* tokens(value[i]);}
      yield ']';
    } else if (value && typeof value === 'object') {
      yield '{';let first=true;
      for(const key of Object.keys(value)){if(value[key]===undefined)continue;if(!first)yield ',';first=false;yield JSON.stringify(key)+':';yield* tokens(value[key]);}
      yield '}';
    } else yield JSON.stringify(value) ?? 'null';
  }
  function header() {
    const data=globalThis.__ghGodotSnapshot;if(!data)throw Error('Capture first');
    let numericArrays=0,numericScalars=0;const largest=[];
    function walk(value,path){if(Array.isArray(value)){
      if(value.length&&typeof value[0]==='number'){
        numericArrays++;numericScalars+=value.length;let sampledChars=0;const sample=Math.min(value.length,64);
        for(let i=0;i<sample;i++)sampledChars+=String(value[i]).length+1;
        largest.push({path,length:value.length,estimatedJSONBytes:Math.ceil(value.length*sampledChars/sample)+2});return;
      }value.forEach((v,i)=>walk(v,path+'/'+i));
    }else if(value&&typeof value==='object')for(const[key,v]of Object.entries(value))walk(v,path+'/'+key);}
    walk(data,'');largest.sort((a,b)=>b.length-a.length);
    return{schema:data.schema,source:data.source,counts:data.counts,parity:data.parity,exportMS:data.exportMS,
      inventory:{numericArrays,numericScalars,numericPayloadBytesFloat64Estimate:numericScalars*8,estimatedNumericJSONBytes:largest.reduce((n,r)=>n+r.estimatedJSONBytes,0),largest:largest.slice(0,20)},
      unsupportedCount:data.unsupported.length,storedGlobal:'__ghGodotSnapshot',fullSerializationAttempted:false};
  }
  function begin(){if(!globalThis.__ghGodotSnapshot)throw Error('Capture first');stream=tokens(globalThis.__ghGodotSnapshot);pending='';streamDone=false;streamChars=0;return{ready:true};}
  function readChunk(maxChars=1048576){
    maxChars=Math.max(1024,Math.min(4194304,Math.floor(maxChars)));if(!stream)begin();
    while(pending.length<maxChars&&!streamDone){const next=stream.next();if(next.done)streamDone=true;else pending+=next.value;}
    let cut=Math.min(maxChars,pending.length);
    if(cut>0&&cut<pending.length&&pending.charCodeAt(cut-1)>=0xd800&&pending.charCodeAt(cut-1)<=0xdbff&&pending.charCodeAt(cut)>=0xdc00&&pending.charCodeAt(cut)<=0xdfff)cut++;
    const chunk=pending.slice(0,cut);pending=pending.slice(cut);streamChars+=chunk.length;
    return{chunk,done:streamDone&&!pending.length,totalChars:streamChars};
  }
  function attribute(a) {
    if (!a) return null;
    const data = [], readers = ['getX','getY','getZ','getW'];
    if (a.itemSize > 4) throw Error('Unsupported attribute width ' + a.itemSize);
    for (let i=0;i<a.count;i++) for(let j=0;j<a.itemSize;j++) data.push(finite(a[readers[j]](i),'attribute'));
    return { itemSize:a.itemSize, count:a.count, normalized:!!a.normalized, values:data };
  }
  function capture(options = {}) {
    const gh=globalThis.GH, d=gh?.debug, gfx=d?.gfx;
    if (!gh?.ready || !gfx?.scene) throw Error('Ready native GH scene required');
    if (gh.G.state === 'playing' && options.allowPlaying !== true) throw Error('Pause native scene before synchronous export');
    const start=performance.now(), scene=gfx.scene, camera=gfx.camera;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const owners=new WeakMap();
    function own(root, owner, path='') {
      if (!root?.isObject3D) return;
      const list=owners.get(root)||[]; list.push({...owner,path}); owners.set(root,list);
      root.children.forEach((child,i)=>own(child,owner,path+'/'+i+':'+child.name));
    }
    (d.match?.bots||[]).forEach((bot,i)=>(bot.rigs||[]).forEach((rig,j)=>own(rig.root,{kind:'actor',actor:i+1,rig:j,stableKey:'actor/'+(i+1)+'/rig/'+j})));
    if (d.fpbody?.rig?.root) own(d.fpbody.rig.root,{kind:'actor',actor:0,rig:0,stableKey:'actor/0/fp'});
    const k9=d.match?.k9?.rigs?.()||[]; Array.from(k9).forEach((rig,i)=>own(rig.root,{kind:'k9',rig:i,team:rig.team??null,stableKey:'k9/rig/'+i}));
    (d.physics?.bodies||[]).forEach((body,i)=>own(body.obj||body.char?.root,{kind:'physics',index:i,type:body.type,propIndex:d.physics.props.indexOf(body),prop:typeof body.prop==='string'?body.prop:typeof body.name==='string'?body.name:null,temp:!!body.temp,stableKey:'physics/body/'+i}));
    const geometries={}, materials={}, objects=[], lights=[], unsupported=[], omitted={hidden:0,noPosition:0,unsupportedObject:0};
    const limits={objects:options.maxObjects??20000,vertices:options.maxVertices??15000000};
    let vertices=0, refs=0, triangles=0, surfaces=0, instances=0, bakedSkins=0;
    const gap=(kind,id,detail)=>unsupported.push({kind,id,detail});
    function material(m) {
      if(!m)return null; if(materials[m.uuid])return m.uuid;
      const textures={}; for(const key of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap','envMap','displacementMap'])if(m[key]){
        const t=m[key], image=t.image||t.source?.data; textures[key]={id:t.uuid,width:image?.width??null,height:image?.height??null,type:t.type,format:t.format,colorSpace:t.colorSpace,flipY:t.flipY};
      }
      materials[m.uuid]={id:m.uuid,name:m.name,type:m.type,color:color(m.color),emissive:color(m.emissive||{r:0,g:0,b:0}),emissiveIntensity:m.emissiveIntensity??1,
        roughness:m.roughness??1,metalness:m.metalness??0,opacity:m.opacity??1,transparent:!!m.transparent,alphaTest:m.alphaTest??0,
        side:m.side,blending:m.blending,depthWrite:m.depthWrite!==false,depthTest:m.depthTest!==false,colorWrite:m.colorWrite!==false,stencilWrite:m.stencilWrite===true,
        vertexColors:!!m.vertexColors,visible:m.visible!==false,forceSinglePass:!!m.forceSinglePass,wireframe:!!m.wireframe,size:m.size??1,textures,
        shaderMaterial:!!(m.isShaderMaterial||m.isRawShaderMaterial),customCompile:!!m._ghUser,renderOrderNotMapped:true};
      if(Object.keys(textures).length)gap('textures_metadata_only',m.uuid,Object.keys(textures));
      if(m.isShaderMaterial||m.isRawShaderMaterial||m._ghUser)gap('custom_shader_not_translated',m.uuid,m.type);
      if(m.transparent&&m.side===2&&!m.forceSinglePass)gap('native_two_pass_transparency_not_recreated',m.uuid,'Godot two-sided standard material differs');
      if(m.colorWrite===false)gap('color_write_mask_not_mapped',m.uuid,'Do not interpret resulting pixels as equivalent');
      return m.uuid;
    }
    function geometry(o) {
      const g=o.geometry, baked=!!o.isSkinnedMesh||!!o.morphTargetInfluences?.some(v=>v!==0), id=g.uuid+(baked?':pose:'+o.uuid:'');
      if(geometries[id])return id;
      let p=attribute(g.attributes.position), normal=attribute(g.attributes.normal);
      if(baked){
        o.skeleton?.update(); const v=new camera.position.constructor(), values=[];
        for(let i=0;i<p.count;i++){o.getVertexPosition(i,v);values.push(v.x,v.y,v.z);} p={...p,values};
        // Recompute area-weighted normals on frozen real topology; not native skin-normal/tangent parity.
        const n=new Float64Array(p.count*3), ix=g.index?.array;
        const count=ix?.length??p.count;
        for(let k=0;k+2<count;k+=3){const a=(ix?ix[k]:k)*3,b=(ix?ix[k+1]:k+1)*3,c=(ix?ix[k+2]:k+2)*3;
          const ux=values[b]-values[a],uy=values[b+1]-values[a+1],uz=values[b+2]-values[a+2],vx=values[c]-values[a],vy=values[c+1]-values[a+1],vz=values[c+2]-values[a+2];
          const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
          for(const at of[a,b,c]){n[at]+=nx;n[at+1]+=ny;n[at+2]+=nz;}}
        for(let k=0;k<n.length;k+=3){const len=Math.hypot(n[k],n[k+1],n[k+2])||1;n[k]/=len;n[k+1]/=len;n[k+2]/=len;}
        normal={itemSize:3,count:p.count,values:nums(n)}; bakedSkins+=Number(!!o.isSkinnedMesh);
        gap('frozen_pose_normals_approximate',o.uuid,'CPU native getVertexPosition positions; recomputed normals; no tangent/skin animation equivalence');
      }
      vertices+=p.count;if(vertices>limits.vertices)throw Error('Vertex cap exceeded; no truncated export accepted');
      geometries[id]={id,sourceID:g.uuid,type:g.type,position:p,normal,uv:attribute(g.attributes.uv),color:attribute(g.attributes.color),
        index:g.index?nums(g.index.array):null,groups:g.groups.map(v=>({...v})),drawRange:{start:g.drawRange.start,count:Number.isFinite(g.drawRange.count)?g.drawRange.count:null},
        extraAttributes:Object.keys(g.attributes).filter(k=>!['position','normal','uv','color'].includes(k)),
        nativeInstanceCount:g.isInstancedBufferGeometry?Math.min(Number.isFinite(g.instanceCount)?g.instanceCount:Infinity,g._maxInstanceCount??Infinity):null,frozenPose:baked,
        normalPolicy:baked?'recomputed_area_weighted_approximation':'original',morphAttributes:Object.keys(g.morphAttributes||{})};
      return id;
    }
    function visit(o,visible,path,ancestorLayers) {
      visible=visible&&o.visible!==false;
      if(o.isLight){lights.push({id:o.uuid,name:o.name,type:o.type,matrix:nums(o.matrixWorld.elements),position:nums(o.getWorldPosition(new camera.position.constructor()).toArray()),
        target:o.target?nums(o.target.getWorldPosition(new camera.position.constructor()).toArray()):null,color:color(o.color),intensity:o.intensity,distance:o.distance??0,decay:o.decay??null,
        angle:o.angle??null,penumbra:o.penumbra??null,visible,layers:o.layers.mask,castShadow:!!o.castShadow,shadowMapSize:o.shadow?.mapSize?.toArray()??null});}
      if(o.isMesh||o.isPoints||o.isLine){
        if(!visible&&options.includeHidden!==true)omitted.hidden++;
        else if(!o.geometry?.attributes?.position)omitted.noPosition++;
        else{
          if(objects.length>=limits.objects)throw Error('Object cap exceeded; no truncated export accepted');
          const gid=geometry(o), g=geometries[gid], source=o.geometry, total=source.index?.count??source.attributes.position.count;
          const mode=o.isPoints?'points':o.isLineSegments?'lines':o.isLine?'line_strip':'triangles';
          const mats=Array.isArray(o.material)?o.material:[o.material], ids=mats.map(material), ranges=Array.isArray(o.material)?source.groups:[{start:0,count:total,materialIndex:0}];
          const ss=[];for(const range of ranges){const start=Math.max(0,range.start,source.drawRange.start),end=Math.min(total,range.start+range.count,source.drawRange.start+source.drawRange.count);
            if(end<=start||!mats[range.materialIndex]?.visible)continue;
            const indices=[];for(let i=start;i<end;i++)indices.push(g.index?g.index[i]:i);if(o.isLineLoop&&indices.length>1)indices.push(indices[0]);
            ss.push({material:ids[range.materialIndex],slot:range.materialIndex,mode,start,count:indices.length,indices});}
          const inst=o.isInstancedMesh?{count:o.count,matrices:nums(o.instanceMatrix.array.subarray(0,o.count*16)),colors:o.instanceColor?attribute(o.instanceColor):null}:null;
          if(source.isInstancedBufferGeometry&&!Number.isFinite(g.nativeInstanceCount))throw Error('Unresolved native instanced geometry count '+o.uuid);
          if(source.isInstancedBufferGeometry)gap('shader_instanced_geometry_positions_not_translated',o.uuid,g.nativeInstanceCount);
          objects.push({id:o.uuid,nativeID:o.id,name:o.name,type:o.type,path,parentID:o.parent?.uuid??null,owners:owners.get(o)||[],matrix:nums(o.matrixWorld.elements),geometry:gid,materials:ids,surfaces:ss,
            topologyKey:gid+'|'+ss.map(s=>s.mode+':'+s.start+':'+s.count).join('|'),visible,ownVisible:o.visible!==false,layers:o.layers.mask,ancestorLayers,
            frustumCulled:o.frustumCulled!==false,castShadow:!!o.castShadow,receiveShadow:!!o.receiveShadow,renderOrder:o.renderOrder,instances:inst,
            skin:o.isSkinnedMesh?{frozen:true,bindMatrix:nums(o.bindMatrix.elements),bindMatrixInverse:nums(o.bindMatrixInverse.elements),bones:o.skeleton.bones.map((b,i)=>({id:b.uuid,name:b.name,parent:o.skeleton.bones.indexOf(b.parent),matrix:nums(b.matrixWorld.elements),inverse:nums(o.skeleton.boneInverses[i].elements)}))}:null});
          refs+=g.position.count;instances+=inst?.count??g.nativeInstanceCount??1;surfaces+=ss.length;
          triangles+=ss.filter(s=>s.mode==='triangles').reduce((n,s)=>n+Math.floor(s.indices.length/3)*(inst?.count??g.nativeInstanceCount??1),0);
          if(g.extraAttributes.length)gap('custom_vertex_attributes_not_evaluated',o.uuid,g.extraAttributes);
          if((o.layers.mask>>>20)!==0)gap('layers_above_godot20',o.uuid,o.layers.mask);
          if(o.renderOrder)gap('render_order_not_exactly_mapped',o.uuid,o.renderOrder);
          if(o.isLineLoop)gap('line_loop_expanded',o.uuid,'closing index appended');
        }
      } else if(o.isSprite){omitted.unsupportedObject++;gap('sprite_not_exported',o.uuid,o.name);}
      o.children.forEach((child,i)=>visit(child,visible,path+'/'+i+':'+child.name,[...ancestorLayers,o.layers.mask]));
    }
    visit(scene,true,'world',[]);
    const result={schema:'gh-godot-render-snapshot-v1',source:{capturedFrom:'GH.debug.gfx.scene',coreSHA256:options.coreSHA256??null,pageBundle:document.documentElement.dataset.bundle??null,
      quality:gfx.quality,tick:gh.benchmark?.tick??gh.loopStats?.logicalTicks??null,state:gh.G.state,capturedAt:performance.timeOrigin+start,viewport:[gfx.renderer.domElement.width,gfx.renderer.domElement.height],
      camera:{matrix:nums(camera.matrixWorld.elements),projection:nums(camera.projectionMatrix.elements),fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far,layers:camera.layers.mask,zoom:camera.zoom},
      rendererInfo:{scope:'last native gfx including all passes; NOT a main-only comparator',calls:gfx.renderer.info.render.calls,triangles:gfx.renderer.info.render.triangles,points:gfx.renderer.info.render.points,lines:gfx.renderer.info.render.lines},
      background:scene.background?.isColor?color(scene.background):null,environmentIntensity:scene.environmentIntensity},
      counts:{objects:objects.length,geometries:Object.keys(geometries).length,materials:Object.keys(materials).length,uniqueExportedVertices:vertices,objectVertexReferences:refs,surfaces,instances,enumeratedTriangles:triangles,bakedSkins,lights:lights.length,omitted},
      geometries,materials,objects,lights,unsupported,
      parity:{renderOnly:true,frozenScene:true,fullAI:false,highParity:false,additionalBatching:false,
        gaps:['No Three GLSL/custom attributes translation','Textures/env maps metadata only','No planar reflection/AO/bloom/FX/VM/postprocess matching','Frozen skin positions with approximate recomputed normals','Light energy/shadow/filter/tone-map models differ','Godot20 vs Three32 render layers','Transparent ordering/two-sided pass semantics differ','No gameplay/audio/physics/nav/animation'],includeHidden:options.includeHidden===true},
      exportMS:performance.now()-start};
    globalThis.__ghGodotSnapshot=result;stream=null;return header();
  }
  globalThis.__ghGodotExport={version:'gh-godot-render-snapshot-v1',capture,header,begin,readChunk,
    release(){globalThis.__ghGodotSnapshot=null;stream=null;pending='';return{released:true};}};
  return {installed:true,api:'capture({coreSHA256}) -> small header; begin(); readChunk(1048576) until done; release()'};
})();
