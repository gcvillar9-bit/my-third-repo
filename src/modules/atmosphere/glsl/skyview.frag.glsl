// Sky-view LUT 192x108 (per frame, camera inside the atmosphere): Hillaire's non-linear horizon
// mapping, azimuth relative to the Sun. Rays below the horizon stop at the ground (no ground radiance).
uniform float uCamR;  // km
uniform float uCamH;  // km above the ground (float64-derived)
uniform float uSunMu; // cosine of the Sun zenith angle at the camera
uniform int uSteps;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(192.0, 108.0);
  vec2 p = skyViewParams(uCamR, uCamH, uv);
  float vzc = p.x;
  float lvc = p.y;
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - uSunMu * uSunMu)), 0.0, uSunMu);
  vec3 ro = vec3(0.0, 0.0, uCamR);
  float s = sqrt(max(0.0, 1.0 - vzc * vzc));
  vec3 rd = vec3(s * lvc, s * sqrt(max(0.0, 1.0 - lvc * lvc)), vzc);
  float tG = uv.y >= 0.5 ? groundDistance(uCamR, uCamH, vzc) : -1.0;
  float tMax = tG > 0.0 ? tG : max(raySphere(ro, rd, uAtmoTop).y, 0.0);
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  vec3 f = vec3(0.0);
  atmoMarch(ro, rd, sun, 0.0, tMax, uSteps, false, false, L, T, f);
  gl_FragColor = vec4(L, 1.0);
}
