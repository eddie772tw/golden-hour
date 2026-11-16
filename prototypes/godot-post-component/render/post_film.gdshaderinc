// Literal source operators; diagnostic fixed E replaces the GPU meter input only.
    vec3 film(vec3 x) { return clamp(x * (2.36 * x + 0.035) / (x * (2.18 * x + 0.66) + 0.16), 0.0, 1.0); }
    float film1(float x) { return clamp(x * (2.36 * x + 0.035) / (x * (2.18 * x + 0.66) + 0.16), 0.0, 1.0); }
uniform float uExposure;
uniform float uAuto;
uniform float uHueKeep;
uniform float uSuppress;
uniform float uHurt;
uniform float fixedExposure;
vec3 sourceExposureFilm(vec3 col) {
 vec4 meter=vec4(fixedExposure,0.0,0.0,1.0);
      col *= uExposure * mix(1.0, meter.r, uAuto) * (1.0 - 0.06 * uSuppress - 0.16 * uHurt);
      float pk = max(col.r, max(col.g, col.b));
      vec3 perCh = film(col * 1.05), keep = col * (film1(pk * 1.05) / max(pk, 1e-5));
      col = mix(perCh, keep, uHueKeep);
      // the last stop before white bleaches gently instead of clipping one channel at a time
      float lo = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(lo), smoothstep(0.8, 1.0, max(col.r, max(col.g, col.b))) * 0.3);
 return col;
}
