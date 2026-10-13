// Planetary rings (P3-A): a quad in the planet's equatorial plane scaled to the outer radius; the
// fragment computes the radius exactly and samples the baked profile (R albedo, G normal opacity,
// B dust fraction). Single-scattering slab: lit face reflects, unlit face diffusely transmits,
// with a Henyey-Greenstein mix (icy particles backscatter, dust forward-scatters). Planet shadow
// from shadows.glsl. Premultiplied output: rgb = L * exposure, a = slant opacity.
// render.ts prepends the depth, shadows and phase chunks. The fragment stage starts at the marker.
uniform float uOuterM;
varying vec2 vLocal;
varying vec3 vViewPos;
void main() {
  vLocal = position.xy * uOuterM;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vViewPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform sampler2D uProfile;
uniform vec2 uRange;          // profile inner, outer radius, m
uniform vec3 uNormal;         // ring-plane normal, world axes
uniform vec3 uSunPos;         // camera-relative Sun centre, m
uniform vec3 uSunIlluminance; // lux per channel at the planet
uniform vec3 uTint;           // particle colour, luminance ~1
uniform vec2 uG;              // HG asymmetry: icy particles, dust
uniform float uExposure;
uniform float uFade;
varying vec2 vLocal;
varying vec3 vViewPos;
void main() {
  float u = (length(vLocal) - uRange.x) / (uRange.y - uRange.x);
  if (u <= 0.0 || u >= 1.0) discard;
  vec4 t = texture(uProfile, vec2(u, 0.5));
  float a0 = clamp(t.g, 0.0, 0.9999);
  if (a0 < 1e-7) discard;
  vec3 sunDir = normalize(uSunPos - vViewPos);
  vec3 viewDir = normalize(-vViewPos);
  float muS = dot(uNormal, sunDir);
  float muV = dot(uNormal, viewDir);
  float m0 = max(abs(muS), 0.01);
  float m = max(abs(muV), 0.01);
  float tau = -log(1.0 - a0);
  float cosTheta = dot(-sunDir, viewDir); // 1 = forward scattering (backlit)
  float p4pi = 4.0 * COSMOS_PI * mix(phaseHG(cosTheta, uG.x), phaseHG(cosTheta, uG.y), t.b);
  float f;
  if (muS * muV > 0.0) f = m0 / (m0 + m) * (1.0 - exp(-tau * (1.0 / m0 + 1.0 / m)));
  else if (abs(m0 - m) < 1e-3) f = tau / m0 * exp(-tau / m0);
  else f = m0 / (m0 - m) * (exp(-tau / m0) - exp(-tau / m));
  float iof = t.r * p4pi * 0.25 * f;
  vec3 L = uSunIlluminance * sunVisibility(vViewPos) * uTint * iof / COSMOS_PI;
  float alpha = 1.0 - exp(-tau / m);
  gl_FragColor = vec4(min(L * uExposure, vec3(60000.0)) * uFade, alpha * uFade);
  LOG_DEPTH_FRAGMENT();
}
