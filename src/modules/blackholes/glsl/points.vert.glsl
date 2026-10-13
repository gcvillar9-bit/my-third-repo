// S-star points: camera-relative positions (float32, world axes), luminance-preserving sprites.
attribute vec3 aColor;      // pre-exposed colour of the sprite's mean
attribute float aSize;      // sprite diameter, px
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize;
  LOG_DEPTH_VERTEX();
}
