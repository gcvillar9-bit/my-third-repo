// Laniakea flow lines (overlay layer: a display-referred diagram like milkyway's "you are here" ring,
// additive, no depth). Positions are Mpc in the `universe` frame; the camera arrives as an RTE high/low
// pair (rte.glsl, prepended in the vertex stage). aFlow = (arc length + random phase in Mpc, speed colour
// 0..1, weight 0..1, highlight 0/1). A bright dash runs downstream (toward the attractor) along every line.
varying vec4 vFlow;
#ifdef COSMOS_VERTEX
attribute vec4 aFlow;
void main() {
  vFlow = aFlow;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(rteRelative(position), 1.0);
}
#else
uniform float uFade;
uniform float uPhase; // (time · DASH_RATE) mod 1, wrapped on the CPU
void main() {
  float s = fract(vFlow.x / DASH_MPC - uPhase);
  float pulse = s * s * s * s * s * s;
  vec3 slow = vec3(0.22, 0.42, 1.0);
  vec3 fast = vec3(1.0, 0.82, 0.5);
  vec3 c = mix(slow, fast, vFlow.y) * (0.16 + 0.7 * pulse);
  vec3 ours = vec3(0.45, 1.0, 0.55) * (0.9 + 0.6 * pulse);
  c = mix(c, ours, vFlow.w);
  gl_FragColor = vec4(c * vFlow.z * uFade, 1.0);
}
#endif
