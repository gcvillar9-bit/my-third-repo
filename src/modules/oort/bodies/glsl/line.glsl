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
  // Hidden lines cost nothing, and a fragment whose interpolated alpha is not a number (seen on a
  // sub-pixel segment exactly face-on to the camera) must never reach the HDR buffer: bloom would spread
  // it over the whole frame.
  if (!(vAlpha > 0.0 && vAlpha <= 1.0)) discard;
  gl_FragColor = vec4(vColor, vAlpha);
  LOG_DEPTH_FRAGMENT();
}
