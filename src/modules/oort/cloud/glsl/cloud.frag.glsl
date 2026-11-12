// oort: soft round sprite. vColor is the pre-exposed mean radiance over the sprite (tinted); the soft
// profile (mean 0.236 over the square) is normalised so the sprite still integrates to it. Additive
// blending, no depth write.
varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float w = 1.0 - smoothstep(0.0, 0.5, r);
  gl_FragColor = vec4(vColor * (w * 4.24), 1.0);
  LOG_DEPTH_FRAGMENT();
}
