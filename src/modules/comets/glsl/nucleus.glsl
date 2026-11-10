// Comet nucleus: a dark irregular rock lit by the Sun (Lommel-Seeliger, L = E (2 p / pi) mu0 / (mu0 + mu) for
// geometric albedo p), with a noise bump so the terminator is rough. Radiance in cd/m2 times uExposure.
// The fragment stage starts at the marker line.
varying vec3 vWorld;  // camera-relative, world axes, m
varying vec3 vNormal; // world axes
varying vec3 vBody;   // mesh coordinates (largest extent 1)
void main() {
  vBody = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform vec3 uSunDir;         // unit, nucleus -> Sun, world axes
uniform vec3 uSunIlluminance; // lux per channel
uniform mat3 uBodyToWorld;    // rotation of the nucleus
uniform float uAlbedo;        // geometric albedo
uniform float uExposure;
uniform float uFade;
uniform float uSeed;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vBody;
float rough(vec3 p) { return gnoise(p) + 0.5 * gnoise(p * 2.7); }
void main() {
  vec3 n = normalize(vNormal);
  // Bump: gradient of two noise octaves in mesh space, projected on the surface.
  vec3 p = vBody * 7.0 + uSeed;
  float e = 0.08;
  float n0 = rough(p);
  vec3 grad = vec3(rough(p + vec3(e, 0.0, 0.0)), rough(p + vec3(0.0, e, 0.0)), rough(p + vec3(0.0, 0.0, e))) - n0;
  vec3 gw = uBodyToWorld * (grad / e);
  n = normalize(n - 0.09 * (gw - dot(gw, n) * n));
  float mu0 = dot(n, uSunDir);
  float mu = max(dot(n, normalize(-vWorld)), 0.0);
  vec3 tint = vec3(1.06, 1.0, 0.9) * (0.82 + 0.3 * n0);
  vec3 L = mu0 > 0.0
    ? uSunIlluminance * tint * (2.0 * uAlbedo / 3.14159265) * mu0 / max(mu0 + mu, 1e-4)
    : vec3(0.0);
  gl_FragColor = vec4(min(L * uExposure * uFade, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
