// Comet tails as camera-facing ribbons along a centreline (ion tail: one straight ribbon; dust tail: one per
// syndyne). Each vertex carries the centreline point (relative to the nucleus), its tangent and
// (side, sigma, peak luminance, fraction along). The cross-section is a Gaussian of that sigma, cut at
// TAIL_HALF sigmas and offset so that it reaches exactly zero at the edge. A ribbon thinner than a pixel is
// widened to a pixel and dimmed by the same factor, so its light per unit length is conserved.
// Radiance in cd/m2 times uExposure. The fragment stage starts at the marker line.
#define TAIL_HALF 2.6
attribute vec3 aTangent;
attribute vec4 aParams;
uniform float uPixelAngle;
varying vec2 vUv;   // x: cross coordinate in sigmas, y: fraction along the tail
varying float vLum;
void main() {
  vec4 wc = modelMatrix * vec4(position, 1.0);
  float dist = max(length(wc.xyz), 1e-3);
  vec3 viewDir = wc.xyz / dist;
  vec3 t = normalize(mat3(modelMatrix) * aTangent);
  vec3 side = cross(t, viewDir);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(0.0);
  float sigma = max(aParams.y, 0.5 * uPixelAngle * dist);
  // Seen at an angle theta to its axis an optically thin tube brightens as 1 / sin(theta).
  float lum = aParams.z * (aParams.y / sigma) / max(sl, 0.3);
  // Fade the part of a ribbon the camera sits inside (it cannot face the camera there).
  lum *= smoothstep(1.0, 3.0, dist / (TAIL_HALF * sigma));
  vLum = lum;
  vUv = vec2(aParams.x * TAIL_HALF, aParams.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(wc.xyz + side * (aParams.x * TAIL_HALF * sigma), 1.0);
  LOG_DEPTH_VERTEX();
}
//#fragment
#define TAIL_HALF 2.6
uniform vec3 uColor;   // linear RGB of luminance 1
uniform float uExposure;
uniform float uStreak; // 0: smooth dust, 1: ion rays
uniform float uSeed;
varying vec2 vUv;
varying float vLum;
float gauss(float x, float c, float w) {
  float d = (x - c) / w;
  return exp(-0.5 * d * d);
}
void main() {
  float edge = exp(-0.5 * TAIL_HALF * TAIL_HALF);
  float prof = (exp(-0.5 * vUv.x * vUv.x) - edge) / (1.0 - edge);
  if (uStreak > 0.5) {
    // Ion rays: a bright spine and two fainter streamers that wander and knot along the tail.
    float y = vUv.y;
    float wob = 0.22 * sin(9.0 * y + uSeed) + 0.1 * sin(23.0 * y + 2.3 * uSeed);
    float x = vUv.x + wob * smoothstep(0.0, 0.3, y);
    float rays = 0.62 * gauss(x, 0.0, 0.42) + 0.3 * gauss(x, 0.95 + 0.2 * sin(6.0 * y + uSeed), 0.3) +
      0.24 * gauss(x, -1.15 + 0.25 * sin(5.0 * y + 1.7 * uSeed), 0.34);
    float knots = 0.85 + 0.15 * sin(41.0 * y + 3.1 * uSeed) * sin(13.0 * y);
    // Close to the head the rays merge into the smooth envelope.
    prof *= mix(1.0, 1.9 * rays * knots, smoothstep(0.0, 0.12, y));
  }
  gl_FragColor = vec4(min(uColor * (vLum * max(prof, 0.0) * uExposure), vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
