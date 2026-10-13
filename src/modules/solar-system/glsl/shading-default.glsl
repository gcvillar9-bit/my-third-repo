// Default body shading (P1, priority 0). The albedo map is normalised by its mean so the
// disk-integrated brightness matches the geometric albedo p (same p as the point LOD):
//   Lambert sphere:  p = 2/3 A  ->  L = E c (1.5 p / pi) mu0
//   Lommel-Seeliger: p = w / 8  ->  L = E c (2 p / pi) mu0 / (mu0 + mu)
uniform sampler2D uAlbedoMap;
uniform float uHasMap;
uniform float uMapScale; // 1 / mean linear luminance of the map
uniform float uAlbedo;   // geometric albedo (clamped to 1)
uniform vec3 uTint;      // colour of untextured bodies (luminance 1)
vec3 shadeSurface(SurfaceInput s) {
  float mu0 = dot(s.normal, s.sunDir);
  if (mu0 <= 0.0) return vec3(0.0);
  float mu = max(dot(s.normal, s.viewDir), 0.0);
  vec3 c = uHasMap > 0.5 ? sampleEquirect(uAlbedoMap, s.uv).rgb * uMapScale : uTint;
  vec3 E = s.sunIlluminance * s.shadow;
#ifdef AIRLESS
  return E * c * (2.0 * uAlbedo / 3.14159265) * lommelSeeliger(mu0, mu);
#else
  return E * c * (1.5 * uAlbedo / 3.14159265) * mu0;
#endif
}
