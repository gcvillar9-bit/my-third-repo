// Markers, orbit rings and probe paths: display-referred colour (not pre-exposed), like the orbit
// lines of the Solar System, with per-vertex alpha. Vertices are camera-relative, computed in
// float64 every frame (render.ts). The marker is a ring with a centre dot: a finder aid, not light
// from the craft. The fragment stage starts at the marker line.
attribute float aAlpha;
uniform float uPointSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  gl_PointSize = aAlpha > 0.0 ? uPointSize : 0.0;
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPoint; // 1 for markers, 0 for lines
varying float vAlpha;
void main() {
  float a = uOpacity * vAlpha;
  if (uPoint > 0.5) {
    float r = 2.0 * length(gl_PointCoord - 0.5);
    float ring = smoothstep(0.52, 0.68, r) * (1.0 - smoothstep(0.84, 1.0, r));
    float core = 1.0 - smoothstep(0.12, 0.3, r);
    a *= max(ring, core);
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  LOG_DEPTH_FRAGMENT();
}
