// Photometric point LOD for Solar System bodies (one vertex per body). The vertex carries the
// illuminance E (lux per channel) the body delivers at the camera; the sprite spreads it with a
// Gaussian PSF so that sum(L * pixelSolidAngle) = E. Output L * uExposure, clamped below the
// half-float maximum. The fragment stage starts at the marker line (see points.ts).
uniform float uPointSize;    // device px
uniform float uSigma;        // PSF sigma, px
uniform float uPixelAngle;   // radians per device px
uniform float uExposure;
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
uniform float uSigma;
uniform float uPixelAngle;
uniform float uExposure;
varying vec3 vFlux;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * uPointSize;
  float g = exp(-dot(d, d) / (2.0 * uSigma * uSigma)) / (6.28318531 * uSigma * uSigma);
  vec3 L = vFlux * g / (uPixelAngle * uPixelAngle);
  gl_FragColor = vec4(min(L * uExposure, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
