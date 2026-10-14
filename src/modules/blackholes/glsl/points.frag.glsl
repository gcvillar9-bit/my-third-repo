varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  // Gaussian core normalised so the sprite's mean over its disc equals vColor.
  float w = exp(-3.0 * r2) * 3.0 / (1.0 - exp(-3.0));
  gl_FragColor = vec4(vColor * w, 1.0);
  LOG_DEPTH_FRAGMENT();
}
