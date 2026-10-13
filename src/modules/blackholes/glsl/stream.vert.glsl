// Accretion stream from the companion's inner face spiralling onto the disk rim (orbital plane).
attribute vec3 aSeed;      // s0 in [0,1), lateral and vertical jitter (-1..1)
uniform float uFlow;       // advances by 1 per stream crossing time
uniform float uStart;      // start radius from the hole, m
uniform float uRim;        // disk rim, m
uniform float uPhase;      // companion phase, rad
uniform vec3 uU1;
uniform vec3 uU2;
uniform vec3 uN;
uniform float uSize;
varying float vS;
void main() {
  float s = fract(aSeed.x + uFlow);
  vS = s;
  float r = mix(uStart, uRim, pow(s, 0.6));
  float phi = uPhase + 1.9 * s * s;
  vec3 radial = cos(phi) * uU1 + sin(phi) * uU2;
  vec3 tang = cross(uN, radial);
  float w = (0.06 + 0.05 * s) * uStart;
  vec3 p = r * radial + tang * aSeed.y * w + uN * aSeed.z * w * 0.4;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize;
  LOG_DEPTH_VERTEX();
}
