# Candidate: complete shader polling and dormant FX draw preparation

This default-off Web candidate is based on browser BASE3b49622/coreb3b and bundled Three180. It changes renderer preparation only. It retains1080p High, reflection<=30Hz, all native AI/gameplay, existing render passes and the existing real-draw GPU fence. It is not a Godot PSO/.res/SPIR-V transplant and makes no measured FPS or first-use improvement claim.

## Verified gaps and bounded change

The baseline already does compileAsync, actual world/VM draws, reflection/shadow/composer work, body-fade material preparation, a restored visible-output draw and a GPU fence before entry. Repeating the same API would not address an identified gap.

Two actual owning paths are incomplete:

1. Renderer `compile` prepares BackSide and FrontSide programs for double-sided transparent materials. The existing `compileAsync` polls only `material.currentProgram` (the last program). The candidate polls every retained program in that material's actual program map, preserving existing context-generation/loss/deadline behavior. Default mode keeps the old polling path.
2. Original `mb` particle/distortion pools and `$w` VM muzzle start at zero `geometry.instanceCount`. Compile traversal sees their materials, but no instances exercise their real binding/layout path. Candidate preparation temporarily sets zero count to one, makes their existing ancestor chain visible and disables their mesh frustum culling. It then uses the **existing** offscreen world/VM/full-pipeline draws. It restores count/visibility/culling before the existing final visible-output draw, and again in outer finally. No buffer values, materials, factories, spawn/update functions or RNG are touched by this transaction. Active counts stay unchanged. Unknown capacity/type/ownership and shadow-casting pools fail closed.

The three explicit owners are `fx.p.mesh`, `fx.distort.mesh`, and `vm.fl.mesh`; actual constructors/layouts are exercised by CPU tests. No generic scene-wide priming or background draw loop is added. These are original zero-data slots, not manufactured gameplay effects. This adds an actual instance draw. Existing zero-count rendering can already bind state or upload resources before its final draw is skipped, so this is not a claim that all those uploads were previously missing. It does not prove every data-dependent shader branch or GPU-driver specialization is covered.

The original depth/FX/reflection bindings, render-target sizes,4x samples, postprocessing and fence remain. The normal rendering/simulation loop has no new observer wrapper. KHR completion is distinguished from link validity, draw completion and physical presentation. The [KHRonos extension specification](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/) defines nonblocking completion polling; the [actual Three180 renderer source](https://github.com/mrdoob/three.js/blob/r180/src/renderers/WebGLRenderer.js) is the relevant upstream API reference, while the checked-in bundled implementation is the source of truth for this patch.

## Enable and inspect

Use `?shaderWarmup=1` on the initial game navigation, or set this before that navigation with a harness init script:

```js
globalThis.__GH_SHADER_WARMUP_CANDIDATE = true;
```

The flag is captured once by bootstrap. Default is false. Do not enable after startup and claim the initial preparation used it. Root owns browser/GPU launches; none was performed by the authoring agent.

Read `GHBoot.shaderWarmupStatus()` outside the timed window. It returns cached metadata only:

- `enabled`, `rendererReady`, `pending`, `error`, `shaderJobs`, `shaderErrors`;
- `lastPreparation.coverage.pools`: before/warm count and native attribute capacity;
- `retainedPrograms`: retained/complete/allComplete plus `completionOnly:true`;
- existing jobs/compile/resource-pass/fence wall spans, before/after program count;
- bounded32-entry `history` for successful current-generation preparations.

`rendererReady` describes the original renderer preparation gate, not complete audio/runtime or every possible future program. The retained-program summary is sampled once after preparation's real draw fence; status reads do not poll GL. Link errors remain governed by the existing shader error callback/job failure. Timings are JS wall spans, not isolated GPU time. Keep total startup/entry and subsequent complete active-frame populations separately; increased preparation cost cannot be hidden behind a better warm statistic.

## Tests and remaining hardware gates

CPU tests use actual bundled particle/distortion/muzzle constructors and the actual extracted compileAsync function. They check typed-array bytes and RNG-call count, visibility/count/culling restoration, validation rollback and thrown-render cleanup, active counts, transparent-side completion, default behavior and context loss. Existing preparation tests cover serialized quality/resize, stale completion invalidation, shader-job drain and draw-fence readiness. No CPU test establishes GPU pixel parity or speed.

Root must still run shader-only browser smoke, High/scale/equipment/context recovery, complete native9bot3600tick/eight strict exports, shader/GL/error review and original fixed-input visual/coverage checks. Capture the status before and after the scenario, preserve all long frames and dropped debt, and compare cold/entry/steady populations separately. Require retained-program/coverage evidence; do not treat shader completion alone as full High acceptance. The baseline full-run population and candidate must use the same scenario/seed/flags/cache policy. No benchmark freeze, shortened workload, AI suppression or first-frame deletion is introduced here.

Deliberately unresolved: compile-only world-mag scratch clones, later weapon/material/light combinations not instantiated yet, and data-dependent dynamic FX input branches. Attaching scratch mag casters can allocate lazy depth-material clones/UUIDs and move RNG consumption, so this candidate does not perform that broader change. Existing baseline has proven world/reflection/shadow/post/transparent/fade preparation; this patch targets its three zero-instance paths and retained-program completion only. Hardware eight-export/visual gates remain necessary to detect indirect renderer allocation effects rather than assuming CPU transaction tests prove complete gameplay equivalence.

Local validation: `npm test`137/137 passed; core/helper syntax and `git diff --check` passed. Browser/GPU/GL/pixel/eight-export and performance gates remain unexecuted by this agent.
