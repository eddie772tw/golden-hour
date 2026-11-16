# Root runner relocation guidance

The historical runner is `work/godot-native/run_live.py`. A root-owned portable version is now included as `run_live.py`, with `receiver/`, explicit engine/rest-packet arguments and local evidence. The checklist below records the earlier relocation requirements; its proposed scripts/performance location is historical. Its original experiments and source snapshots remain frozen. A public runner should accept explicit Godot executable, project, rest-packet and output locations rather than reading private `work/godot-native/runtime.json` or assuming shipped9MB fixtures.

For a runner installed at `scripts/performance/run_godot_live.py`, derive:

```python
CLIENT = Path(__file__).resolve().parents[2]
BRIDGE = CLIENT / 'prototypes' / 'godot-live-bridge'
LOGIC = CLIENT / 'prototypes' / 'godot-node-logic'
producer = BRIDGE / ('producer-baseline.mjs' if args.producer == 'baseline' else 'producer-interval.mjs')
```

Use `cwd=CLIENT`, an explicit absolute `--output` for Node and separate explicit `--godot-project`, `--skin-packet`, `--godot` and `--out` arguments for the receiver. Keep `--producer baseline|interval` explicit so default changes cannot silently relabel evidence. Godot visible/GPU execution and its approved runtime version remain root-owned. The root current receiver supports the locked GHLPv1 layout and precomposed full affine palettes.

Freeze/snapshot every bridge `.mjs`, its package/provenance files, every sibling logic `.mjs` plus fixtures/provenance, and all receiver `.gd`/project/scene sources before launching. Include original game/core, operators.bin/index bundle version and imported client benchmark/bootstrap helpers in the freeze list, or bind them to a recorded repository commit plus byte hashes. Recheck after exit. Old `HERE/bridge` globbing must not remain after relocation; neither producer now depends on private `work/bridge` files. The published setup SHA is guarded directly by session.mjs.

Keep unique output directories and fail-closed source checks, owned root/descendant cleanup, engine-error checks, actual3600tick/all8exact checks and receiver palette/capture checks. Current outputs must preserve `acceptanceEligible=false`, native-render/headless flags, actual draw vs distinct tick/stale counters, source snapshotHz vs logicHz, debt, clock offset/uncertainty and pose age. Source Node renderFrames is always0. Do not copy a CPU proof's complete status into Godot High/audio acceptance.

If retaining optional process-tree memory sampling, preserve the definition: summed owned RSS/private committed bytes, shared RSS may double count. Initialization/process entry is not packaged cold launch. Keep memory/OS sampling outside any clean timing comparison unless both variants use the identical declared procedure. Neither source byte-size nor ignored node_modules is a measured release package size.
