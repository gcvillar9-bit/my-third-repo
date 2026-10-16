// Atmosphere core (Hillaire 2020), shared by the LUT passes and the composite. Mirrors model.ts
// function by function. Units: km and 1/km in "atmosphere space" (body-fixed axes with z scaled
// by a/c so the ellipsoid is a sphere of radius uAtmoBottom). Radiance is per unit solar
// illuminance. Requires PHASE_GLSL (phaseRayleigh, phaseCornetteShanks).
#ifndef ATMO_COMMON_GLSL
#define ATMO_COMMON_GLSL
#define ATMO_PI 3.14159265358979
uniform float uAtmoBottom;
uniform float uAtmoTop;
uniform vec3 uRayleighS;
uniform float uRayleighH;
uniform vec3 uMieS;
uniform vec3 uMieE;
uniform float uMieH;
uniform vec3 uMieG;
uniform vec3 uAbsE;
uniform float uAbsC;
uniform float uAbsW;
uniform vec3 uGroundAlbedo;
uniform sampler2D uTransLut;
uniform sampler2D uMsLut;
uniform float uMsOn;

struct AtmoMedium {
  vec3 rayS;
  vec3 mieS;
  vec3 ext;
};

AtmoMedium atmoMedium(float hKm) {
  float h = max(hKm, 0.0);
  float dr = exp(-h / uRayleighH);
  float dm = exp(-h / uMieH);
  float da = max(0.0, 1.0 - abs(h - uAbsC) / uAbsW);
  AtmoMedium m;
  m.rayS = uRayleighS * dr;
  m.mieS = uMieS * dm;
  m.ext = m.rayS + uMieE * dm + uAbsE * da;
  return m;
}

// (near, far) distances to a sphere at the origin; far < 0 when missed or behind.
vec2 raySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(-1.0, -1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

// Distance to the ground from height h (= r - bottom, passed separately to avoid cancellation)
// along zenith cosine mu; -1 when the ray misses the ground.
float groundDistance(float r, float h, float mu) {
  float c = h * (2.0 * uAtmoBottom + h);
  float b = r * mu;
  float disc = b * b - c;
  if (mu >= 0.0 || disc < 0.0 || h < 0.0) return -1.0;
  return c / (-b + sqrt(disc));
}

float distanceToTop(float r, float mu) {
  float disc = r * r * (mu * mu - 1.0) + uAtmoTop * uAtmoTop;
  return max(0.0, -r * mu + sqrt(max(disc, 0.0)));
}

vec2 transmittanceUv(float r, float mu) {
  float B = uAtmoBottom;
  float H = sqrt(uAtmoTop * uAtmoTop - B * B);
  float rho = sqrt(max(0.0, r * r - B * B));
  float d = distanceToTop(r, mu);
  float dMin = uAtmoTop - r;
  float dMax = rho + H;
  return clamp(vec2((d - dMin) / max(dMax - dMin, 1e-6), rho / H), 0.0, 1.0);
}

// uv -> (r, mu)
vec2 transmittanceParams(vec2 uv) {
  float B = uAtmoBottom;
  float H = sqrt(uAtmoTop * uAtmoTop - B * B);
  float rho = H * uv.y;
  float r = sqrt(rho * rho + B * B);
  float dMin = uAtmoTop - r;
  float dMax = rho + H;
  float d = dMin + uv.x * (dMax - dMin);
  float mu = d <= 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  return vec2(r, clamp(mu, -1.0, 1.0));
}

float toSubUv(float u, float n) { return 0.5 / n + u * ((n - 1.0) / n); }
float fromSubUv(float s, float n) { return (s - 0.5 / n) * (n / (n - 1.0)); }

vec2 multiScatterUv(float r, float muS) {
  float u = clamp(muS * 0.5 + 0.5, 0.0, 1.0);
  float v = clamp((r - uAtmoBottom) / (uAtmoTop - uAtmoBottom), 0.0, 1.0);
  return vec2(toSubUv(u, 32.0), toSubUv(v, 32.0));
}

float planetShadow(float r, float muS) {
  float muH = -sqrt(max(0.0, 1.0 - (uAtmoBottom * uAtmoBottom) / (r * r)));
  return smoothstep(0.0, 1.0, (muS - muH + 0.004) / 0.008);
}

vec3 sunTransmittance(float r, float muS) {
  return texture(uTransLut, transmittanceUv(r, muS)).rgb * planetShadow(r, muS);
}

// Sky-view LUT (192x108) parameterisation; h = viewer height above the ground.
vec2 skyViewHorizon(float r, float h) {
  float vH = sqrt(max(h * (2.0 * uAtmoBottom + h), 0.0));
  float beta = acos(clamp(vH / r, -1.0, 1.0));
  return vec2(beta, ATMO_PI - beta);
}

vec2 skyViewParams(float r, float h, vec2 suv) {
  float u = fromSubUv(suv.x, 192.0);
  float v = fromSubUv(suv.y, 108.0);
  vec2 bz = skyViewHorizon(r, h);
  float vzc;
  if (v < 0.5) {
    float c = 1.0 - (1.0 - 2.0 * v) * (1.0 - 2.0 * v);
    vzc = cos(bz.y * c);
  } else {
    float c = (2.0 * v - 1.0) * (2.0 * v - 1.0);
    vzc = cos(bz.y + bz.x * c);
  }
  return vec2(vzc, -(u * u * 2.0 - 1.0));
}

vec2 skyViewUv(float r, float h, bool intersectGround, float vzc, float lvc) {
  vec2 bz = skyViewHorizon(r, h);
  float ang = acos(clamp(vzc, -1.0, 1.0));
  float v;
  if (!intersectGround) {
    float c = clamp(ang / bz.y, 0.0, 1.0);
    v = (1.0 - sqrt(1.0 - c)) * 0.5;
  } else {
    float c = clamp((ang - bz.y) / max(bz.x, 1e-6), 0.0, 1.0);
    v = sqrt(c) * 0.5 + 0.5;
  }
  float u = sqrt(clamp(-lvc * 0.5 + 0.5, 0.0, 1.0));
  return vec2(toSubUv(u, 192.0), toSubUv(v, 108.0));
}

// One raymarch step over [t0, t1] (sampled at its midpoint, Beer-Lambert within the step):
// single scattering (+ multiple scattering from the MS LUT when uMsOn > 0.5) accumulated into L,
// T (throughput) and fms.
void atmoStep(vec3 ro, vec3 rd, vec3 sun, float t0, float t1, float phR, vec3 phM,
              inout vec3 L, inout vec3 T, inout vec3 fms) {
  float dt = t1 - t0;
  vec3 P = ro + rd * (0.5 * (t0 + t1));
  float r = length(P);
  float muS = dot(P, sun) / r;
  AtmoMedium m = atmoMedium(r - uAtmoBottom);
  vec3 ts = sunTransmittance(r, muS);
  vec3 ms = uMsOn > 0.5 ? texture(uMsLut, multiScatterUv(r, muS)).rgb : vec3(0.0);
  vec3 sS = m.rayS + m.mieS;
  vec3 S = ts * (m.rayS * phR + m.mieS * phM) + ms * sS;
  vec3 st = exp(-m.ext * dt);
  vec3 k = mix(vec3(dt), (1.0 - st) / max(m.ext, vec3(1e-9)), step(vec3(1e-9), m.ext));
  L += T * S * k;
  fms += T * sS * k;
  T *= st;
}

// Phase functions of a view ray (isotropic for the multi-scattering LUT pass).
float atmoPhaseR(float cosT, bool iso) { return iso ? 1.0 / (4.0 * ATMO_PI) : phaseRayleigh(cosT); }
vec3 atmoPhaseM(float cosT, bool iso) {
  return iso ? vec3(1.0 / (4.0 * ATMO_PI))
             : vec3(phaseCornetteShanks(cosT, uMieG.r), phaseCornetteShanks(cosT, uMieG.g),
                    phaseCornetteShanks(cosT, uMieG.b));
}

// Single scattering (+ multiple scattering from the MS LUT when uMsOn > 0.5) along [ta, tb];
// quadratic steps dense at ta (or at tb). Accumulates into L, T (throughput) and fms.
void atmoMarch(vec3 ro, vec3 rd, vec3 sun, float ta, float tb, int n, bool denseAtB, bool iso,
               inout vec3 L, inout vec3 T, inout vec3 fms) {
  float cosT = dot(rd, sun);
  float phR = atmoPhaseR(cosT, iso);
  vec3 phM = atmoPhaseM(cosT, iso);
  float fn = float(max(n, 1));
  for (int i = 0; i < 128; i++) {
    if (i >= n) break;
    float u0 = float(i) / fn;
    float u1 = float(i + 1) / fn;
    if (denseAtB) {
      u0 = 1.0 - (1.0 - u0) * (1.0 - u0);
      u1 = 1.0 - (1.0 - u1) * (1.0 - u1);
    } else {
      u0 *= u0;
      u1 *= u1;
    }
    atmoStep(ro, rd, sun, mix(ta, tb, u0), mix(ta, tb, u1), phR, phM, L, T, fms);
  }
}
#endif
