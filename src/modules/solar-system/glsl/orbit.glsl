// Orbit lines: display-referred colour (not pre-exposed, like a HUD drawn in the scene) with
// per-vertex alpha. Vertices are camera-relative, computed in float64 every frame (orbits.ts).
// The fragment stage starts at the marker line.
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vAlpha);
  LOG_DEPTH_FRAGMENT();
}
