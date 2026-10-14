// Per-pixel atmosphere ray setup and the in-scattering raymarch, shared by the full-resolution
// composite and the reduced-resolution march pass (P4-P). Needs DEPTH_GLSL, common.glsl and
// view-ray.glsl before it.
#ifndef ATMO_SCATTER_GLSL
#define ATMO_SCATTER_GLSL
uniform sampler2D uDepth;
uniform float uInside;
uniform int uSteps;

#define ATMO_NONE 0    // ray misses the shell, or geometry in front of it
#define ATMO_SKY 1     // camera inside, sky pixel: sky-view LUT
#define ATMO_AERIAL 2  // camera inside, geometry within uApMax: aerial-perspective atlas
#define ATMO_MARCH 3   // everything else: raymarch [tStart, tEnd]

struct AtmoPixel {
  int kind;
  vec3 ro;
  vec3 rd;
  float r;
  float mu;
  float tStart;
  float tEnd;
  float tGeom;
  bool geomIn;
  bool hitsGround;
};

AtmoPixel atmoPixel(vec2 uv) {
  AtmoPixel p;
  p.kind = ATMO_NONE;
  vec3 dirV = viewDirFromUv(uv);
  vec4 ray = atmoRay(dirV);
  p.rd = ray.xyz;
  p.ro = uCamPos;
  p.r = length(p.ro);
  p.mu = dot(p.ro, p.rd) / p.r;
  p.tStart = 0.0;
  p.tEnd = 0.0;
  p.tGeom = 1e30;
  p.geomIn = false;
  p.hitsGround = false;
  vec2 top = raySphere(p.ro, p.rd, uAtmoTop);
  if (top.y <= 0.0) return p;
  float d = texture(uDepth, uv).r;
  bool bg = d >= 0.9999999;
  p.tGeom = bg ? 1e30 : linearFromLogDepth(d) / max(-dirV.z, 1e-6) * 0.001 * ray.w;
  p.tStart = max(top.x, 0.0);
  p.geomIn = !bg && p.tGeom < top.y;
  if (p.geomIn && p.tGeom <= p.tStart) return p;
  float tG;
  if (uInside > 0.5) {
    tG = groundDistance(p.r, uCamH, p.mu);
  } else {
    vec2 g = raySphere(p.ro, p.rd, uAtmoBottom);
    tG = g.x > 0.0 ? g.x : -1.0;
  }
  p.hitsGround = tG > 0.0 && tG < top.y;
  p.tEnd = p.geomIn ? p.tGeom : (p.hitsGround ? tG : top.y);
  if (uInside > 0.5 && !p.geomIn) p.kind = ATMO_SKY;
  else if (uInside > 0.5 && p.tGeom < uApMax) p.kind = ATMO_AERIAL;
  else p.kind = ATMO_MARCH;
  return p;
}

// In-scattered luminance (per unit sun illuminance) and transmittance along the pixel's segment.
void atmoMarchPixel(AtmoPixel p, out vec3 L, out vec3 T) {
  L = vec3(0.0);
  T = vec3(1.0);
  vec3 f = vec3(0.0);
  // Split at the closest approach to the centre so limb rays get fine steps where the air is densest.
  float tc = clamp(-dot(p.ro, p.rd), p.tStart, p.tEnd);
  int n = uSteps;
  if (uInside < 0.5) {
    // Outside view: steps follow the path length through the shell, so the short path in front of
    // the disc takes few steps while limb rays keep the full count.
    // The fractional count is dithered per pixel (interleaved gradient noise, deterministic) so the
    // integer step changes do not show as horizontal bands towards the limb.
    float seg = (uAtmoTop - uAtmoBottom) / 8.0;
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    n = clamp(int(floor((p.tEnd - p.tStart) / seg + ign)), 8, uSteps);
  }
  if (tc > p.tStart + 1e-3 && tc < p.tEnd - 1e-3) {
    atmoMarch(p.ro, p.rd, uSunDir, p.tStart, tc, n / 2, true, false, L, T, f);
    atmoMarch(p.ro, p.rd, uSunDir, tc, p.tEnd, n - n / 2, false, false, L, T, f);
  } else {
    atmoMarch(p.ro, p.rd, uSunDir, p.tStart, p.tEnd, n, tc >= p.tEnd - 1e-3, false, L, T, f);
  }
}
#endif
