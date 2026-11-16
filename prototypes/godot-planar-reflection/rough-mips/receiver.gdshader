shader_type spatial;
render_mode unshaded;
#include "res://reflection_math.gdshaderinc"
uniform sampler2D reflection_texture : filter_linear_mipmap, repeat_disable;
uniform mat4 reflection_view_projection;
uniform bool flip_y = true;
uniform float roughness_factor = 0.25;
uniform float receiver_k = 1.0;
uniform float refl_rough = 6.5;
uniform float refl_blur = 0.0;
varying vec3 original_world_position;
void vertex() { original_world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
 vec4 clip = reflection_view_projection * vec4(original_world_position, 1.0);
 vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
 if (flip_y) uv.y = 1.0 - uv.y;
 float lod = source_planar_lod(roughness_factor, refl_rough, refl_blur);
 vec3 radiance = textureLod(reflection_texture, uv, lod).rgb;
 ALBEDO = vec3(0.015) + source_planar_add(radiance, dot(normalize(NORMAL), normalize(VIEW)), roughness_factor, receiver_k);
 // Flat diagnostic receiver: original perturbed-normal UV offset is a later gate.
}
