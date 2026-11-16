shader_type spatial;
render_mode unshaded, cull_disabled;
uniform vec3 marker_rgb = vec3(1.0);
uniform bool clip_enabled = false;
varying vec3 original_world_position;
void vertex() {
 original_world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}
void fragment() {
 // Per-view proof only. No shared visibility mutation and no depth convention assumption.
 if (clip_enabled && (CAMERA_VISIBLE_LAYERS & 524288u) != 0u && original_world_position.y < 0.0) discard;
 ALBEDO = marker_rgb;
}
