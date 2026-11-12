// Oort lines (orbits, flyby tracks, scale shells): display-referred colour with per-vertex alpha, like the
// planets' orbit lines (a HUD drawn in the scene, not pre-exposed). Vertices are camera-relative, computed
// in float64 on the CPU. The fragment stage starts at the marker line.
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  LOG_DEPTH_VERTEX();
}
//#fragment
varying float vAlpha;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, vAlpha);
  LOG_DEPTH_FRAGMENT();
}
