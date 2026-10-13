// Blackbody colour from the shared LUT (render.uniforms.uBlackbodyLut, 256×1, linear sRGB with
// luminance 1, log-spaced Teff 1000..40000 K; built from Planck × CIE 1931 2° in photometry.ts).
#ifndef COSMOS_BLACKBODY_GLSL
#define COSMOS_BLACKBODY_GLSL
uniform sampler2D uBlackbodyLut;
#define COSMOS_BB_TMIN 1000.0
#define COSMOS_BB_TMAX 40000.0
#define COSMOS_BB_SIZE 256.0
float blackbodyLutU(float teff) {
  float u = clamp(log(teff / COSMOS_BB_TMIN) / log(COSMOS_BB_TMAX / COSMOS_BB_TMIN), 0.0, 1.0);
  return (u * (COSMOS_BB_SIZE - 1.0) + 0.5) / COSMOS_BB_SIZE;
}
// Linear sRGB chromaticity of a blackbody, luminance 1.
vec3 blackbodyColor(float teff) { return texture(uBlackbodyLut, vec2(blackbodyLutU(teff), 0.5)).rgb; }
// Radiance with a given luminance (cd/m²), still before exposure.
vec3 blackbodyRadiance(float teff, float luminanceCdM2) { return blackbodyColor(teff) * luminanceCdM2; }
#endif
