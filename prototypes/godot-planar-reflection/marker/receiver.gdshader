shader_type spatial;
render_mode unshaded;
uniform sampler2D reflection_texture : filter_linear, repeat_disable;
uniform mat4 reflection_view_projection;
uniform bool flip_y = true;
varying vec3 original_world_position;
void vertex() { original_world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
 vec4 clip = reflection_view_projection * vec4(original_world_position, 1.0);
 vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
 if (flip_y) uv.y = 1.0 - uv.y;
 vec3 reflected = textureLod(reflection_texture, uv, 0.0).rgb;
 float fresnel = 0.055 + 0.945 * pow(clamp(1.0 - dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), 5.0);
 ALBEDO = vec3(0.015) + min(reflected, vec3(9.0)) * fresnel;
 // Sharp/roughness=0 projection oracle only: complete source mip rough-blur is pending.
}
