// smallbodies: GPU-propagated belt points. Each vertex carries heliocentric ecliptic J2000 elements;
// the shader advances the mean anomaly to the current instant (uDt days since the float64-rebased
// epoch), solves Kepler's equation (Mikkola starter + 4 Newton iterations, twin: kepler4.ts),
// places the point with the RTE split (rte.glsl, camera relative to the Sun in ecliptic axes) and
// computes its photometric illuminance (H-G phase law, G = 0.15) at the camera.
// The CPU prepends DEPTH_GLSL and RTE_GLSL.
uniform float uDt;          // days since the GPU epoch
uniform float uLibFreq;     // Trojan libration frequency, rad/day
uniform float uTrojanShift; // Jupiter true - mean longitude, rad
uniform float uExposure;
uniform float uPixelAngle;  // rad per device pixel
uniform float uPointSize;   // device px
uniform float uBoostMag;    // visibility enhancement, magnitudes (0 = physical)
uniform float uFade;        // whole-cloud fade (far from the Sun)
uniform vec2 uNearFade;     // m: points closer than x vanish, fully shown beyond y
attribute vec4 aEl0;        // a [AU], e, i, node
attribute vec4 aEl1;        // arg. perihelion, M at epoch, n [rad/day], H
attribute vec2 aLib;        // libration amplitude [rad] (Trojans), phase at epoch [rad]
varying float vL;

const float PI = 3.14159265358979;
const float TWO_PI = 6.28318530717959;
const float AU_M = 1.495978707e11;

float keplerE(float M, float e) {
  float den = 4.0 * e + 0.5;
  float alpha = (1.0 - e) / den;
  float beta = 0.5 * M / den;
  float sgn = beta >= 0.0 ? 1.0 : -1.0;
  float z = sgn * pow(abs(beta) + sqrt(beta * beta + alpha * alpha * alpha), 1.0 / 3.0);
  float s = z - alpha / z;
  s -= 0.078 * s * s * s * s * s / (1.0 + e);
  float E = M + e * (3.0 * s - 4.0 * s * s * s);
  for (int k = 0; k < 4; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  return E;
}

float log10f(float x) { return log2(x) * 0.30102999566; }

void main() {
  float e = aEl0.y;
  float M = aEl1.y + aEl1.z * uDt;
  if (aLib.x > 0.0) M += aLib.x * sin(aLib.y + uLibFreq * uDt) + uTrojanShift;
  M = mod(M + PI, TWO_PI) - PI;
  float E = keplerE(M, e);
  vec2 pf = aEl0.x * vec2(cos(E) - e, sqrt(1.0 - e * e) * sin(E));
  float cw = cos(aEl1.x), sw = sin(aEl1.x);
  float cO = cos(aEl0.w), sO = sin(aEl0.w);
  float ci = cos(aEl0.z), si = sin(aEl0.z);
  float xw = pf.x * cw - pf.y * sw;
  float yw = pf.x * sw + pf.y * cw;
  vec3 pAU = vec3(cO * xw - sO * ci * yw, sO * xw + cO * ci * yw, si * yw);
  vec3 rel = rteRelative(pAU * AU_M); // camera -> body, ecliptic axes, m
  gl_Position = projectionMatrix * modelViewMatrix * vec4(rel, 1.0);
  LOG_DEPTH_VERTEX();
  float r = length(pAU);
  float dist = max(length(rel), 1.0);
  float cosA = clamp(dot(pAU, rel) / (r * dist), -1.0, 1.0); // phase angle Sun-body-camera
  float ta = tan(0.5 * acos(cosA));
  float phi = 0.85 * exp(-3.33 * pow(ta, 0.63)) + 0.15 * exp(-1.87 * pow(ta, 1.22));
  float m = aEl1.w + 5.0 * log10f(r * dist / AU_M) - 2.5 * log10f(max(phi, 1e-6)) - uBoostMag;
  float lux = 2.54e-6 * exp2(-1.32877124 * m); // 10^(-0.4 m)
  float omega = (uPointSize * uPixelAngle) * (uPointSize * uPixelAngle);
  vL = min(lux / omega * uExposure * uFade * smoothstep(uNearFade.x, uNearFade.y, dist), 8.0);
  gl_PointSize = uPointSize;
}
