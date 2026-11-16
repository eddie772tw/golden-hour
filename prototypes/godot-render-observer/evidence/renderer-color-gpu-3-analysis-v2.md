# Offline native GPU observer review

Diagnostic frozen PBR component only; no full AI/High/FPS acceptance. Raw `gpu_validated:false` is unchanged.

Samples: 122 accepted, 121 nonempty, 1 startup empty. Pending at shutdown: `True`.

Selected mapped window: 119 frames. See JSON for exact missing-window and token/ring mapping.

CPU/GPU values below are **disjoint adjacent-marker intervals**, in milliseconds. Structural markers are omitted here; JSON retains every interval. Repeated same-path markers are summed per frame. Inclusive group totals are separately reported and must not be added.

| Marker path | n | CPU P50 | CPU P95 | GPU P50 | GPU P95 |
|---|---:|---:|---:|---:|---:|
| Render Viewports / Render Viewport 0 / Render 3D Scene / Render Opaque Pass | 119 | 0.125000 | 0.173500 | 1.145360 | 1.154032 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Render Directional/SpotLight Shadows | 119 | 0.297000 | 0.426300 | 1.111760 | 1.120324 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Render Depth Pre-Pass | 119 | 0.110000 | 0.165100 | 0.424440 | 0.426964 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Render 3D Transparent Pass | 119 | 0.046000 | 0.067100 | 0.302760 | 0.309444 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Resolve | 119 | 0.006000 | 0.008100 | 0.095480 | 0.096724 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Setup Shadows | 119 | 0.003000 | 0.005000 | 0.037240 | 0.038616 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Tonemap | 119 | 0.009000 | 0.015000 | 0.026200 | 0.026680 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Bake 3D Cluster / Render 3D Cluster Elements | 119 | 0.004000 | 0.006000 | 0.022200 | 0.022400 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Pre Opaque Render | 119 | 0.010000 | 0.014000 | 0.012560 | 0.012892 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Bake 3D Cluster / Pack 3D Cluster Elements | 119 | 0.003000 | 0.004000 | 0.010480 | 0.010804 |
| Render Viewports / Render Viewport 0 / Render Canvas 1 / Render CanvasItems | 119 | 0.023000 | 0.032000 | 0.007960 | 0.008244 |
| Render Viewports / Render Viewport 0 / Render Canvas 0 / Render CanvasItems | 119 | 0.003000 | 0.004000 | 0.003680 | 0.003844 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Setup 3D Scene | 119 | 0.076000 | 0.109200 | 0.002640 | 0.003040 |
| Frame Begin | 119 | 0.001000 | 0.002000 | 0.000080 | 0.000080 |
| Prepare Render Frame | 119 | 0.015000 | 0.025000 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Cull 3D Scene | 119 | 0.007000 | 0.011000 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Cull DirectionalLight3D, Split 0 | 119 | 0.003000 | 0.005000 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Cull DirectionalLight3D, Split 1 | 119 | 0.002000 | 0.003000 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Cull DirectionalLight3D, Split 2 | 119 | 0.002000 | 0.003000 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Cull DirectionalLight3D, Split 3 | 119 | 0.061000 | 0.086100 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Prepare 3D Scene | 119 | 0.002000 | 0.003100 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Render 3D Scene | 119 | 0.003000 | 0.005000 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Update Occlusion Buffer | 119 | 0.005000 | 0.008000 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Update Visibility Dependencies | 119 | 0.000000 | 0.001000 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Render Canvas 1 / Cull CanvasItem Tree | 119 | 0.008000 | 0.014100 | 0.000080 | 0.000080 |
| Render Viewports / Render Viewport 0 / Cull 2D Lights | 119 | 0.003000 | 0.004100 | 0.000000 | 0.000040 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Process Post Opaque Compositor Effects | 119 | 0.000000 | 0.001000 | 0.000000 | 0.000040 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Process Post Sky Compositor Effects | 119 | 0.001000 | 0.001000 | 0.000000 | 0.000004 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Process Post Transparent Compositor Effects | 119 | 0.000000 | 0.001000 | 0.000000 | 0.000040 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Process Pre Opaque Compositor Effects | 119 | 0.001000 | 0.002000 | 0.000000 | 0.000004 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Process Pre Transparent Compositor Effects | 119 | 0.000000 | 0.001000 | 0.000000 | 0.000040 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Resolve Depth Pre-Pass (MSAA) | 119 | 0.001000 | 0.002000 | 0.000000 | 0.000040 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Resolve MSAA | 119 | 0.000000 | 0.001000 | 0.000000 | 0.000040 |
| Render Viewports / Render Viewport 0 / Render 3D Scene / Update Volumetric Fog | 119 | 0.001000 | 0.002100 | 0.000000 | 0.000040 |
| Render Viewports / Render Viewport 0 / Render Canvas 0 / Cull CanvasItem Tree | 119 | 0.012000 | 0.019000 | 0.000000 | 0.000000 |
