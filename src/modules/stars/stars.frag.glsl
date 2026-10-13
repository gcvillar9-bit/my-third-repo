// Star PSF: Gaussian core (σ = 0.65 px, unit integral) plus a faint 1/r² halo that fades
// out at the sprite edge. Output is radiance · exposure (additive HDR background).
uniform float uHaloK;
varying vec3 vColor;
varying float vRadius;

void main() {
  vec2 q = (gl_PointCoord - 0.5) * (2.0 * vRadius + 1.0);
  float r2 = dot(q, q);
  float R2 = vRadius * vRadius;
  if (r2 > R2) discard;
  float core = 0.3767 * exp(-r2 * 1.1834);  // 1/(2σ²) = 1.1834
  float halo = uHaloK / (1.0 + r2) * (1.0 - smoothstep(0.36 * R2, R2, r2));
  gl_FragColor = vec4(min(vColor * (core + halo), vec3(60000.0)), 1.0);
}
