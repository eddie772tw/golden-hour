float source_planar_lod(float roughness, float rough_scale, float blur) {
 return clamp(roughness, 0.0, 1.0) * rough_scale + blur;
}
vec3 source_planar_add(vec3 radiance, float ndotv, float roughness, float receiver_k) {
 float rr = clamp(roughness, 0.0, 1.0);
 float fresnel = 0.055 + 0.945 * pow(clamp(1.0 - ndotv, 0.0, 1.0), 5.0);
 float gloss = (1.0 - rr) * (1.0 - rr);
 return min(radiance, vec3(9.0)) * fresnel * gloss * receiver_k;
}
