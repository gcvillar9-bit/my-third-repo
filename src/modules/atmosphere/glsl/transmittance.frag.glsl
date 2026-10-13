// Transmittance LUT 256x64: exp(-optical depth) from (r, mu) to the top boundary (40 midpoint steps).
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(256.0, 64.0);
  vec2 rm = transmittanceParams(uv);
  float r = rm.x;
  float mu = rm.y;
  float dt = distanceToTop(r, mu) / 40.0;
  vec3 od = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    float t = (float(i) + 0.5) * dt;
    float ri = sqrt(r * r + t * t + 2.0 * r * mu * t);
    od += atmoMedium(ri - uAtmoBottom).ext * dt;
  }
  gl_FragColor = vec4(exp(-od), 1.0);
}
