// Orbits, habitable-zone ring and planet markers: host-relative positions (m, world axes, float32),
// object.position = host centre relative to the camera. Log depth so bodies occlude them.
attribute vec3 aColor;
uniform float uPointSize;
varying vec3 vColor;

void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPointSize;
  LOG_DEPTH_VERTEX();
}
