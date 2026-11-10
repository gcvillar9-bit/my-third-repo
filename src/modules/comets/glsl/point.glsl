// Unresolved comets: one vertex per comet carrying the illuminance (lux per channel) its coma and nucleus
// deliver at the camera, spread by a Gaussian PSF so that sum(L * pixel solid angle) = E. The same scheme as
// the planets' photometric points. Output L * uExposure. The fragment stage starts at the marker line.
uniform float uPointSize; // device px
attribute vec3 aFlux;
varying vec3 vFlux;
void main() {
  vFlux = aFlux;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  gl_PointSize = dot(aFlux, vec3(1.0)) > 0.0 ? uPointSize : 0.0;
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform float uPointSize;
uniform float uSigma;      // PSF sigma, px
uniform float uPixelAngle; // radians per device px
uniform float uExposure;
varying vec3 vFlux;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * uPointSize;
  float g = exp(-dot(d, d) / (2.0 * uSigma * uSigma)) / (6.28318531 * uSigma * uSigma);
  vec3 L = vFlux * g / (uPixelAngle * uPixelAngle);
  gl_FragColor = vec4(min(L * uExposure, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
