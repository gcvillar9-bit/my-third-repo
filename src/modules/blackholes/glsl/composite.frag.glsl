// Full-resolution composite: the reduced-resolution march near the hole, weak-field LUT lensing of
// the scene and background cube further out, the untouched input elsewhere and in front of the hole.
varying vec2 vUv;
uniform sampler2D uMarch;
uniform float uMarchOn;
uniform float uFullMarch;
uniform float uWeakCos;     // cos of the angular radius where the deflection exceeds ~0.5 px

void main() {
  vec3 inCol = texture(uInput, vUv).rgb;
  float zl = linearFromLogDepth(texture(uDepth, vUv).r);
  if (zl < uHoleDist - uBoundM) {
    gl_FragColor = vec4(inCol, 1.0);
    return;
  }
  vec3 d = viewRay(vUv);
  float c = dot(d, uHoleDir);
  bool inMarch = uMarchOn > 0.5 &&
    (uFullMarch > 0.5 || (c > 0.0 && uDistRs * length(cross(d, uHoleDir)) < uRBound * 1.08));
  vec3 col = inCol;
  if (inMarch) col = texture(uMarch, vUv).rgb;
  else if (c > uWeakCos) col = sky(weakLensDir(d));
  gl_FragColor = vec4(col, 1.0);
}
