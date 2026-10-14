// Display-referred (pre-exposed, EV independent) overlay colour: these are UI guides, not light.
uniform float uAlpha;
uniform float uRound;   // 1 for point markers (round sprite), 0 for lines and the ring
varying vec3 vColor;

void main() {
  float a = uAlpha;
  if (uRound > 0.5) {
    vec2 c = gl_PointCoord - 0.5;
    a *= smoothstep(0.5, 0.35, length(c));
  }
  gl_FragColor = vec4(vColor * a, a);
  LOG_DEPTH_FRAGMENT();
}
