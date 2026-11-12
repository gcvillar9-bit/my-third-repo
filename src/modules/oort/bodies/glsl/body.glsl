// A resolved oort object: a unit sphere scaled by the body radius, lit by the Sun as a Lambert surface,
// L = rho E cos(theta) / pi * tint (rho = 1.5 p, the Lambert reflectance whose disc gives the photometric
// point's flux at full phase), with a gentle procedural albedo pattern. The flat facets sag below the
// sphere; cosmosSphereFactor (facet.glsl) slides each fragment onto the true surface and writes its depth
// there. Radiance in cd/m2 times uExposure. The fragment stage starts at the marker line.
varying vec3 vUnit;    // position on the unit sphere (shorter than 1 inside a facet)
varying vec3 vViewPos; // camera-relative, world axes, m
void main() {
  vUnit = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vViewPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform vec3 uSunDir;         // unit, body -> Sun, world axes
uniform vec3 uSunIlluminance; // lux per channel at the body
uniform vec3 uTint;
uniform float uReflectance;   // Lambert reflectance
uniform float uRadius;        // m
uniform float uExposure;
uniform float uFade;
uniform float uSeed;
varying vec3 vUnit;
varying vec3 vViewPos;
void main() {
  vec3 d = vViewPos / uRadius;
  float k = cosmosSphereFactor(vUnit, d);
  vec3 p = normalize(vUnit + d * (k - 1.0));
  // Albedo pattern: broad patches and finer mottling, about +-20 %.
  vec3 q = p * 2.3 + uSeed;
  float patches = gnoise(q) + 0.5 * gnoise(q * 2.7) + 0.25 * gnoise(q * 7.1);
  float albedo = uReflectance * clamp(1.0 + 0.22 * patches, 0.6, 1.4);
  float mu0 = max(dot(p, uSunDir), 0.0);
  vec3 L = uSunIlluminance * uTint * albedo * mu0 / 3.14159265;
  gl_FragColor = vec4(min(L * uExposure * uFade, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT_AT(k);
}
