shader_type texture_blit;
render_mode blend_disabled;
#include "res://reflection_math.gdshaderinc"
uniform sampler2D source_texture0 : hint_blit_source0, filter_linear_mipmap, repeat_disable;
uniform vec2 sample_uv = vec2(0.5);
uniform float probe_lod = 0.0;
uniform bool apply_receiver = false;
uniform float roughness_factor = 0.0;
uniform float receiver_k = 1.0;
uniform float ndotv = 1.0;
uniform float refl_rough = 6.5;
uniform float refl_blur = 0.0;
void blit() {
 float lod = apply_receiver ? source_planar_lod(roughness_factor, refl_rough, refl_blur) : probe_lod;
 vec3 radiance = textureLod(source_texture0, sample_uv, lod).rgb;
 COLOR0 = vec4(apply_receiver ? source_planar_add(radiance, ndotv, roughness_factor, receiver_k) : radiance, 1.0);
}
