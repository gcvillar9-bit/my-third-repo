// Display-referred guide lines (constant brightness whatever the exposure).
varying vec3 vColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(vColor * uOpacity, 1.0);
  LOG_DEPTH_FRAGMENT();
}
