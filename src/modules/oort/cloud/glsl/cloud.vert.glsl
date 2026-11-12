// oort: GPU-propagated Oort Cloud points. Each vertex carries heliocentric ecliptic J2000 elements at a
// float64-rebased epoch (generate.ts): the shader advances the mean anomaly (uDt kyr since that epoch),
// solves Kepler's equation (Mikkola starter + Newton, CPU twin: kepler.ts), rotates the perifocal
// position by the orbit's quaternion, then by the Galactic-tide precession since the epoch about the
// north Galactic pole (Rodrigues), and places the point with the RTE split (rte.glsl, camera relative to
// the Sun in ecliptic axes).
// Brightness is artificial: it shows how many comets a point stands for (its weight), not sunlight.
// E = uE0 * weight * (uD0 / d)^2, capped at uCapLux, so a haze's surface brightness does not depend on the
// viewing distance; near points spread E over a larger, softer sprite.
// The CPU prepends DEPTH_GLSL and RTE_GLSL.
uniform float uDt;          // kyr since the GPU epoch
uniform vec3 uGalPole;      // north Galactic pole, ecliptic axes
uniform float uExposure;
uniform float uPixelAngle;  // rad per device pixel
uniform float uPointSize;   // smallest sprite, device px
uniform float uMaxPointSize;
uniform float uCellFrac;    // sprite diameter / a: the patch of cloud a point stands for
uniform float uE0;          // lux at uD0 of a weight-1 point (count, preset and brightness folded in)
uniform float uD0;          // AU
uniform float uCapLux;      // illuminance cap of one point
uniform float uFade;        // whole-cloud fade (shared.cloudFade)
uniform vec2 uNearFade;     // AU: points closer than x vanish, fully shown beyond y
uniform vec3 uTint0;        // detached disc, linear RGB, luminance 1
uniform vec3 uTint1;        // inner cloud
uniform vec3 uTint2;        // outer cloud
uniform vec4 uTintLnA;      // ln a ranges of the two tint transitions
attribute vec4 aEl0;        // a [AU], e, M at epoch [rad], n [rad/kyr]
attribute vec4 aQuat;       // perifocal -> ecliptic at the epoch
attribute vec2 aEl1;        // tide rate [rad/kyr], weight
varying vec3 vColor;

const float PI = 3.14159265358979;
const float TWO_PI = 6.28318530717959;
const float AU_M = 1.495978707e11;
const int KEPLER_ITERATIONS = 5; // kepler.ts

float keplerE(float M, float e) {
  float den = 4.0 * e + 0.5;
  float alpha = (1.0 - e) / den;
  float beta = 0.5 * M / den;
  float sgn = beta >= 0.0 ? 1.0 : -1.0;
  float z = sgn * pow(abs(beta) + sqrt(beta * beta + alpha * alpha * alpha), 1.0 / 3.0);
  float s = z - alpha / z;
  s -= 0.078 * s * s * s * s * s / (1.0 + e);
  float E = M + e * (3.0 * s - 4.0 * s * s * s);
  for (int k = 0; k < KEPLER_ITERATIONS; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  return E;
}

vec3 quatRotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  float a = aEl0.x;
  float e = aEl0.y;
  float M = aEl0.z + aEl0.w * uDt;
  M = mod(M + PI, TWO_PI) - PI;
  float E = keplerE(M, e);
  vec3 pf = vec3(a * (cos(E) - e), a * sqrt(max(1.0 - e * e, 0.0)) * sin(E), 0.0);
  vec3 v = quatRotate(aQuat, pf);
  float ang = aEl1.x * uDt;
  float ca = cos(ang);
  float sa = sin(ang);
  vec3 pAU = v * ca + cross(uGalPole, v) * sa + uGalPole * dot(uGalPole, v) * (1.0 - ca);
  vec3 rel = rteRelative(pAU * AU_M); // camera -> point, ecliptic axes, m
  gl_Position = projectionMatrix * modelViewMatrix * vec4(rel, 1.0);
  LOG_DEPTH_VERTEX();
  float dAU = max(length(rel) / AU_M, 1e-6);
  float q = uD0 / dAU;
  float lux = min(uE0 * aEl1.y * q * q, uCapLux);
  // Near points stand for a patch of cloud, not a star: their sprite grows with the patch's apparent size, so
  // the haze stays smooth (its radiance does not depend on the distance) instead of breaking into confetti.
  float size = clamp(uCellFrac * a / (dAU * uPixelAngle), uPointSize, uMaxPointSize);
  float omega = (size * uPixelAngle) * (size * uPixelAngle);
  float L = lux / omega * uExposure * uFade * smoothstep(uNearFade.x, uNearFade.y, dAU);
  float la = log(a);
  vec3 tint = mix(uTint0, uTint1, smoothstep(uTintLnA.x, uTintLnA.y, la));
  vColor = mix(tint, uTint2, smoothstep(uTintLnA.z, uTintLnA.w, la)) * L;
  gl_PointSize = size;
}
