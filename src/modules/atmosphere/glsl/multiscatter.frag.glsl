// Multiple-scattering LUT 32x32 (Hillaire 2020, eq. 5-10): 64 directions x 20 steps, isotropic
// phase, ground albedo bounce, Psi_ms = L_2nd / (1 - f_ms). uMsOn must be 0 for this pass.
void main() {
  vec2 uv = gl_FragCoord.xy / 32.0;
  float muS = clamp(fromSubUv(uv.x, 32.0) * 2.0 - 1.0, -1.0, 1.0);
  float r = uAtmoBottom + max(fromSubUv(uv.y, 32.0) * (uAtmoTop - uAtmoBottom), 1e-4);
  vec3 ro = vec3(0.0, 0.0, r);
  vec3 sun = vec3(0.0, sqrt(max(0.0, 1.0 - muS * muS)), muS);
  vec3 L2 = vec3(0.0);
  vec3 F = vec3(0.0);
  for (int a = 0; a < 8; a++) {
    for (int b = 0; b < 8; b++) {
      float theta = 2.0 * ATMO_PI * (float(a) + 0.5) / 8.0;
      float phi = acos(1.0 - 2.0 * (float(b) + 0.5) / 8.0);
      vec3 rd = vec3(cos(theta) * sin(phi), sin(theta) * sin(phi), cos(phi));
      vec2 g = raySphere(ro, rd, uAtmoBottom);
      bool hit = g.x > 0.0;
      float tMax = hit ? g.x : raySphere(ro, rd, uAtmoTop).y;
      vec3 L = vec3(0.0);
      vec3 T = vec3(1.0);
      vec3 f = vec3(0.0);
      atmoMarch(ro, rd, sun, 0.0, tMax, 20, false, true, L, T, f);
      if (hit) {
        vec3 G = ro + rd * tMax;
        float gl = length(G);
        float mu0 = dot(G, sun) / gl;
        L += T * sunTransmittance(gl, mu0) * max(mu0, 0.0) * uGroundAlbedo / ATMO_PI;
      }
      L2 += L / 64.0;
      F += f / 64.0;
    }
  }
  gl_FragColor = vec4(L2 / max(1.0 - F, vec3(1e-3)), 1.0);
}
