shader_type spatial;
// GL source20294: custom ONE+ONE, alpha1 => additive RGB, no depth write.
// No shadow/visibility/geometry override. Native High's exact uK0 branch discards.
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, fog_disabled;
uniform vec3 shaft_color = vec3(1.0, 0.52, 0.2);
uniform float source_time = 0.0;
uniform float source_k = 0.0;
varying float v_t;
varying vec3 v_n;
varying vec3 v_w;
float h(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p) { vec2 i=floor(p), f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
void vertex() {
    int k=VERTEX_ID%6;
    v_t=(k==2 || k==4 || k==5)?1.0:0.0;
    v_n=NORMAL;
    v_w=VERTEX;
    // Source ignores modelMatrix; guarded owner has identity world transform.
}
void fragment() {
    if(source_k<=0.0) discard;
    vec3 v=CAMERA_POSITION_WORLD-v_w;
    float d=length(v); v/=d;
    float facing=abs(dot(normalize(v_n),v));
    float fade=pow(clamp(1.0-v_t,0.0,1.0),1.6)*smoothstep(0.0,0.03,v_t);
    float n=0.55+0.45*vn(v_w.xz*0.9+vec2(source_time*0.07,v_w.y*0.7-source_time*0.04));
    float a=fade*facing*n*source_k*smoothstep(0.4,2.5,d);
    ALBEDO=shaft_color*a;
    ALPHA=1.0;
}
