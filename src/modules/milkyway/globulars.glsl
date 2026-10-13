// Globular-cluster stars from King-profile point clouds (background layer). Positions are pc from
// the ssb in ICRS axes; the camera arrives as an RTE high/low pair (rte.glsl, prepended in the
// vertex stage). Each point carries 1/N of the cluster's integrated light (absMag per point).
varying vec3 vColor;
#ifdef COSMOS_VERTEX
attribute float absMag;
uniform float uScale;  // LUX_MAG0 · exposure / pixelSolidAngle (E → pre-exposed L per px)
uniform vec3 uColor;   // luminance-1 colour of the population
#define CORE_PEAK 0.3767  // 1 / (2π σ²), σ = 0.65 px
void main() {
  vec3 rel = rteRelative(position);
  float d = max(length(rel), 1e-3);
  float m = absMag + 5.0 * log2(d * 0.1) * 0.30102999566;
  float i1 = uScale * exp2(-1.3287712380 * m);
  if (i1 * CORE_PEAK < 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }
  vec3 dir = rel / d;  // directions only: drawn at infinity like the HYG stars
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
