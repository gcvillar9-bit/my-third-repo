// Seam-safe equirectangular sampling: the u derivative is wrapped so the atan seam at
// longitude 180 deg does not select the smallest mip.
#ifndef SOLAR_EQUIRECT_GLSL
#define SOLAR_EQUIRECT_GLSL
vec4 sampleEquirect(sampler2D t, vec2 uv) {
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  return textureGrad(t, uv, dx, dy);
}
#endif
