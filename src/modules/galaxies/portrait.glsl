// Galaxy portrait (background layer): GLSL twin of marchPortrait() in portrait-model.ts. One back-face
// box per galaxy; each fragment marches the view ray through the galaxy in galaxy-local kpc (camera
// position computed in float64 on the CPU). Disc light and dust come from the baked face-on map
// (R old, G young, B dust tau_V, A HII) with exact per-interval vertical integrals; the bulge from the
// cumulative line-integral table uLut; the polar feature analytically. Output: L · exposure (uGain).
varying vec3 vLocal;
uniform vec3 uHalf;   // box half-extents, kpc
#ifdef COSMOS_VERTEX
void main() {
  vLocal = position * uHalf;
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
}
#else
uniform sampler2D uMap;
uniform sampler2D uLut;
uniform vec3 uCam;        // camera, galaxy-local kpc
uniform float uGain;      // LUX_MAG0 · exposure · 10^(-0.4 (M + 25)) · 1e6 · crossfade weight
uniform float uPixAngle;  // radians per pixel
uniform int uSteps;
uniform bool uOuterSteps; // off-slab segments get N/4 steps (maps with long tails)
uniform float uMapExtent; // warped half-extent g(E), kpc
uniform float uMapTexel;  // warped texel, kpc
uniform float uMapRc;     // radial map warp g(r) = Rc asinh(r / Rc); 0 = linear
uniform float uLutMax;    // kpc
uniform float uSlabHalf;
uniform float uCylR;
uniform vec4 uH;          // vertical scale heights: old, young, dust, HII (kpc)
uniform float uBulgeFlat;
uniform vec4 uWarp;       // amplitude, start radius, (radius - start), line-of-nodes angle
uniform vec3 uColBulge;   // colour × light share / integral
uniform vec3 uColOld;
uniform vec3 uColYoung;
uniform vec3 uColHii;
uniform vec3 uColPolar;
uniform vec3 uRedden;
uniform vec3 uPolarAxis;
uniform vec4 uPolar;      // length, base width, tan(opening), kind (0 none, 1 cones, 2 jet)
uniform float uDetail;    // fine-detail noise frequency, 1/kpc
uniform float uSeed;

vec2 pClipBox(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 a = (-uHalf - ro) * inv;
  vec3 b = (uHalf - ro) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  return vec2(max(max(lo.x, lo.y), max(lo.z, 0.0)), min(min(hi.x, hi.y), hi.z));
}

vec2 pClipSlab(vec3 ro, vec3 rd, float tEnd) {
  float t0 = 0.0;
  float t1 = tEnd;
  if (abs(rd.z) < 1e-9) {
    if (abs(ro.z) > uSlabHalf) return vec2(1.0, 0.0);
  } else {
    float a = (-uSlabHalf - ro.z) / rd.z;
    float b = (uSlabHalf - ro.z) / rd.z;
    t0 = max(t0, min(a, b));
    t1 = min(t1, max(a, b));
  }
  float A = dot(rd.xy, rd.xy);
  float B = dot(ro.xy, rd.xy);
  float C = dot(ro.xy, ro.xy) - uCylR * uCylR;
  if (A < 1e-12) {
    if (C > 0.0) return vec2(1.0, 0.0);
  } else {
    float disc = B * B - A * C;
    if (disc <= 0.0) return vec2(1.0, 0.0);
    float s = sqrt(disc);
    t0 = max(t0, (-B - s) / A);
    t1 = min(t1, (-B + s) / A);
  }
  return vec2(t0, t1);
}

float pWarp(vec2 p) {
  if (uWarp.x == 0.0) return 0.0;
  float u = max(0.0, (length(p) - uWarp.y) / max(uWarp.z, 1e-3));
  return uWarp.x * u * u * sin(atan(p.y, p.x) - uWarp.w);
}

// ∫ exp(-|z|/h)/(2h) dt over an interval with z linear from za to zb.
float pVert(float za, float zb, float dt, float h) {
  float dz = zb - za;
  if (abs(dz) < 0.05 * h) return exp(-abs(0.5 * (za + zb)) / h) / (2.0 * h) * dt;
  float ca = 0.5 * sign(za) * (1.0 - exp(-abs(za) / h));
  float cb = 0.5 * sign(zb) * (1.0 - exp(-abs(zb) / h));
  return (cb - ca) / dz * dt;
}

float pTruncMean(float d, float h) {
  float x = d / h;
  if (x < 0.1) return 0.5 - x / 12.0;
  return (h - d / (exp(min(x, 60.0)) - 1.0)) / d;
}

// Fraction along the interval of the centroid of exp(-|z|/h); `jitter` when z barely changes.
float pCentroid(float za, float zb, float h, float jitter) {
  float D = abs(zb - za);
  if (D < 0.05 * h) return jitter;
  float a = abs(za);
  float b = abs(zb);
  if (za * zb >= 0.0) {
    float m = pTruncMean(D, h);
    return a < b ? m : 1.0 - m;
  }
  float fc = za / (za - zb);
  float w1 = 1.0 - exp(-a / h);
  float w2 = 1.0 - exp(-b / h);
  float m1 = pTruncMean(a, h) * a;
  float m2 = pTruncMean(b, h) * b;
  return (w1 * (fc - m1 / D) + w2 * (fc + m2 / D)) / max(w1 + w2, 1e-12);
}

// Odd cumulative bulge line integral G(b, s) (sqrt-spaced table, texel centres).
float pLutG(float b, float s) {
  if (b >= uLutMax) return 0.0;
  float n = float(LUT_N);
  vec2 u = sqrt(vec2(b, min(abs(s), uLutMax)) / uLutMax);
  vec2 uv = (u.yx * (n - 1.0) + 0.5) / n;
  return sign(s) * textureLod(uLut, uv, 0.0).r;
}

float pIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec3 rd = normalize(vLocal - uCam);
  vec2 tb = pClipBox(uCam, rd);
  if (tb.y <= tb.x) discard;
  vec3 ro = uCam + rd * tb.x;
  float tEnd = tb.y - tb.x;
  vec2 sl = pClipSlab(ro, rd, tEnd);
  bool hasSlab = sl.y > sl.x;
  int N = max(4, uSteps);
  int nOff = uOuterSteps ? N / 4 : 1;
  int nA = hasSlab ? (sl.x > 0.0 ? nOff : 0) : N / 2;
  int nB = hasSlab ? (sl.y < tEnd ? nOff : 0) : 0;
  int nS = hasSlab ? N - nA - nB : 0;
  float jit = pIgn(gl_FragCoord.xy);
  // Bulge in the z-scaled space where it is spherical.
  vec3 rdq = vec3(rd.xy, rd.z / uBulgeFlat);
  vec3 roq = vec3(ro.xy, ro.z / uBulgeFlat);
  float kq = length(rdq);
  float tq = -dot(roq, rdq) / (kq * kq);
  float bq = length(roq + rdq * tq);
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  // Segments: 0 = before the slab, 1 = slab (dust), 2 = after it; without a slab, one segment.
  for (int seg = 0; seg < 3; seg++) {
    float t0;
    float t1;
    int n;
    bool dusty = false;
    if (!hasSlab) {
      if (seg > 0) break;
      t0 = 0.0;
      t1 = tEnd;
      n = nA;
    } else if (seg == 0) {
      t0 = 0.0;
      t1 = sl.x;
      n = nA;
    } else if (seg == 1) {
      t0 = sl.x;
      t1 = sl.y;
      n = nS;
      dusty = true;
    } else {
      t0 = sl.y;
      t1 = tEnd;
      n = nB;
    }
    if (n <= 0 || t1 <= t0) continue;
    float dt = (t1 - t0) / float(n);
    float hc = dusty ? uH.y : uH.x;
    float ga = pLutG(bq, kq * (t0 - tq));
    for (int i = 0; i < 256; i++) {
      if (i >= n) break;
      float ta = t0 + float(i) * dt;
      float tb2 = ta + dt;
      float th = ta + 0.5 * dt;
      float z0 = pWarp(ro.xy + rd.xy * th);
      float za = ro.z + rd.z * ta - z0;
      float zb = ro.z + rd.z * tb2 - z0;
      float tm = ta + pCentroid(za, zb, hc, jit) * dt;
      vec3 p = ro + rd * tm;
      float pr = length(p.xy);
      float wk = uMapRc > 0.0 && pr > 1e-6 ? uMapRc * asinh(pr / uMapRc) / pr : 1.0;
      float texel = uMapTexel * (uMapRc > 0.0 ? sqrt(1.0 + pr * pr / (uMapRc * uMapRc)) : 1.0);
      float lod = log2(max(1.0, (tb.x + tm) * uPixAngle / texel));
      vec4 m = textureLod(uMap, p.xy * wk / (2.0 * uMapExtent) + 0.5, lod);
      // Fine detail below the map resolution (mean ~1), fading out once a texel is sub-pixel.
      float fade = 1.0 - smoothstep(0.0, 1.5, lod);
      if (fade > 0.0) {
        vec3 q = vec3(p.xy, 2.0 * (p.z - z0)) * uDetail + uSeed;
        float dn = (0.65 * gnoise(q) + 0.35 * gnoise(2.7 * q + 17.0)) * fade;
        m.g *= 1.0 + 0.8 * dn;
        m.a *= max(0.0, 1.0 + 1.3 * dn);
        m.b *= max(0.0, 1.0 + 0.9 * dn);
      }
      float vy = pVert(za, zb, dt, uH.y);
      float gb = pLutG(bq, kq * (tb2 - tq));
      vec3 e = uColOld * (m.r * pVert(za, zb, dt, uH.x)) + uColYoung * (m.g * vy) +
        uColHii * (m.a * pVert(za, zb, dt, uH.w)) + uColBulge * ((gb - ga) / kq);
      ga = gb;
      if (dusty) {
        vec3 tau = uRedden * (m.b * pVert(za, zb, dt, uH.z));
        vec3 att = exp(-tau);
        vec3 f = mix(vec3(1.0), (1.0 - att) / max(tau, vec3(1e-6)), step(vec3(1e-4), tau));
        L += T * e * f;
        T *= att;
      } else {
        L += T * e;
      }
    }
  }
  // Polar feature: Gaussian tube integrated at the ray's closest approach to the axis.
  if (uPolar.w > 0.5) {
    vec3 a = uPolarAxis;
    float b = dot(rd, a);
    float d = dot(rd, ro);
    float e = dot(a, ro);
    float den = max(1.0 - b * b, 1e-8);
    float t = (b * e - d) / den;
    float s = (e - b * d) / den;
    float sa = uPolar.w < 1.5 ? abs(s) : s;
    float Lp = uPolar.x;
    if (t > 0.0 && sa >= 0.0 && sa <= Lp) {
      float w = uPolar.y + sa * uPolar.z;
      vec3 c = ro + rd * t - a * s;
      float g = uPolar.w < 1.5
        ? exp(-sa / (0.45 * Lp)) * (1.0 - smoothstep(0.7 * Lp, Lp, sa))
        : (1.0 - smoothstep(0.75 * Lp, Lp, sa)) * (0.55 + 0.45 * exp(-sa / (0.3 * Lp))) * smoothstep(0.0, 0.04 * Lp, sa);
      float v = g * exp(-dot(c, c) / (w * w)) * 1.7724538509 * w / max(sqrt(den), 1.7724538509 * w / (2.0 * Lp));
      // Filaments (cones) or knots along the jet (mean ~1).
      if (uPolar.w < 1.5) v *= max(0.0, 1.0 + 0.6 * gnoise((ro + rd * t) * (1.2 / max(w, 1e-3)) + uSeed));
      else v *= max(0.0, 1.0 + 0.8 * gnoise(vec3(sa * (14.0 / Lp), uSeed, 0.37)));
      vec3 tr = vec3(1.0);
      if (hasSlab && t > sl.y) tr = T;
      else if (hasSlab && t > sl.x) tr = sqrt(T);
      L += uColPolar * v * tr;
    }
  }
  gl_FragColor = vec4(L * uGain, 1.0);
}
#endif
