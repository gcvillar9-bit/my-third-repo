// Display-referred line colour (pre-exposed, independent of EV): a UI overlay drawn in the background layer.
uniform vec3 uColor;
uniform float uFade;

void main() {
  gl_FragColor = vec4(uColor * uFade, 1.0);
}
