// smallbodies: point sprite. vL is the pre-exposed mean radiance over the sprite; the soft disc
// profile is normalised so the sprite still integrates to it. Additive blending, no depth write.
uniform vec3 uTint; // linear RGB, luminance 1
varying float vL;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float w = 1.0 - smoothstep(0.25, 0.5, r);
  gl_FragColor = vec4(uTint * (vL * w * 1.6), 1.0);
  LOG_DEPTH_FRAGMENT();
}
