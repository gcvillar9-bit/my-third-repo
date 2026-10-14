// HYG point stars (background layer). Positions are pc relative to the Sun in ICRS axes;
// the camera position relative to the Sun arrives as an RTE high/low pair (rte.glsl).
// Per vertex: linear proper motion, apparent magnitude from the camera position, illuminance
// E = 2.54e-6 lux · 10^(-0.4 m), pre-exposed peak radiance and the sprite radius.
attribute float absMag;
attribute vec3 velocity;
attribute float bvCode;

uniform float uYears;      // years since the catalogue epoch, clamped to ±1 Myr
uniform float uScale;      // LUX_MAG0 · exposure · gain / pixelSolidAngle  (E → pre-exposed L per px)
uniform float uMinPeak;    // cull threshold on the pre-exposed core peak
uniform float uHaloK;      // 1/r² halo strength relative to the one-pixel intensity
uniform float uHaloFloor;  // pre-exposed radiance where the halo is cut
uniform float uMaxRadius;  // px
uniform float uBvMin;
uniform float uBvStep;
uniform int uHide[4];     // star indices drawn elsewhere (promoted stars), -1 = unused

varying vec3 vColor;
varying float vRadius;

#define CORE_PEAK 0.3767  // 1 / (2π σ²), σ = 0.65 px

void main() {
  vec3 p = position + velocity * (uYears * 1.0227e-6);
  vec3 rel = rteRelative(p);
  float d = max(length(rel), 1e-9);
  float m = absMag + 5.0 * log2(d * 0.1) * 0.30102999566;
  float i1 = uScale * exp2(-1.3287712380 * m);
  bool hidden = gl_VertexID == uHide[0] || gl_VertexID == uHide[1] || gl_VertexID == uHide[2] ||
    gl_VertexID == uHide[3];
  if (hidden || i1 * CORE_PEAK < uMinPeak || absMag > 40.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    vRadius = 0.0;
    return;
  }
  // Direction only: stars sit at infinity for the projection (background layer, no depth).
  vec3 dir = rel / d;
  gl_Position = projectionMatrix * vec4((modelViewMatrix * vec4(dir, 0.0)).xyz, 1.0);
  float bv = bvCode > 254.5 ? 0.65 : uBvMin + bvCode * uBvStep;
  float teff = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62));
  vColor = blackbodyColor(teff) * i1;
  float r = sqrt(max(i1 * uHaloK / uHaloFloor - 1.0, 0.0));
  vRadius = clamp(r, 2.0, uMaxRadius);
  gl_PointSize = 2.0 * vRadius + 1.0;
}
