// Cosmic-web tracers (background layer). Positions are Mpc in the `universe` frame; the camera arrives
// as an RTE high/low pair (rte.glsl, prepended in the vertex stage). Every tracer carries the same
// absolute magnitude; tracers inside the catalogue-complete sphere (~100 Mpc) fade out, and the whole
// layer fades in with the camera's distance from the Milky Way (uFade).
varying vec3 vColor;
#ifdef COSMOS_VERTEX
uniform float uScale;   // LUX_MAG0 · exposure / pixelSolidAngle
uniform float uAbsMag;  // per tracer
uniform float uFade;
uniform vec3 uColor;
#define CORE_PEAK 0.3767
void main() {
  vec3 rel = rteRelative(position);
  float d = max(length(rel), 1e-9);
  float m = uAbsMag + 25.0 + 5.0 * log2(d) * 0.30102999566;
  float w = uFade * smoothstep(INNER_START, INNER_END, length(position));
  float i1 = uScale * exp2(-1.3287712380 * m) * w;
  if (i1 * CORE_PEAK < 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }
  vec3 dir = rel / d;
  gl_Position = projectionMatrix * vec4((modelViewMatrix * vec4(dir, 0.0)).xyz, 1.0);
  vColor = uColor * i1 * CORE_PEAK;
  gl_PointSize = 5.0;
}
#else
void main() {
  vec2 r = (gl_PointCoord - 0.5) * 5.0;
  gl_FragColor = vec4(vColor * exp(-dot(r, r) / 0.845), 1.0);
}
#endif
