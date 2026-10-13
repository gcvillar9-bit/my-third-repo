// Ring shadow on the globe (P3-A): ray-plane intersection from the surface point towards the Sun;
// the transmitted fraction is (1 - opacity)^(1/|mu0|) = exp(-tau / |mu0|) at the hit radius.
// Uniforms come from rings/public.ts ringShadowUniforms(bodyId), camera-relative, world axes.
#ifndef COSMOS_RING_SHADOW_GLSL
#define COSMOS_RING_SHADOW_GLSL
uniform sampler2D uRingShadowProfile;
uniform vec3 uRingShadowCentre; // camera-relative planet centre, m
uniform vec3 uRingShadowNormal; // ring-plane normal, world axes
uniform vec2 uRingShadowRange;  // profile inner, outer radius, m
float ringSunTransmission(vec3 p, vec3 sunDir) {
  float dn = dot(sunDir, uRingShadowNormal);
  if (abs(dn) < 1e-4) return 1.0;
  vec3 d = p - uRingShadowCentre;
  float t = -dot(d, uRingShadowNormal) / dn;
  if (t <= 0.0) return 1.0;
  float u = (length(d + t * sunDir) - uRingShadowRange.x) / (uRingShadowRange.y - uRingShadowRange.x);
  if (u <= 0.0 || u >= 1.0) return 1.0;
  float a0 = clamp(texture(uRingShadowProfile, vec2(u, 0.5)).g, 0.0, 0.9999);
  return pow(1.0 - a0, 1.0 / abs(dn));
}
#endif
