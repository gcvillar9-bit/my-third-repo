// Cloud shell vertex shader: unit cube-sphere in body-fixed axes; object.position = camera-relative
// Earth centre, object.quaternion = body-fixed -> world, object.scale = shell radii. DEPTH_GLSL prepended.
uniform vec3 uCloudRadii;
varying vec3 vPosBody; // body-fixed, m
varying vec3 vViewPos; // camera-relative, world axes, m
void main() {
  vPosBody = position * uCloudRadii;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vViewPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  LOG_DEPTH_VERTEX();
}
