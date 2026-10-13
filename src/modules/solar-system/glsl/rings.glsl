// Saturn's rings v1: a textured annulus in the planet's equator at the true radii (Celestia
// colour + opacity profile), lit by the Sun with the planet's shadow from shadows.glsl. The unlit
// face shows a dim diffusely transmitted glow. The fragment stage starts at the marker line.
varying vec2 vLocal;
varying vec3 vViewPos;
void main() {
  vLocal = position.xy;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vViewPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform sampler2D uRingMap;
uniform float uHasMap;
uniform float uInner;
uniform float uOuter;
uniform vec3 uNormal;         // ring-plane normal, world axes
uniform vec3 uSunPos;         // camera-relative Sun centre
uniform vec3 uSunIlluminance; // lux per channel at Saturn
uniform float uExposure;
uniform float uFade;
varying vec2 vLocal;
varying vec3 vViewPos;
void main() {
  float u = (length(vLocal) - uInner) / (uOuter - uInner);
  if (u < 0.0 || u > 1.0) discard;
  vec4 t = uHasMap > 0.5 ? texture(uRingMap, vec2(u, 0.5)) : vec4(0.6, 0.55, 0.5, 0.5);
  if (t.a < 0.004) discard;
  vec3 sunDir = normalize(uSunPos - vViewPos);
  vec3 viewDir = normalize(-vViewPos);
  float muS = dot(uNormal, sunDir);
  float muV = dot(uNormal, viewDir);
  float lit = muS * muV > 0.0 ? 1.0 : 0.3 * (1.0 - t.a);
  float g = abs(muS) / (abs(muS) + abs(muV) + 1e-3);
  vec3 E = uSunIlluminance * sunVisibility(vViewPos);
  vec3 L = E * t.rgb * g * lit / 3.14159265;
  gl_FragColor = vec4(min(L * uExposure, vec3(60000.0)), t.a * uFade);
  LOG_DEPTH_FRAGMENT();
}
