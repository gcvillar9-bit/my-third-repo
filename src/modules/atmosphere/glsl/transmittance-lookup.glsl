// Sun transmittance for surface shaders (Earth shading, cloud shell): samples the atmosphere's
// transmittance LUT at radius rKm (atmosphere space, km) and Sun zenith cosine mu, times a smooth
// planet shadow. Uniforms come from atmosphere public.ts (shared by reference); T = 1 until ready.
#ifndef ATMO_TRANSMITTANCE_LOOKUP_GLSL
#define ATMO_TRANSMITTANCE_LOOKUP_GLSL
uniform sampler2D uAtmoTransmittance;
uniform vec2 uAtmoRadii; // bottom, top radius, km
uniform float uAtmoReady;
vec3 atmoSunTransmittance(float rKm, float mu) {
  if (uAtmoReady < 0.5) return vec3(1.0);
  float B = uAtmoRadii.x;
  float Tp = uAtmoRadii.y;
  float r = clamp(rKm, B + 1e-4, Tp);
  float H = sqrt(Tp * Tp - B * B);
  float rho = sqrt(max(0.0, r * r - B * B));
  float d = max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + Tp * Tp, 0.0)));
  float dMin = Tp - r;
  float dMax = rho + H;
  vec2 uv = clamp(vec2((d - dMin) / max(dMax - dMin, 1e-6), rho / H), 0.0, 1.0);
  float muH = -sqrt(max(0.0, 1.0 - (B * B) / (r * r)));
  float sh = smoothstep(0.0, 1.0, (mu - muH + 0.004) / 0.008);
  return texture(uAtmoTransmittance, uv).rgb * sh;
}
#endif
