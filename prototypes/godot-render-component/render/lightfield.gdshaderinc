// Generated from byte-pinned source TY; world inputs replace view-to-world reconstruction only.
uniform sampler3D ghLV : filter_linear, repeat_disable; uniform mat4 ghLVMat; uniform vec3 ghLVOrg; uniform vec3 ghLVInv; uniform vec4 ghLVK; uniform vec4 ghLVT; uniform vec4 ghPool; uniform vec4 ghChand;
float ghLvHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 ghLightVolumeWorld(vec3 worldPos, vec3 worldN) {
  vec3 pw = (ghLVMat * vec4(worldPos, 1.0)).xyz;
  vec3 nw = normalize(mat3(ghLVMat) * worldN);
  vec3 q = clamp((pw + nw * 0.42 - ghLVOrg) * ghLVInv, 0.0, 1.0);
  float v = clamp(q.y, ghLVK.y, 1.0 - ghLVK.y) * 0.5;
  vec3 above = texture(ghLV, vec3(q.x, v, q.z)).rgb, below = texture(ghLV, vec3(q.x, v + 0.5, q.z)).rgb;
  vec3 e = mix(below, above, nw.y * 0.5 + 0.5) * ghLVK.x;
  // water caustics: on the pool shell under water, and thrown up onto whatever stands around the pool
  vec2 pd = max(abs(pw.xz - ghPool.xy) - ghPool.zw, 0.0);
  float nearPool = (1.0 - smoothstep(0.0, 4.2, length(pd))) * (1.0 - smoothstep(0.3, 3.6, pw.y)) * ghLVK.z;
  if (nearPool > 0.002) {
    float t = ghLVT.x; vec2 p = pw.xz * 1.5 + vec2(pw.y * 0.8, pw.y * 0.45);
    vec2 a = p + 0.7 * vec2(sin(p.y * 1.3 + t), cos(p.x * 1.1 - t * 0.8));
    vec2 b = p * 1.37 - 0.6 * vec2(cos(p.y * 0.9 - t * 1.2), sin(p.x * 1.5 + t * 0.7));
    float c = pow(0.5 + 0.5 * sin(a.x * 2.1) * sin(a.y * 2.3), 6.0) + pow(0.5 + 0.5 * sin(b.x * 2.4 + 1.0) * sin(b.y * 2.0), 6.0);
    float under = 1.0 - step(-0.12, pw.y);
    e += vec3(0.16, 0.62, 0.6) * c * nearPool * mix(0.55 * (1.0 - 0.6 * max(nw.y, 0.0)), 1.6, under);
  }
  // chandelier sparkle: slow constellation of warm glints the crystals throw across the atrium
  vec3 cd = pw - ghChand.xyz; float cl = length(cd);
  float nearCh = (1.0 - smoothstep(4.0, 11.0, cl)) * ghLVK.w;
  if (nearCh > 0.002) {
    vec3 dn = cd / max(cl, 1e-3);
    vec2 sp = vec2(atan(dn.z, dn.x) * 5.0 + ghLVT.x * 0.02, dn.y * 11.0);
    vec2 cell = floor(sp), f = fract(sp); float h = ghLvHash(cell);
    float g = smoothstep(0.13, 0.0, length(f - 0.3 - 0.4 * vec2(h, fract(h * 7.31)))) * step(0.5, fract(h * 13.7));
    e += vec3(1.0, 0.8, 0.52) * g * nearCh * (0.5 + 0.5 * sin(ghLVT.x * (0.7 + h) + h * 40.0)) * 0.55;
  }
  return e;
}
