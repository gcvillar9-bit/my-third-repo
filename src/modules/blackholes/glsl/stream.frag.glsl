uniform vec3 uColor;   // pre-exposed radiance
varying float vS;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float fade = smoothstep(0.0, 0.08, vS) * mix(1.0, 0.5, vS);
  gl_FragColor = vec4(uColor * fade * (1.0 - r2), 1.0);
  LOG_DEPTH_FRAGMENT();
}
