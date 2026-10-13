// Cube-sphere surface vertex shader (solar-system 'sphere' provider). The mesh is a unit
// cube-sphere in body-fixed axes; object.position = camera-relative centre, object.quaternion =
// body-fixed -> world, object.scale = radii (a, a, c). sphere.ts prepends the depth chunk.
uniform vec3 uRadii;
varying vec3 vPosBody; // body-fixed position, m
varying vec3 vViewPos; // camera-relative position, world axes, m
void main() {
  vPosBody = position * uRadii;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vViewPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  LOG_DEPTH_VERTEX();
}
