// Cloud shell fragment shader (premultiplied alpha, transparent layer). Prepended: DEPTH_GLSL,
// NOISE_GLSL, ATMOSPHERE_TRANSMITTANCE_GLSL, earth-common.glsl. Lit by the Sun through the
// atmosphere above the cloud tops (Lambert-like, albedo 0.85, softened terminator); the cloud
// base seen from below is darker. Output L[cd/m2] * uExposure * alpha.
uniform float uExposure;
uniform float uFade;
uniform float uPixelAngle;
uniform vec3 uCloudSunPos;   // camera-relative Sun centre, world axes, m
uniform vec3 uCloudSunIllum; // solar illuminance at Earth, lux per channel
varying vec3 vPosBody;
varying vec3 vViewPos;
void main() {
  vec3 d = normalize(vPosBody);
  float px = length(vViewPos) * uPixelAngle;
  float dens = earthCloudDensity(d, earthUv(d), px);
  vec3 up = normalize(transpose(uEarthWorldToBody) * d);
  vec3 sunDir = normalize(uCloudSunPos - vViewPos);
  float mu0 = dot(up, sunDir);
  vec3 T = atmoSunTransmittance(uEarthRadiusKm + uEarthCloudAltKm, mu0);
  float lit = clamp((mu0 + 0.05) / 1.05, 0.0, 1.0);
  vec3 L = uCloudSunIllum * T * (0.85 * lit / EARTH_PI);
  if (!gl_FrontFacing) L *= mix(1.0, 0.25, dens);
  float a = dens * uFade;
  gl_FragColor = vec4(min(L * uExposure, vec3(60000.0)) * a, a);
  LOG_DEPTH_FRAGMENT();
}
