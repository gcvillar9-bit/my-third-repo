// Atmosphere composite (ScreenPass stage 'atmosphere'). Depends only on the scene colour and the
// log depth texture, so it works over any geometry provider.
//   camera inside:  sky pixels -> sky-view LUT + background * transmittance LUT (stars fade in daylight);
//                   geometry nearer than uApMax -> aerial-perspective atlas; farther -> raymarch.
//   camera outside: raymarch through the shell (limb glow, terminator, haze over the disk).
// Raymarched pixels come from the reduced-resolution march pass when uHalf > 0.5 (P4-P): see
// upsampleMarch; a pixel with no matching neighbour marches at full resolution itself.
// out = in * T + L * E_sun * exposure.
uniform sampler2D uInput;
uniform sampler2D uSkyView;
uniform sampler2D uAerial;
uniform sampler2D uHalfL;  // march pass: L, path length (-1: not marched)
uniform sampler2D uHalfT;  // march pass: transmittance
uniform vec2 uHalfSize;
uniform float uHalf;
uniform vec3 uSunE;       // solar illuminance at the body, lux per channel
uniform float uExposure;
uniform float uSunTPost;  // multiply surface pixels by the Sun transmittance
varying vec2 vUv;

// Path-length similarity scale of the upsample weights (relative difference).
#define HALF_SIGMA 0.15

// Upsamples the reduced-resolution march: the four nearest texels whose ray ends the same way as
// this pixel's (geometry/ground vs. leaving the shell) are blended with bilinear x path-similarity
// weights, so the limb and silhouettes do not bleed while smooth but steep gradients (grazing rays
// near the limb) still interpolate. False when no neighbour qualifies: march this pixel instead.
bool upsampleMarch(AtmoPixel p, out vec3 L, out vec3 T) {
  L = vec3(0.0);
  T = vec3(0.0);
  float path = p.tEnd - p.tStart;
  float type = p.geomIn || p.hitsGround ? 1.0 : 0.0;
  vec2 st = vUv * uHalfSize - 0.5;
  vec2 fl = floor(st);
  vec2 fr = st - fl;
  ivec2 i0 = ivec2(fl);
  ivec2 hi = ivec2(uHalfSize) - 1;
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 ij = clamp(i0 + o, ivec2(0), hi);
    vec4 a = texelFetch(uHalfL, ij, 0);
    if (a.a < 0.0) continue;
    vec4 t = texelFetch(uHalfT, ij, 0);
    if (abs(t.a - type) > 0.5) continue;
    float rel = abs(a.a - path) / max(path, 1e-3) / HALF_SIGMA;
    float wb = (o.x == 1 ? fr.x : 1.0 - fr.x) * (o.y == 1 ? fr.y : 1.0 - fr.y);
    float w = (wb + 1e-3) / (1.0 + rel * rel);
    L += a.rgb * w;
    T += t.rgb * w;
    wsum += w;
  }
  if (wsum <= 0.0) return false;
  L /= wsum;
  T /= wsum;
  return true;
}

vec3 skyViewLookup(vec3 ro, float r, vec3 rd, bool hitsGround) {
  vec3 up = ro / r;
  float vzc = dot(rd, up);
  vec3 side = cross(up, rd);
  float sl = length(side);
  float lvc = 1.0;
  if (sl > 1e-5) {
    side /= sl;
    vec3 fwd = cross(side, up);
    vec2 lp = vec2(dot(uSunDir, fwd), dot(uSunDir, side));
    float ll = length(lp);
    lvc = ll > 1e-5 ? lp.x / ll : 1.0;
  }
  return texture(uSkyView, skyViewUv(r, uCamH, hitsGround, vzc, lvc)).rgb;
}

vec4 aerialSlice(vec2 uv, float slice) {
  vec2 p = clamp(uv * 32.0, vec2(0.5), vec2(31.5));
  return texture(uAerial, vec2((slice * 32.0 + p.x) / 1024.0, p.y / 32.0));
}

vec4 aerialLookup(vec2 uv, float t) {
  float s = sqrt(t / uApMax) * 32.0 - 0.5;
  if (s <= 0.0) {
    vec4 a = aerialSlice(uv, 0.0);
    float w = clamp(t / (uApMax * (0.5 / 32.0) * (0.5 / 32.0)), 0.0, 1.0);
    return vec4(a.rgb * w, mix(1.0, a.a, w));
  }
  float i0 = min(floor(s), 31.0);
  float i1 = min(i0 + 1.0, 31.0);
  return mix(aerialSlice(uv, i0), aerialSlice(uv, i1), clamp(s - i0, 0.0, 1.0));
}

// NaN/Inf guard: one bad pixel would otherwise spread over the whole frame through the bloom mip chain.
vec3 finiteOrZero(vec3 c) {
  bvec3 bad = bvec3(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b));
  return vec3(bad.r ? 0.0 : c.r, bad.g ? 0.0 : c.g, bad.b ? 0.0 : c.b);
}

void main() {
  vec3 col = finiteOrZero(texture(uInput, vUv).rgb);
  AtmoPixel p = atmoPixel(vUv);
  if (p.kind == ATMO_NONE) {
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  if (p.kind == ATMO_SKY) {
    L = skyViewLookup(p.ro, p.r, p.rd, p.hitsGround);
    T = p.hitsGround ? vec3(0.0) : texture(uTransLut, transmittanceUv(p.r, p.mu)).rgb;
  } else if (p.kind == ATMO_AERIAL) {
    vec4 ap = aerialLookup(vUv, p.tGeom);
    L = ap.rgb;
    T = vec3(ap.a);
  } else if (!(uHalf > 0.5 && upsampleMarch(p, L, T))) {
    atmoMarchPixel(p, L, T);
  }
  if (uSunTPost > 0.5 && p.geomIn) {
    vec3 P = p.ro + p.rd * p.tGeom;
    float rp = length(P);
    // Any ground inside the shell (terrain reaches tens of km on Mars) is lit through the air above it.
    if (rp < uAtmoTop) {
      float rs = max(rp, uAtmoBottom + 1e-4);
      col *= texture(uTransLut, transmittanceUv(rs, dot(P, uSunDir) / rp)).rgb;
    }
  }
  vec3 outc = col * T + L * uSunE * uExposure;
  gl_FragColor = vec4(min(max(finiteOrZero(outc), 0.0), vec3(60000.0)), 1.0);
}
