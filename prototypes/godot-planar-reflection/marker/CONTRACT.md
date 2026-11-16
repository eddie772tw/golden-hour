# Original High planar reflection contract

Pinned game core: `b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b`. This is source/compiled-program research and a NEW isolated colored-marker oracle. No original GFX, native-world, Node producer, published package or AI tick path is modified. No GPU was launched by this investigation.

## Original owners, not SSR

| Owner | Verified behavior |
|---|---|
| Core18763, High preset | `refl=.5`, `reflectionHz=30`, main samples4, shadow4096; High has no shadowHz override, so BM uses60 fallback |
| BM.constructor18905 | Renderer `NoToneMapping`, global shadowMap.autoUpdate=false |
| BM.render19020..19049 | One shared scene-matrix snapshot; render clock advances by render dt; shadow needs-update is scheduled before reflection; reflection runs before composer, at most once per render call and after≥1/30 accumulated render seconds; quality/build resets `_reflectAt=null` |
| QM.constructor21058 / render21094 | One horizontal world plane **Y=0**. Skip if source cameraY≤.02; keep old target/matrix rather than clear. This is a reflected camera world render, not screen-space tracing |
| QM.setSize21060 | Width/height floor(mainSize×.5), minimum2;1920×1080→960×540. RGBA half-float target, depth buffer, no multisample option, linear mip-linear minification, mipmaps enabled |
| QM.render21098..21100 | Reflect position, forward target and up aboutY=0. Preserve source near/far and base projection. Build projective texture matrix with0.5 scale/bias. Then modify projection Z row for oblique near-plane clipping, with source depth-bias term.003. The texture matrix is constructed from the **pre-oblique** projection |
| QM.render21101..21107 | Hide explicit flare list, temporarily set shared `tRefl=null` to prevent recursive read, clear/draw raw scene once, restore target/cube-face/mipmap index/tRefl/visible flags in finally |
| Setup50810..50820 | Four receiver material families: marble k1/blur0/rough6.5; oak.6/1.4/7.5; kitchen.55/1/7.5; terrace.22/2.4/7 |

Reflection camera enables Three layers0 and1 (mask3). Before it runs, FX.mirror20403 temporarily moves main primary particles from layer2 to1 and disables soft-depth sampling; distortion layer3 remains excluded. First-person wrapper50218..50224 enables its full reflection representation and restores it, including ground/puddle visibility. This is not the separate viewmodel scene: VM is rendered later by the composer. A native implementation must preserve these view-specific contributions rather than draw only the currently visible first-person subset.

The mirror pass calls renderer.render directly. It does **not** run GTAO/composer bloom/meter/VM/final postprocessing on the reflection texture. It can trigger the scheduled original shadow-map update first; the global needsUpdate flag is then cleared by WebGLShadowMap15392 so the following main render normally reuses that update. Godot sharedWorld3D does not itself prove identical per-camera directional shadow work or shadow reuse. That needs a separate lit two-view GPU marker gate.

## Receiver math and HDR

Actual compiled floor variant `c70/c71` in `compiled-materials-tick240-1-compiled-assets/manifest.json` confirms all four materials retain the floorRefl cache key, projective matrix, textureLod, and additive clamp path. Their vertex/fragment hashes and checks are in `compiled-proof.json`; no shader recompilation was performed. Captured custom-uniform export does not expose every reflection uniform value, so those values are attributed to the owning source, not invented from the compiled manifest.

Only upward world faces within `abs(worldY)<.03` and transformed object-normalY>.9 receive reflection. The sampled UV is projective XY/W plus `(perturbedViewNormal.xy - derivativeGeometricViewNormal.xy)*.085`. Actual material roughnessFactor, after the original custom material hook, controls mip LOD: `roughness*reflRough + reflBlur`. Do not use the scalar source material roughness1 as evidence that reflection vanishes: the original GH surface shader changes that factor.

Reflection contribution is **added to outgoing linear light** before opaque output:

```text
min(sampledLinearHDR, 9) * (0.055 + 0.945*(1-dot(N,V))^5)
                         * (1-roughness)^2 * receiverK
```

It is not alpha blending, replacement of base lighting, SSR, or a second display-tonemapped image. The main game applies its own later composite/final color pipeline. Half-float, mip filtering, source roughness/normal perturbation and that later final shader all remain requirements for full High parity.

## Actual Godot4.7.2 route and remaining boundaries

The installed API dump confirms SubViewport `world_3d`, size, UPDATE_DISABLED/UPDATE_ONCE, HDR2D; Camera3D cull mask, environment override, ordinary frustum/projection modes and read-only `get_camera_projection`. Camera3D/RenderingServer have no arbitrary camera projection-matrix setter. `api-proof.json` records those actual bindings. A reflected ordinary camera can match position/forward/up/FOV/near/far with the same world. It cannot be declared equivalent to Three oblique projection just by changing near distance.

The official4.7 spatial shader exposes `CAMERA_VISIBLE_LAYERS` in vertex and fragment processors, so a reserved view bit can select a **per-view world-plane discard** in custom shaders without toggling shared object visibility. This preserves the main view in the small oracle. It does not automatically patch StandardMaterial3D, every custom material, depth prepass, particles or shadow variants, and is not yet proof of the original .003 oblique clip behavior. Shader projection override is possible within custom vertex code, but any future exact oblique path must derive Godot's actual reverse-Z/depth/Y correction rather than copy Three's Z-row indices into an already corrected matrix. [Official shader built-ins](https://docs.godotengine.org/en/4.7/tutorials/shaders/shader_reference/spatial_shader.html).

For HDR, use a camera-specific **Linear** environment at exposure1, adjustments/glow disabled, plus `SubViewport.use_hdr_2d=true`. Pinned `tonemap.glsl:246` returns input unchanged for Linear; renderer_scene_render_rd.cpp681/752 disables sRGB conversion when writing an HDR target. A shared world with the same main ACES environment would run that curve in both views. HDR2D alone does not disable the environment curve. The colored oracle requires an emitted red4 to remain4±.2 in the reflected Image, preventing a clamped/converted/ACES texture from silently passing. Main output uses ACES once only as this diagnostic's configuration; it is not the original game's complete final-shader parity. [Pinned tone shader](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/servers/rendering/renderer_rd/shaders/effects/tonemap.glsl#L246), [HDR output setup](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/servers/rendering/renderer_rd/renderer_scene_render_rd.cpp#L681).

Godot4.7.2 also has a promising small **built-in mip path**: `DrawableTexture2D.setup(width,height,RGBAH,Color.BLACK,true)`, `blit_rect(..., viewportTexture)`, then `generate_mipmaps()`. The corresponding RS methods and HDR formats are actually bound. This could avoid inventing a custom RD mip generator, but copy timing, linear HDR preservation, filtering and all sampled LODs need a separate oracle. It is not implemented or assumed valid in the first sharp-only proof. `ViewportTexture` itself was not assumed automatically mipmapped. [Official drawable API](https://docs.godotengine.org/en/stable/classes/class_renderingserver.html#class-renderingserver-method-texture-drawable-generate-mipmaps).

## Smallest falsifiable gate sequence

1. **This source-only marker oracle:** shared World3D, mirror camera, per-view plane discard, asymmetric colored markers/expected UV centroids, source HDR4 preserved, receiver excluded from mirror by cull mask, request intervals≥33334µs. It uses only sharp level0 and no shadows/AI. It must pass root GPU/error-log review before any correctness claim.
2. Add actual HDR mip copy/generation and original rough/blur/K/Fresnel/normal perturbation checks. Compare multiple known LODs, not only a flat color.
3. Add a lit moving caster/receiver and verify main/reflection shadow correctness and per-view GPU/CPU submissions. Ensure clip selection does not clip shared shadow data or alter main depth. Include overlapping-plane triangles and camera plane crossings.
4. Only then bind original receiver materials, complete live world/FX/first-person owners and source clock, keeping Node authoritative ticks unchanged. Measure full High with the existing live-AI/state-age contract; the little marker scene is never a migration performance result.
