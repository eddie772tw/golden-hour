# Three explicit source light mappings

This overlay combines independently isolated source decay, direct-energy input
and light-property color corrections. It preserves native defaults so historical
controls can be reproduced. No general renderer framework, arbitrary artistic
scale, material shader change, asset replacement or engine binary is included.

| Native option | Source option | Applied scope |
| --- | --- | --- |
| `--source-decay=0` | `--source-decay=1` | Original PointLight decay→Omni attenuation. Source2 corrects the previous default1 far-field error; source/native near clamps remain different. |
| `--direct-energy=native` | `--direct-energy=source-irradiance` | Source direct intensity/PI→native nonphysical-unit energy. Ambient/environment/emission/exposure stay unchanged. Physical-light-units=true is rejected in source mode. |
| `--light-color=native` | `--light-color=source-linear` | Encode original linear RGB once at Point/Directional/Spot Light3D property boundary, which native LightStorage then decodes. Raw linear PBR shader uniforms are unchanged. |

Defaults are the left column. The Python wrapper forwards all three values and
records them in `lightMappingOptions`; the native report records original and
actual per-light decay, factor/energy and color triplets. Existing artistic
light/emission scales remain diagnostic controls with defaults1. Their old report
label `diagnostic_only_not_unit_conversion` is replaced by the more precise
`artistic_scale_controls_are_diagnostic`; explicit source normalizations now have
their own report blocks. This metadata clarification does not change rendering.

The real scene has13 PointLights and1 DirectionalLight. Its existing unmatched
HemisphereLight and environment mapping remain gaps. Spot color/input convention
shares the official native path, but source spot-cone behavior is not proven by
this scene. No full High/BRDF/near-field or gameplay parity is claimed.

Stage16/17 evidence has separate source/native halves. Source Three runtime
uniform colors are I for the white-unit fixture and its actual directDiffuse
matches same-pipeline unshaded I/PI. Native Forward+ diffuse matches its own
same-pipeline unshaded I. No raw cross-engine encoded pixels are compared.
Energy normalization follows those measurements and actual compiled source.
The color fixture separately contrasts raw property, once-encoded property and
known raw-linear shader references in three distinguishable color channels.
Root native color and real-scene GPU checks now pass: four colored references are distinguishable with exact A-A/expected-channel matches, and the relocated120-frame scene smoke retains all516objects/5.33million vertices with zero engine errors. These remain component checks, not High or performance acceptance.

`render/light_mapping_headless_test.gd` checks actual Godot Light3D objects across
all24 combinations of three native light types and the three flags, plus an
invalid-point-decay explicit fallback. All25 passed on Godot4.7.2 with zero engine
or shader errors. It uses no scene snapshot or GPU and does not assert pixels.

Only the manifest overlay files should be copied into the existing
`public/golden-hour/prototypes/godot-render-component/`. The remaining staged
render files are unchanged Stage15 context for standalone headless checking;
they are hash-compared and need not be replaced. Root integrated the SHA-checked overlay after actual GPU validation. Preserve historical source-scalar/white/guard failure evidence
and all independently frozen source branches.
