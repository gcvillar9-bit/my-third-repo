// Hashes and gradient noise. Periodic variants wrap integer lattice coordinates so detail
// bands can use float64-anchored origins frac(centre / lambda / P) * P (SURFACE_NOISE_PERIOD).
#ifndef COSMOS_NOISE_GLSL
#define COSMOS_NOISE_GLSL
// PCG-style integer hash: well distributed, stable for lattice coordinates.
uint cosmosHashU(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
uint cosmosHashU3(uvec3 v) { return cosmosHashU(v.x ^ cosmosHashU(v.y ^ cosmosHashU(v.z))); }
float hash13(vec3 p) { return float(cosmosHashU3(uvec3(ivec3(floor(p))))) * (1.0 / 4294967296.0); }
float hash12(vec2 p) { return float(cosmosHashU(uint(int(floor(p.x))) ^ cosmosHashU(uint(int(floor(p.y)))))) * (1.0 / 4294967296.0); }
vec3 cosmosGrad(ivec3 c) {
  uint h = cosmosHashU3(uvec3(c));
  vec3 g = vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) / 511.5 - 1.0;
  return normalize(g + 1e-4);
}
vec3 cosmosFade(vec3 f) { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }
// Periodic gradient noise in [-1, 1] with integer period (per axis).
float pnoise(vec3 p, vec3 period) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = cosmosFade(f);
  ivec3 per = ivec3(max(period, vec3(1.0)));
  ivec3 i0 = ivec3(mod(i, vec3(per)));
  ivec3 i1 = ivec3(mod(i + 1.0, vec3(per)));
  float n000 = dot(cosmosGrad(ivec3(i0.x, i0.y, i0.z)), f - vec3(0, 0, 0));
  float n100 = dot(cosmosGrad(ivec3(i1.x, i0.y, i0.z)), f - vec3(1, 0, 0));
  float n010 = dot(cosmosGrad(ivec3(i0.x, i1.y, i0.z)), f - vec3(0, 1, 0));
  float n110 = dot(cosmosGrad(ivec3(i1.x, i1.y, i0.z)), f - vec3(1, 1, 0));
  float n001 = dot(cosmosGrad(ivec3(i0.x, i0.y, i1.z)), f - vec3(0, 0, 1));
  float n101 = dot(cosmosGrad(ivec3(i1.x, i0.y, i1.z)), f - vec3(1, 0, 1));
  float n011 = dot(cosmosGrad(ivec3(i0.x, i1.y, i1.z)), f - vec3(0, 1, 1));
  float n111 = dot(cosmosGrad(ivec3(i1.x, i1.y, i1.z)), f - vec3(1, 1, 1));
  return 1.6 * mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                   mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
// Non-periodic gradient noise (large period).
float gnoise(vec3 p) { return pnoise(p, vec3(65536.0)); }
// fBm of periodic noise: octaves double frequency (period doubles too, so it stays periodic).
float pfbm(vec3 p, vec3 period, int octaves) {
  float a = 0.5, s = 0.0;
  for (int k = 0; k < 8; k++) {
    if (k >= octaves) break;
    s += a * pnoise(p, period);
    p *= 2.0; period *= 2.0; a *= 0.5;
  }
  return s;
}
#endif
