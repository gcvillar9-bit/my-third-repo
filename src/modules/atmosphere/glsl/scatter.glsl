// Per-pixel atmosphere ray setup and the in-scattering raymarch, shared by the full-resolution
// composite and the reduced-resolution march pass (P4-P). Needs DEPTH_GLSL, common.glsl and
// view-ray.glsl before it.
//
// Both passes address the frame by integer full-resolution pixel: the depth is fetched at that
// pixel and the ray goes through its centre, so depth and ray always agree. (The half-resolution
// pass used to sample depth with a uv on the corner between four pixels, and rounding picked one
// of them in a screen-aligned pattern.) The outside-view march uses a fixed step grid measured from
// the segment's dense end (atmoMarchGrid), so neighbouring pixels integrate alike: there are no
// integer step-count jumps and no dither pattern for the half-resolution upsample to turn into
// stripes.
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

// Atmosphere ray and segment of the full-resolution pixel `px` (integer pixel coordinates of the
// depth texture).
AtmoPixel atmoPixel(ivec2 px) {
  AtmoPixel p;
  p.kind = ATMO_NONE;
  ivec2 size = textureSize(uDepth, 0);
  px = clamp(px, ivec2(0), size - 1);
  vec3 dirV = viewDirFromUv((vec2(px) + 0.5) / vec2(size));
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
  float d = texelFetch(uDepth, px, 0).r;
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

// Outside-view step grid (mirrored by model.ts gridSteps/gridDistance): step x of a segment covers
// [s(x), s(x + 1)] km from the segment's dense end (the ground or a surface, or the ray's closest
// approach to the centre), with s(x) = u (A x + B x^2) and u = shell thickness / 100. Earth's
// 100 km vertical column takes 8 steps, the first 2 km long; a longer path adds steps of fixed
// length, and the step at the thin end is the fraction of a step that fits, so the integral is
// continuous in the path length and neighbouring pixels share the grid. Past `cap` steps the grid
// stretches, continuously, to fit.
#define ATMO_GRID_A 0.5
#define ATMO_GRID_B 1.5

// Marches [tAnchor, tAnchor + len] (dir > 0, dense at the start) or [tAnchor - len, tAnchor]
// (dir < 0, dense at the end), front to back.
void atmoMarchGrid(vec3 ro, vec3 rd, vec3 sun, float tAnchor, float len, float dir, float cap,
                   inout vec3 L, inout vec3 T, inout vec3 fms) {
  float cosT = dot(rd, sun);
  float phR = atmoPhaseR(cosT, false);
  vec3 phM = atmoPhaseM(cosT, false);
  float u = (uAtmoTop - uAtmoBottom) / 100.0;
  float sMax = max(len, 0.0) / u;
  float xMax = 2.0 * sMax / (ATMO_GRID_A + sqrt(ATMO_GRID_A * ATMO_GRID_A + 4.0 * ATMO_GRID_B * sMax));
  if (xMax > cap) {
    u *= sMax / (cap * (ATMO_GRID_A + ATMO_GRID_B * cap));
    xMax = cap;
  }
  int n = int(ceil(xMax - 1e-4));
  for (int i = 0; i < 128; i++) {
    if (i >= n) break;
    float xa;
    float xb;
    if (dir > 0.0) {
      xa = float(i);
      xb = min(float(i + 1), xMax);
    } else {
      xa = i == 0 ? xMax : float(n - i);
      xb = float(n - i - 1);
    }
    float sa = u * xa * (ATMO_GRID_A + ATMO_GRID_B * xa);
    float sb = u * xb * (ATMO_GRID_A + ATMO_GRID_B * xb);
    atmoStep(ro, rd, sun, tAnchor + dir * sa, tAnchor + dir * sb, phR, phM, L, T, fms);
  }
}

// In-scattered luminance (per unit sun illuminance) and transmittance along the pixel's segment.
void atmoMarchPixel(AtmoPixel p, out vec3 L, out vec3 T) {
  L = vec3(0.0);
  T = vec3(1.0);
  vec3 f = vec3(0.0);
  // Split at the closest approach to the centre so limb rays get fine steps where the air is densest.
  float tc = clamp(-dot(p.ro, p.rd), p.tStart, p.tEnd);
  bool split = tc > p.tStart + 1e-3 && tc < p.tEnd - 1e-3;
  if (uInside < 0.5) {
    // Outside view (disc and limb): the fixed grid from the dense end, at most uSteps steps.
    float cap = float(uSteps);
    if (split) {
      atmoMarchGrid(p.ro, p.rd, uSunDir, tc, tc - p.tStart, -1.0, 0.5 * cap, L, T, f);
      atmoMarchGrid(p.ro, p.rd, uSunDir, tc, p.tEnd - tc, 1.0, 0.5 * cap, L, T, f);
    } else if (tc >= p.tEnd - 1e-3) {
      atmoMarchGrid(p.ro, p.rd, uSunDir, p.tEnd, p.tEnd - p.tStart, -1.0, cap, L, T, f);
    } else {
      atmoMarchGrid(p.ro, p.rd, uSunDir, p.tStart, p.tEnd - p.tStart, 1.0, cap, L, T, f);
    }
    return;
  }
  // Camera inside (geometry beyond the aerial-perspective range): uSteps quadratic steps.
  int n = uSteps;
  if (split) {
    atmoMarch(p.ro, p.rd, uSunDir, p.tStart, tc, n / 2, true, false, L, T, f);
    atmoMarch(p.ro, p.rd, uSunDir, tc, p.tEnd, n - n / 2, false, false, L, T, f);
  } else {
    atmoMarch(p.ro, p.rd, uSunDir, p.tStart, p.tEnd, n, tc >= p.tEnd - 1e-3, false, L, T, f);
  }
}
#endif
