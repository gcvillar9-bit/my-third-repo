// Comet orbit lines: display-referred colour with per-vertex alpha, in the style of the planets' orbit lines.
// Vertices are camera-relative, computed in float64 every frame (orbits.ts). The fragment stage starts at
// the marker line.
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform vec3 uColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, vAlpha);
  LOG_DEPTH_FRAGMENT();
}
