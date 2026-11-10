// Spacecraft models: positions in the craft's body axes (m); the mesh matrix carries the attitude
// and the camera-relative position, so vWorld is relative to the camera in world axes.
attribute vec4 aNormal; // xyz unit normal, w = 1 where the craft's own sunshield always shades the face
attribute vec4 aColor;  // rgb = sqrt(albedo), a = gloss
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying float vShaded;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(modelMatrix) * aNormal.xyz;
  vColor = vec4(aColor.rgb * aColor.rgb, aColor.a);
  vShaded = aNormal.w;
  gl_Position = projectionMatrix * viewMatrix * world;
  LOG_DEPTH_VERTEX();
}
