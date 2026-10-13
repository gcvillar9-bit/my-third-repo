// Reduced-resolution ray march (screen view) or one sky-cube face (MW_CUBE). Writes luminance in
// cd/m² · STORE_SCALE (exposure-independent, so the result is cached while the view is still);
// alpha is the temporal accumulation weight. Prefixed with modelGlslDefines() + galaxy.glsl.
uniform vec3 uOrigin;       // camera, model kpc
uniform mat3 uRayBasis;     // columns: right · tan(fovX/2), up · tan(fovY/2), forward (model axes)
uniform int uSteps;
uniform int uFace;
uniform float uLumScale;    // LUMINANCE_PER_UNIT · STORE_SCALE
uniform float uAlpha;
uniform float uJitterOffset;
uniform sampler2D uBlueNoise;
varying vec2 vUv;

// Direction of cube-map texel (s, t) on `face` (OpenGL cube-map convention, model axes).
vec3 cubeDir(int face, vec2 st) {
  vec2 c = st * 2.0 - 1.0;
  if (face == 0) return vec3(1.0, -c.y, -c.x);
  if (face == 1) return vec3(-1.0, -c.y, c.x);
  if (face == 2) return vec3(c.x, 1.0, c.y);
  if (face == 3) return vec3(c.x, -1.0, -c.y);
  if (face == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}

void main() {
#ifdef MW_CUBE
  vec3 rd = normalize(cubeDir(uFace, vUv));
#else
  vec3 rd = normalize(uRayBasis * vec3(vUv * 2.0 - 1.0, 1.0));
#endif
  float jitter = fract(texture2D(uBlueNoise, gl_FragCoord.xy / 64.0).r + uJitterOffset);
  gl_FragColor = vec4(mwMarch(uOrigin, rd, uSteps, jitter) * uLumScale, uAlpha);
}
