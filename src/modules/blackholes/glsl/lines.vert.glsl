// Orbit lines in a hole frame (vertices relative to the hole, m, world axes).
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  LOG_DEPTH_VERTEX();
}
