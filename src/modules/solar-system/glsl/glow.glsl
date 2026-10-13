// Sun v1 glow: a camera-facing quad around the Sun with radiance falling as (R/r)^3 outside the
// disk (an aureole standing in for forward scattering; the corona proper comes with P3 'sun').
// Pre-exposed like everything else. The fragment stage starts at the marker line.
varying vec2 vXY;
void main() {
  vXY = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform float uExposure;
uniform float uFade;
uniform float uGlowScale;   // quad half-size in Sun radii
uniform vec3 uGlowRadiance; // cd/m2 per channel just outside the limb
varying vec2 vXY;
void main() {
  float r = length(vXY) * uGlowScale; // in Sun radii
  if (r < 1.0 || r > uGlowScale) discard;
  float edge = 1.0 - smoothstep(0.6 * uGlowScale, uGlowScale, r);
  vec3 L = uGlowRadiance * pow(1.0 / r, 3.0) * edge;
  gl_FragColor = vec4(min(L * uExposure * uFade, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
