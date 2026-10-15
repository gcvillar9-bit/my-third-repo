// sun: photosphere SurfaceShading (priority 10 for 'sun'; starSurface() reuses it for other stars).
// Radiance = I0 * P(mu) * granulation, where P is the Neckel (2005) 5th-order limb-darkening
// polynomial per channel and I0 makes the disk mean equal the star's mean disk luminance (cd/m2).
// Granulation: animated Worley cells (F2 - F1 lanes) over a supergranular network, normalised to
// zero mean and unit rms (GRAN_MEAN/GRAN_STD from the CPU twin in granulation.ts), faded out once
// a pixel covers a granule so the disk mean stays exact at every distance.
// Simulated activity on top (Sun only): bipolar sunspot groups (umbrae in common filamentary penumbrae,
// one-sided penumbrae, pores), limb-brightened faculae, and an H-alpha mode (uHalpha) with dark mottles and
// fibril rosettes, filaments, plage, flares and superpenumbrae.
// Array sizes mirror activity.ts (MAX_SPOTS, MAX_REGIONS, MAX_FILAMENTS; a unit test keeps them in sync).
#define SUN_MAX_SPOTS 64
#define SUN_MAX_REGIONS 24
#define SUN_MAX_FILAMENTS 24
uniform vec3 uStarI0;       // cd/m2 per channel at disk centre (mu = 1)
uniform vec3 uLimbA[6];     // limb-darkening coefficients A_k per channel
uniform float uGranCells;   // star radius / granule size (cells per unit direction)
uniform float uSuperCells;  // star radius / supergranule size
uniform float uGranSizeM;   // granule size, m
uniform float uGranContrast;
uniform float uNetContrast;
uniform float uStarTime;    // s, wrapped to one day (the animation is exactly periodic over a day)
// Simulated activity (activity.ts; counts are 0 for other stars). Directions are body-fixed unit vectors,
// sizes in solar radii (chord length ~ angle), so float32 differences stay precise at close range.
uniform vec4 uSpot[SUN_MAX_SPOTS];   // (dir, 32 * (kind + 4 * following) + seed + umbra radius)
uniform int uSpotCount;
uniform vec4 uRegion[SUN_MAX_REGIONS];  // active regions: (centre, radius; polarities at +/-0.5 radii)
uniform vec4 uRegionB[SUN_MAX_REGIONS]; // (signed Joy tilt rad, strength 0..1, flare 0..1, seed)
uniform int uRegionCount;
uniform vec4 uFil[SUN_MAX_FILAMENTS];   // H-alpha filaments: (dir * intensity, seed 0..255 + half-length)
uniform int uFilCount;
uniform vec3 uUmbra;        // umbra intensity per channel (redder than the photosphere)
uniform float uPenumbra;    // mean penumbra intensity
uniform float uPenRatio;    // penumbra / umbra radius
uniform float uFacular;     // facular contrast at the limb
uniform float uHalpha;      // 1: narrowband H-alpha look (not physical exposure)
uniform vec3 uHaI0;         // H-alpha disk-centre radiance per channel
uniform vec2 uHaLimb;       // H-alpha limb darkening a + b mu

#define GRAN_MEAN 0.4362
#define GRAN_STD 0.3272
#define NET_MEAN 0.1997

vec3 starHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// (F1, F2) of a Worley field whose feature points orbit inside their cells with an integer number
// of cycles per day (cyclesMin + cyclesSpan * hash), so the pattern is periodic in uStarTime.
vec2 starWorley(vec3 p, float t, float cyclesMin, float cyclesSpan) {
  vec3 c = floor(p);
  vec3 f = p - c;
  float d1 = 9.0;
  float d2 = 9.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 h = starHash3(c + o);
        float cyc = floor(cyclesMin + cyclesSpan * starHash3(c + o + 17.0).x);
        vec3 jit = 0.5 + 0.38 * sin(6.2831853 * (cyc * t / 86400.0 + h + vec3(0.0, 0.33, 0.67)));
        vec3 r = o + jit - f;
        float d = dot(r, r);
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) {
          d2 = d;
        }
      }
  return sqrt(vec2(d1, d2));
}

// Raw granulation brightness: bright granule interiors, dark intergranular lanes.
float starGranuleRaw(vec2 F) {
  float lane = smoothstep(0.0, 0.3, F.y - F.x);
  return lane * (1.0 - 0.45 * F.x);
}

float sunVNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(starHash3(i).x, starHash3(i + vec3(1, 0, 0)).x, f.x),
        mix(starHash3(i + vec3(0, 1, 0)).x, starHash3(i + vec3(1, 1, 0)).x, f.x), f.y),
    mix(mix(starHash3(i + vec3(0, 0, 1)).x, starHash3(i + vec3(1, 0, 1)).x, f.x),
        mix(starHash3(i + vec3(0, 1, 1)).x, starHash3(i + vec3(1, 1, 1)).x, f.x), f.y),
    f.z);
}

// Smooth, irregular outline: harmonics 1-3 of the polar angle with per-spot amplitudes and phases (no
// petals). cs = (cos, sin) of the polar angle; A, B in -1..1. Returns about -0.6..0.6.
float spotWobble(vec2 cs, vec3 A, vec3 B) {
  vec2 c2 = vec2(cs.x * cs.x - cs.y * cs.y, 2.0 * cs.x * cs.y);
  vec2 c3 = vec2(cs.x * c2.x - cs.y * c2.y, cs.y * c2.x + cs.x * c2.y);
  return 0.5 * (A.x * cs.x + B.x * cs.y) + 0.32 * (A.y * c2.x + B.y * c2.y) + 0.18 * (A.z * c3.x + B.z * c3.y);
}

vec2 sunRot(float a) {
  return vec2(cos(a), sin(a));
}

// Penumbral filaments (white light): thin bright filaments of constant physical width on a darker
// background. Filaments sit in levels of angular sectors around the spot, one filament per sector with a
// random centre (slightly wiggly), start radius and end: level A (N sectors, PEN_SP0 apart at the umbra
// radius) starts at the umbra boundary, level B (N, half a sector over) switches in at 1-2 umbra radii and
// level C (2N, between both) beyond 2, so the width stays put while their number grows outwards (hundreds
// around a big spot) instead of widening into wedges. Each starts in a bright penumbral grain.
#define PEN_HW 2.99e-4  // half support of one filament, solar radii (0.21 Mm; FWHM ~0.25 Mm)
#define PEN_SP0 6.47e-4 // level-A spacing at the umbra radius, solar radii (0.45 Mm)

// One level: u = sector coordinate (N sectors around), r = distance from the spot centre, x = normalised
// penumbra radius (0 umbra edge, 1 outer edge), rho = r / umbra radius; st = start range (rho), en = end
// range (x). Returns (brightness 0..~1, grain coverage, outer-edge extension in x). Lines thinner than
// ~1.5 px are widened at constant area, and a level fades to its mean once it is under ~2 px per filament
// (no shimmer when zooming or as spots rotate; an unresolved penumbra keeps its mean).
vec3 penLevel(float u, float N, float r, float x, float rho, vec2 st, vec2 en, float lv, float seed,
               float aa) {
  float sp = 6.2831853 * r / N;
  float hw = max(PEN_HW, 1.2 * aa);
  float fade = smoothstep(0.3, 0.6, 1.2 * aa / sp);
  float fadeG = smoothstep(0.3, 0.6, 0.8 * aa / sp); // grains: sparser and wider than the filaments
  float pAct = clamp((rho - st.x) / (st.y - st.x), 0.0, 1.0) *
    clamp((en.y - 0.06 - x) / (en.y - en.x), 0.0, 1.0);
  float mean = 1.2 * PEN_HW / sp * 0.875 * (1.0 - 0.15 * clamp(x, 0.0, 1.0)) * pAct;
  vec3 res = vec3(0.0);
  float j0 = floor(u);
  float side = u - j0 < 0.5 ? -1.0 : 1.0;
  // The pixel's sector and the nearer neighbour (centres stay 0.2 sectors inside theirs, widths <= 0.65);
  // none once faded. Work is skipped through loop trip counts: software rasterisers run untaken branches.
  int nt = (lv < 0.5 ? fadeG : fade) < 1.0 ? 2 : 0;
  for (int t = 0; t < nt; t++) {
    float j = j0 + float(t) * side;
    vec3 h = starHash3(vec3(mod(j, N), lv * 17.0 + 3.0, seed));
    float h4 = fract(h.x * 13.7 + h.z * 5.3);
    float s0 = mix(st.x, st.y, h.y);
    float e0 = mix(en.x, en.y, h.z);
    // Cheap smooth waves (parabolic, no transcendentals): a slight wiggle and brightness along the length.
    float wv = fract(x * 0.95 + h4);
    float wl = fract(rho * 1.75 + h.y);
    float c = j + 0.5 + 0.4 * (h.x - 0.5) + 0.2 * (4.0 * wv * (1.0 - wv) - 0.5);
    float dp = abs(u - c) * sp;
    float a = (rho - s0 - 0.04) / 0.05;
    float head = clamp(1.0 - 0.25 * a * a, 0.0, 1.0);
    head *= head;
    head *= head; // ~exp(-a^2)
    float w = min(hw * (1.0 + 0.6 * head), 0.65 * sp);
    float prof = 1.0 - smoothstep(0.2 * w, w, dp);
    float on = smoothstep(s0 - 0.02, s0 + 0.03, rho);
    float along = on * (1.0 - smoothstep(e0 - 0.12, e0, x));
    float amp = (0.75 + 0.25 * h4) * (1.0 - 0.15 * clamp(x, 0.0, 1.0)) *
      (1.0 + 0.3 * (4.0 * wl * (1.0 - wl) - 0.667));
    float pa = prof * along * PEN_HW / hw;
    res.x += pa * mix(amp, 1.0, head);
    if (lv < 0.5) {
      // Grain: a rounded blob about 0.4 Mm wide around the head (area-conserving below ~1.5 px).
      float wg = min(max(PEN_HW, 0.8 * aa), 0.65 * sp);
      res.y = max(res.y, (1.0 - smoothstep(0.3 * wg, wg, dp)) * head * on * min(1.0, PEN_HW / wg));
    }
    // Fingers into the granulation (the filament with its dark surroundings), near the outer edge only.
    if (x > 0.75) res.z = max(res.z, (1.0 - smoothstep(0.4 * sp, 0.7 * sp, dp)) * on * max(e0 - 1.0, 0.0));
  }
  return vec3(mix(res.x, mean, fade), res.y * (1.0 - fadeG), res.z * (1.0 - fade));
}

// Bundles of filaments: 2D value noise periodic over M cells around the spot (ub) by the radial z.
float penBundles(float ub, float M, float z, float seed) {
  vec2 i = floor(vec2(ub, z));
  vec2 f = vec2(ub, z) - i;
  f = f * f * (3.0 - 2.0 * f);
  float i0 = mod(i.x, M);
  float i1 = mod(i.x + 1.0, M);
  float a = mix(starHash3(vec3(i0, i.y, seed)).x, starHash3(vec3(i1, i.y, seed)).x, f.x);
  float b = mix(starHash3(vec3(i0, i.y + 1.0, seed)).x, starHash3(vec3(i1, i.y + 1.0, seed)).x, f.x);
  return mix(a, b, f.y);
}

// Penumbra of one spot at this pixel: (filament brightness 0..1, grain coverage, outer-edge extension in
// penumbra widths: filaments running on into the granulation and brighter bundles reaching further).
// g = (umbra radius Ri, outer radius Ro, r, base umbra radius ru), h = (cos, sin of the polar angle,
// seed k (-1 - k: an embedded umbra, no grains), twist). Zero outside the deepest grains and longest fingers.
vec3 penField(vec4 g, vec4 h, float aa) {
  float r = g.z;
  float x = clamp((r - g.x) / (g.y - g.x), -0.3, 1.3);
  float rho = r / g.w;
  // Levels A (heads at the umbra edge, some intruding into it as grains), B and C (further out); none
  // outside the deepest grains and the longest fingers, where the field is exactly zero.
  int nl = rho <= g.x / g.w - 0.1 || x >= 1.25 ? 0 : (rho > 1.97 ? 3 : (rho > 0.97 ? 2 : 1));
  vec3 res = vec3(0.0);
  for (int once = 0; once < min(nl, 1); once++) {
    float k = h.z < 0.0 ? -1.0 - h.z : h.z;
    float xc = clamp(x, 0.0, 1.0);
    // Slightly curved filaments: the polar angle twists a little with the radius.
    float beta = 0.1 * h.w * xc + 0.015 * sin(xc * 4.0 + k);
    vec2 ct = vec2(h.x * cos(beta) - h.y * sin(beta), h.x * sin(beta) + h.y * cos(beta));
    float N = max(12.0, floor(6.2831853 * g.w / PEN_SP0));
    float uA = atan(ct.y, ct.x) * N / 6.2831853;
    vec3 fl = vec3(0.0);
    for (int l = 0; l < nl; l++) {
      vec2 st = l == 0 ? g.x / g.w + vec2(-0.07, 0.12) : (l == 1 ? vec2(1.0, 2.0) : vec2(2.0, 4.0));
      vec2 en = l == 0 ? vec2(0.85, 1.1) : (l == 1 ? vec2(0.88, 1.1) : vec2(0.9, 1.1));
      float ul = l == 0 ? uA : (l == 1 ? uA + 0.5 : 2.0 * uA);
      vec3 fb = penLevel(ul, l == 2 ? 2.0 * N : N, r, x, rho, st, en, float(l), k, aa);
      fl = vec3(fl.x + fb.x, max(fl.y, fb.y), max(fl.z, fb.z));
    }
    // Bundles: brighter and darker groups of filaments a few sectors wide, changing along the radius.
    float M = max(4.0, floor(N / 3.0));
    float bun = (penBundles(uA * M / N, M, xc * 1.6, k + 101.0) - 0.5) *
      (1.0 - smoothstep(0.2, 0.5, aa * M / (6.2831853 * r))) * (1.0 - smoothstep(1.1, 1.25, x));
    res = vec3(min(fl.x * (1.0 + 0.6 * bun), 1.0), h.z < 0.0 ? 0.0 : fl.y,
               fl.z * smoothstep(0.75, 0.85, x) + 0.1 * bun);
  }
  return res;
}

// Spot k's outline coefficients (stable per spot: the seed rides in the integer part of uSpot.w).
void spotSeed(float k, out vec3 A, out vec3 B) {
  A = starHash3(vec3(k, 1.7, 3.1)) * 2.0 - 1.0;
  B = starHash3(vec3(k, 9.2, 5.3)) * 2.0 - 1.0;
}

// Pore intensity: between the umbra and the photosphere, less red than an umbra.
vec3 sunPoreI(float scale) {
  float y = dot(uUmbra, vec3(0.2126, 0.7152, 0.0722));
  return min(mix(vec3(y), uUmbra, 0.35) * scale, vec3(0.9));
}

// Spot kinds: the integer part of uSpot.w is 32 * (kind + 4 * following) + seed (activity.ts packSpotW).
#define SPOT_PORE 0.0
#define SPOT_EMBEDDED 1.0
#define SPOT_PARTIAL 2.0
#define SPOT_FULL 3.0
// Penumbra / umbra radius of an umbra embedded in a bigger spot's penumbra (merged into it).
#define SPOT_EMBED_RATIO 1.35
// Most spots one pixel can be near (a following cluster has up to ~7; activity.ts groupSpots).
#define SPOT_CANDIDATES 8

// Sunspots and pores: rgb = intensity multiplier, a = coverage (granulation is suppressed under it),
// umb = umbra coverage. aa = pixel footprint, radians. The spots are merged with a smooth union of their
// normalised penumbra distances s = (r - Ri) / (Ro - Ri), so neighbouring umbrae share one irregular common
// penumbra (no circle seams) whose filaments come from the nearest umbra. Spots below a pixel fade to their
// area.
vec4 sunSpots(vec3 d, float aa, out float umb) {
  float esum = 0.0;   // sum of exp(-6 s): smooth minimum of the normalised distances
  float s1 = 9.0;     // best two normalised distances; the nearest one's penField arguments
  float s2 = 9.0;
  vec4 G1 = vec4(0.0, 1.0, 9.0, 1.0); // (Ri, Ro, r, ru): far outside until a spot is found
  vec4 H1 = vec4(0.0);
  float um = 0.0;
  vec3 umI = uUmbra;
  float poreP = 0.0;
  vec3 poreI = vec3(1.0);
  float aa2 = max(aa * aa, 1e-30);
  // Pass 1 (cheap, every pixel, all packed spots): the spots whose reach covers this pixel. Pass 2 shades
  // only those, so the costly body runs as often as the most crowded pixel of a SIMD group needs, not once
  // per packed spot (software rasterisers and divergent GPUs execute masked bodies).
  int cand[SPOT_CANDIDATES];
  int nc = 0;
  for (int i = 0; i < SUN_MAX_SPOTS; i++) {
    if (i >= uSpotCount || nc >= SPOT_CANDIDATES) break;
    vec4 sp = uSpot[i];
    float code = floor(sp.w / 32.0);
    float kind = mod(code, 4.0);
    float reach = kind < SPOT_EMBEDDED - 0.5 ? 1.3 : (kind < SPOT_PARTIAL - 0.5 ? 1.45 * SPOT_EMBED_RATIO :
      1.6 * uPenRatio * (code > 4.0 + SPOT_FULL - 0.5 ? 1.4 : 1.0));
    float edge = fract(sp.w) * reach + aa;
    vec3 dv = d - sp.xyz;
    if (dot(dv, dv) <= edge * edge) {
      cand[nc] = i;
      nc++;
    }
  }
  for (int j = 0; j < SPOT_CANDIDATES; j++) {
    if (j >= nc) break;
    vec4 sp = uSpot[cand[j]];
    float ru = fract(sp.w);
    vec3 dv = d - sp.xyz;
    float k = sp.w - ru;
    float code = floor(k / 32.0);
    float kind = mod(code, 4.0);
    bool pore = kind < SPOT_EMBEDDED - 0.5;
    bool embedded = !pore && kind < SPOT_PARTIAL - 0.5;
    bool partial = kind > SPOT_PARTIAL - 0.5 && kind < SPOT_FULL - 0.5;
    // Following spots with a full penumbra are elongated along the (roughly east-west) group axis.
    float stretch = code > 4.0 + SPOT_FULL - 0.5 ? 1.4 : 1.0;
    vec3 A;
    vec3 B;
    spotSeed(k, A, B);
    vec3 e1 = normalize(cross(vec3(0.0, 0.0, 1.0), sp.xyz));
    vec3 e2 = cross(sp.xyz, e1);
    vec2 lp = vec2(dot(dv, e1), dot(dv, e2));
    if (stretch > 1.0) lp.x /= 1.0 + 0.4 * abs(A.z);
    float r = length(lp);
    vec2 cs = lp / max(r, 1e-9);
    if (pore) {
      float R = ru * (1.0 + 0.25 * spotWobble(cs, A, B));
      float p = (1.0 - smoothstep(0.4 * R - aa, R + aa, r)) * min(1.0, R * R / aa2);
      if (p > poreP) {
        poreP = p;
        poreI = sunPoreI(mix(3.0, 1.9, smoothstep(0.0008, 0.0023, ru)));
      }
      continue;
    }
    float rp = ru * (embedded ? SPOT_EMBED_RATIO : uPenRatio * (1.0 + 0.1 * A.x));
    float Ri = ru * (1.0 + 0.2 * spotWobble(cs, B.zxy, A.yzx)); // umbra boundary
    // Outer penumbra boundary: irregular (low harmonics plus a little noise, which cannot matter beyond
    // 1.5 penumbra radii, where the coverage is 0).
    float rn = 0.5;
    for (int ni = 0; ni < (r < 1.5 * rp + 3.0 * aa ? 1 : 0); ni++) rn = sunVNoise(vec3(cs * 7.0, k));
    float Ro = rp * (1.0 + 0.30 * spotWobble(cs, A, B) + 0.06 * (rn - 0.5));
    for (int pi = 0; pi < (partial ? 1 : 0); pi++) {
      // One-sided penumbra: a sector of 120-200 deg.
      float c = cos(1.05 + 0.7 * fract(A.y * 7.3));
      float sec = smoothstep(c - 0.25, c + 0.25, dot(cs, sunRot(6.2831853 * fract(B.x * 5.1))));
      Ro = mix(Ri, Ro, sec);
    }
    Ro = max(Ro, 1.02 * Ri);
    // The filaments are shaded once after this loop, for the nearest penumbra only.
    float s = (r - Ri) / (Ro - Ri);
    esum += exp(-6.0 * max(s, -4.0));
    vec4 G = vec4(Ri, Ro, r, ru);
    vec4 H = vec4(cs, embedded ? -1.0 - k : k, B.x);
    if (s < s1) {
      s2 = s1;
      s1 = s;
      G1 = G;
      H1 = H;
    } else {
      s2 = min(s2, s);
    }
    // Umbra (max over spots): near black, darker core, lighter in small spots; umbral dots once resolved;
    // a granular light bridge across some big umbrae.
    float u = 1.0 - smoothstep(Ri * 0.96 - aa, Ri * 1.03 + aa, r);
    // (Trip-count guards: software rasterisers execute untaken if-blocks, but skip loops nobody enters.)
    for (int bi = 0; bi < (ru > 0.008 && fract(A.z * 13.7) > 0.35 && u > 0.0 ? 1 : 0); bi++) {
      // Granular, slightly curved, of varying width, across the umbra from one side of the penumbra.
      vec2 bd = sunRot(B.y * 3.1415927);
      float along = dot(lp, vec2(-bd.y, bd.x)) / Ri;
      float lb = abs(dot(lp, bd) + Ri * (0.2 * B.z + 0.12 * sin(along * 2.6 + k)));
      float bw = Ri * (0.1 + 0.08 * sunVNoise(vec3(along * 3.0, k, 1.0)));
      float bridge = 1.0 - smoothstep(0.5 * bw, bw + aa, lb);
      u *= 1.0 - 0.8 * bridge * (0.55 + 0.45 * sunVNoise(vec3(lp / 0.0012, k + 3.0)));
    }
    u *= min(1.0, Ri * Ri / aa2);
    for (int di = 0; di < (u > um ? 1 : 0); di++) {
      um = u;
      float core = smoothstep(0.0, 0.9, r / Ri);
      umI = uUmbra * mix(1.3, 1.0, smoothstep(0.003, 0.012, ru)) * mix(0.40, 0.90, core);
      float dots = smoothstep(0.72, 0.86, sunVNoise(vec3(lp / 0.0005, k)));
      umI *= 1.0 + 0.8 * dots * (1.0 - smoothstep(0.3, 1.0, aa / 0.0005));
    }
  }
  vec3 mul = vec3(1.0);
  float pen = 0.0;
  if (esum > 0.0) {
    // Filaments of the nearest penumbra. Where two penumbrae meet, their filaments converge on a narrow soft
    // seam (no circle seams; shading only the nearest keeps the per-pixel cost of the old filaments).
    vec3 F1 = penField(G1, H1, aa);
    float f = mix(F1.x, 0.35, 0.5 * (1.0 - smoothstep(0.0, 0.06, s2 - s1)));
    // Its ragged outer edge replaces its smooth one in the union.
    float sr = s1 / (1.0 + F1.z);
    esum += exp(-6.0 * max(sr, -4.0)) - exp(-6.0 * max(s1, -4.0));
    float sU = -log(max(esum, 1e-30)) / 6.0;
    float span = (G1.y - G1.x) * (1.0 + F1.z);
    float rp1 = G1.w * (H1.z < 0.0 ? SPOT_EMBED_RATIO : uPenRatio);
    pen = (1.0 - smoothstep(1.0 - 0.035 * rp1 / span, 1.0 + aa / span, sU)) * min(1.0, G1.y * G1.y / aa2);
    // Bright penumbral grains at its inner filament heads cut into its umbra.
    um *= 1.0 - F1.y;
    // Dark lanes 0.66 and the brightest filaments and grains 1.42 of the mean penumbra (uPenumbra).
    float penI = uPenumbra * (0.66 + 0.76 * f);
    pen = max(pen, um);
    mul = mix(vec3(1.0), mix(vec3(penI), umI, um), pen);
  }
  mul = min(mul, mix(vec3(1.0), poreI, poreP));
  umb = um;
  return vec4(mul, max(pen, poreP));
}

// Active-region mask (max over regions of a soft disc times its strength); idx returns the region.
float sunRegionMask(vec3 d, out int idx) {
  float f = 0.0;
  idx = -1;
  for (int i = 0; i < SUN_MAX_REGIONS; i++) {
    if (i >= uRegionCount) break;
    vec4 r = uRegion[i];
    vec3 dv = d - r.xyz;
    float d2 = dot(dv, dv);
    if (d2 > r.w * r.w) continue;
    float v = (1.0 - smoothstep(0.3, 1.0, sqrt(d2) / r.w)) * uRegionB[i].y;
    if (v > f) {
      f = v;
      idx = i;
    }
  }
  return f;
}

// Region i's frame: q = (along the Joy-tilted axis towards the leading polarity, across), in radii.
vec2 sunRegionLocal(vec3 d, int i) {
  vec4 r = uRegion[i];
  float t = uRegionB[i].x;
  vec3 e = normalize(cross(vec3(0.0, 0.0, 1.0), r.xyz));
  vec3 n = cross(r.xyz, e);
  vec3 ax = cos(t) * e - sin(t) * n;
  vec3 dv = d - r.xyz;
  return vec2(dot(dv, ax), dot(dv, cross(r.xyz, ax)));
}

// Pores (irregular umbra-like specks, ~2-4 Mm across) clustered around the two polarity centres of region i
// (+/-POLE_U = 0.5 region radii along the axis), mostly in the more fragmented following polarity, a few in
// the plage between them. Cells of ~3.5 Mm in the region's own frame, so pores stay put while the group
// spreads; their number follows the region's strength. Faded to their area below a pixel.
float sunPores(vec2 q, int i, float aa) {
  vec4 R = uRegion[i];
  vec4 B = uRegionB[i];
  const float CELL = 0.005;
  vec2 c = floor(q / CELL);
  float best = 0.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 o = c + vec2(float(x), float(y));
      vec3 h = starHash3(vec3(o, B.w * 97.0));
      vec2 pc = (o + 0.2 + 0.6 * h.xy) * CELL;
      vec2 un = pc / R.w;
      vec2 a = vec2((un.x - 0.5) / 0.11, un.y / 0.09);  // leading polarity
      vec2 b = vec2((un.x + 0.48) / 0.18, un.y / 0.13); // following polarity
      float plage = 1.0 - smoothstep(0.15, 0.3, dot(un, un));
      float dens = B.y * (0.2 * exp(-dot(a, a)) + 0.35 * exp(-dot(b, b)) + 0.012 * plage);
      if (h.z > dens) continue;
      float pr = CELL * (0.25 + 0.3 * fract(h.x * 31.0 + h.y * 17.0));
      vec2 dq = q - pc;
      float rr = length(dq);
      vec3 sa = starHash3(vec3(o, B.w * 53.0 + 7.0)) * 2.0 - 1.0;
      float pw = pr * (1.0 + 0.25 * spotWobble(dq / max(rr, 1e-9), sa, sa.zxy));
      float p = 1.0 - smoothstep(0.35 * pw - aa, pw + aa, rr);
      best = max(best, p * min(1.0, pr * pr / max(aa * aa, 1e-30)));
    }
  return best;
}

// Patchy small-scale magnetic brightening (faculae / plage), mean ~0.35, faded to it below a pixel.
float sunPatches(vec3 d, float aa) {
  float n = 0.6 * sunVNoise(d * 170.0) + 0.4 * sunVNoise(d * 420.0);
  float v = smoothstep(0.42, 0.72, n);
  return mix(v, 0.35, smoothstep(0.3, 1.0, aa * 170.0));
}

// Spots, pores and faculae of the white-light photosphere: rgb = intensity multiplier, a = coverage.
vec4 sunActivity(vec3 d, float aa, float mu) {
  float umb;
  vec4 sp = uSpotCount > 0 ? sunSpots(d, aa, umb) : vec4(1.0, 1.0, 1.0, 0.0);
  if (uRegionCount > 0) {
    int idx;
    float reg = sunRegionMask(d, idx);
    if (idx >= 0) {
      float po = sunPores(sunRegionLocal(d, idx), idx, aa) * (1.0 - sp.a);
      vec3 pI = sunPoreI(2.0);
      sp.rgb = min(sp.rgb, mix(vec3(1.0), pI, po));
      sp.a = max(sp.a, po);
      // Faculae: limb-brightened network around the region (white light shows them near the limb only).
      sp.rgb *= 1.0 + (1.0 - sp.a) * uFacular * pow(1.0 - mu, 1.5) * reg * sunPatches(d, aa) * 2.0;
    }
  }
  return sp;
}

// On-disk H-alpha filaments (the quiescent prominences seen from above): long sinuous fuzzy ribbons with a
// ragged width, patchy darkness and gaps along their length, and short barbs to one side; faded to their
// area mean below a pixel.
float sunFilaments(vec3 d, float aa) {
  float dark = 0.0;
  for (int i = 0; i < SUN_MAX_FILAMENTS; i++) {
    if (i >= uFilCount) break;
    vec4 F = uFil[i];
    float k = floor(F.w);
    float L = F.w - k;
    float inten = length(F.xyz);
    vec3 A = F.xyz / inten;
    vec3 dv = d - A;
    if (dot(dv, dv) > 1.3 * L * L) continue;
    vec3 h = starHash3(vec3(k, 3.7, 11.0));
    vec3 e = normalize(cross(vec3(0.0, 0.0, 1.0), A));
    vec3 n = cross(A, e);
    float ang = (fract(k * 0.618034) - 0.5) * 1.4; // mostly east-west, up to ~40 deg (activity.ts twin)
    vec3 ax = cos(ang) * e + sin(ang) * n;
    float u = dot(dv, ax) / L;
    if (abs(u) > 1.0) continue;
    float s1 = h.y * 40.0;
    float off = dot(dv, cross(A, ax)) -
      L * (0.08 * sin(u * 3.3 + s1) + 0.05 * sin(u * 7.9 + 1.7 * s1) + 0.05 * (sunVNoise(vec3(u * 5.0, s1, 1.0)) - 0.5));
    float w = max(L * (0.03 + 0.03 * h.z), 0.005) * sqrt(max(1.0 - u * u, 0.0)) *
      (0.45 + 0.9 * sunVNoise(vec3(u * 11.0, s1, 3.0)));
    float barb = smoothstep(0.68, 0.88, sunVNoise(vec3(u * 19.0, s1, 5.0)));
    w *= 1.0 + 1.6 * barb * step(0.0, off * (h.z - 0.5));
    float core = 1.0 - smoothstep(0.2 * w, 1.4 * w + aa, abs(off));
    float patchy = 0.5 + 0.5 * smoothstep(0.25, 0.6, sunVNoise(vec3(u * 6.0, s1, 9.0)));
    dark = max(dark, core * patchy * min(inten, 1.0) * min(1.0, w / max(aa, 1e-9)));
  }
  return dark;
}

// H-alpha in region i (q in radii, region frame): two-ribbon flare and the active-region filament along
// the polarity inversion line (absent while it erupts).
vec2 sunRegionHa(vec2 q, int i, float aa) {
  vec4 r = uRegion[i];
  vec4 b = uRegionB[i];
  float u = q.x / r.w;
  float v = q.y / r.w - 0.05 * sin(q.x / r.w * 11.0 + b.w * 40.0) - 0.025 * sin(q.x / r.w * 23.0 + b.w * 17.0);
  float t = (abs(v) - 0.09) / 0.025;
  float flare = b.z * exp(-t * t) * (1.0 - smoothstep(0.2, 0.42, abs(u)));
  float hw = 0.02;
  float fil = step(0.3, fract(b.w * 7.13)) * b.y * (1.0 - min(b.z * 2.0, 1.0)) *
    (1.0 - smoothstep(0.5 * hw, hw + aa / r.w, abs(v))) * (1.0 - smoothstep(0.2, 0.38, abs(u))) *
    min(1.0, hw * r.w / max(aa, 1e-9));
  return vec2(flare, fil);
}

// Superpenumbra (H-alpha): dark fibrils radiating from each penumbra out to ~2.6 penumbra radii, curling
// with the hemisphere's chirality and fading into the plage. It starts inside the penumbra, so the spot
// darkens continuously outward instead of standing in a lighter ring. Returns the darkening 0..0.3.
float sunSuperPenumbra(vec3 d, float aa) {
  float dark = 0.0;
  for (int i = 0; i < SUN_MAX_SPOTS; i++) {
    if (i >= uSpotCount) break;
    vec4 sp = uSpot[i];
    float ru = fract(sp.w);
    vec3 dv = d - sp.xyz;
    float d2 = dot(dv, dv);
    float reach = 2.7 * ru * uPenRatio + aa;
    if (d2 > reach * reach) continue;
    float k = sp.w - ru;
    float kind = mod(floor(k / 32.0), 4.0);
    if (kind < SPOT_PARTIAL - 0.5) continue; // pores and embedded umbrae
    float Ro = ru * uPenRatio * (kind > SPOT_FULL - 0.5 ? 1.0 : 0.8);
    vec3 e1 = normalize(cross(vec3(0.0, 0.0, 1.0), sp.xyz));
    vec3 e2 = cross(sp.xyz, e1);
    vec2 lp = vec2(dot(dv, e1), dot(dv, e2));
    float r = length(lp);
    float x = (r - Ro) / (1.6 * Ro);
    float beta = 0.5 * sign(sp.z) * x; // opposite twist in the two hemispheres
    vec2 cs = lp / max(r, 1e-9);
    vec2 ct = vec2(cs.x * cos(beta) - cs.y * sin(beta), cs.x * sin(beta) + cs.y * cos(beta));
    float kk = max(14.0, 6.2831853 * Ro * 696.0 / 4.0) / 6.2831853; // fibrils ~4 Mm apart at the edge
    float v = smoothstep(0.45, 0.75, sunVNoise(vec3(ct * kk, x * 1.2 + k)));
    v = mix(0.45, v, 1.0 - smoothstep(0.3, 0.8, aa / max(r, 1e-9) * kk));
    dark = max(dark, 0.3 * (1.0 - smoothstep(Ro, 2.6 * Ro, r)) * (0.5 + 0.5 * v));
  }
  return dark;
}

// (F1, F2) of the supergranular field, exactly starWorley(p, t, 1.0, 1.0), plus the vectors from p to the
// two nearest feature points (cell units) and a hash of each cell.
vec2 sunWorleyR(vec3 p, float t, out vec3 r1, out vec3 r2, out float h1, out float h2) {
  vec3 c = floor(p);
  vec3 f = p - c;
  float d1 = 9.0;
  float d2 = 9.0;
  r1 = vec3(0.0);
  r2 = vec3(0.0);
  h1 = 0.0;
  h2 = 0.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 h = starHash3(c + o);
        float cyc = floor(1.0 + starHash3(c + o + 17.0).x);
        vec3 jit = 0.5 + 0.38 * sin(6.2831853 * (cyc * t / 86400.0 + h + vec3(0.0, 0.33, 0.67)));
        vec3 r = o + jit - f;
        float d = dot(r, r);
        if (d < d1) {
          d2 = d1;
          r2 = r1;
          h2 = h1;
          d1 = d;
          r1 = r;
          h1 = h.z;
        } else if (d < d2) {
          d2 = d;
          r2 = r;
          h2 = h.z;
        }
      }
  return sqrt(vec2(d1, d2));
}

// Fibrils radiating from a supergranule's centre (r: pixel -> its feature point, cell units; e1, e2 the
// local tangent frame): value noise on circles around the centre, stretched radially (~36 around a cell).
float sunRosette(vec3 r, vec3 e1, vec3 e2, float h, vec2 toff) {
  vec2 t = vec2(dot(r, e1), dot(r, e2));
  float l = length(t);
  vec3 q = vec3(t / max(l, 1e-6) * 5.7 + toff, l * 1.6 + h * 61.0);
  return 0.65 * sunVNoise(q) + 0.35 * sunVNoise(q * vec3(2.1, 2.1, 1.3) + 4.0);
}

// Narrowband H-alpha look: deep red-orange disk, a mottled chromosphere (dark mottles and fibril rosettes
// along the supergranule borders, sparse bright points, low-contrast cell interiors), dark filaments, bright
// plage with flare ribbons around active regions, dark spots with superpenumbral fibrils.
vec3 sunHalpha(SurfaceInput s, float mu, float aa, float sw) {
  vec3 d = s.dirBody;
  float m = 1.0;
  // Slow evolution, exactly periodic over a day: 6 turns a day around a circle in noise space.
  float ta = 6.2831853 * 6.0 * uStarTime / 86400.0;
  vec2 toff = 3.8 * vec2(cos(ta), sin(ta));
  if (sw > 0.0) {
    vec3 r1;
    vec3 r2;
    float h1;
    float h2;
    vec2 S = sunWorleyR(d * uSuperCells, uStarTime, r1, r2, h1, h2);
    float gap = S.y - S.x;
    float rim = 1.0 - smoothstep(0.0, 0.3, gap);
    float mot = smoothstep(0.5, 0.8, sunVNoise(d * uSuperCells * 9.0 + vec3(toff, 0.0)));
    m -= sw * 0.22 * rim * mot;
    float pts = smoothstep(0.62, 0.85, sunVNoise(d * uSuperCells * 7.0 + 5.0));
    m += sw * 0.12 * (1.0 - smoothstep(0.0, 0.1, gap)) * pts;
    // Rosettes: fibrils from the two nearest cell centres, cross-faded so nothing jumps at a border.
    float ff = sw * (1.0 - smoothstep(0.3, 0.8, aa * uSuperCells * 11.5));
    if (ff > 0.0) {
      vec3 e1 = normalize(cross(vec3(0.0, 0.0, 1.0), d) + vec3(1e-6, 0.0, 0.0));
      vec3 e2 = cross(d, e1);
      float w1 = 0.5 + 0.5 * smoothstep(0.0, 0.25, gap);
      float fib = w1 * sunRosette(r1, e1, e2, h1, toff) + (1.0 - w1) * sunRosette(r2, e1, e2, h2, toff);
      m -= ff * 0.22 * (1.0 - smoothstep(0.05, 0.45, gap)) * smoothstep(0.5, 0.78, fib);
    }
  }
  float mott = 0.6 * sunVNoise(d * 90.0) + 0.4 * sunVNoise(d * 230.0);
  m += 0.1 * (mott - 0.5) * (1.0 - smoothstep(0.3, 1.0, aa * 230.0));
  if (uFilCount > 0) m *= 1.0 - 0.5 * sunFilaments(d, aa);
  if (uSpotCount > 0) m *= 1.0 - sunSuperPenumbra(d, aa);
  if (uRegionCount > 0) {
    int idx;
    float reg = sunRegionMask(d, idx);
    if (idx >= 0) {
      vec2 q = sunRegionLocal(d, idx);
      vec2 ha = sunRegionHa(q, idx, aa);
      // Plage: bright, patchy, spread over the whole region (brightest around the spots).
      float plage = smoothstep(0.0, 0.5, reg) * (0.35 + sunPatches(d, aa));
      m *= 1.0 + plage;
      m *= 1.0 - 0.6 * ha.y;
      m += 2.5 * ha.x;
      m *= 1.0 - 0.5 * sunPores(q, idx, aa);
    }
  }
  if (uSpotCount > 0) {
    // Penumbra about 0.7 and umbra about 0.35 of the surroundings.
    float umb;
    vec4 sp = sunSpots(d, aa, umb);
    m *= (1.0 - 0.3 * sp.a) * (1.0 - 0.5 * umb);
  }
  return uHaI0 * (uHaLimb.x + uHaLimb.y * mu) * max(m, 0.0);
}

vec3 shadeSurface(SurfaceInput s) {
  float mu = clamp(dot(s.normal, s.viewDir), 0.0, 1.0);
  vec3 P = uLimbA[0] + mu * (uLimbA[1] + mu * (uLimbA[2] + mu * (uLimbA[3] + mu * (uLimbA[4] + mu * uLimbA[5]))));
  vec3 I = max(P, vec3(0.0)) * uStarI0;
  // Footprint of one pixel in granule units (foreshortened towards the limb).
  float fp = s.pixelSize / max(mu, 0.08) / uGranSizeM;
  float gw = 1.0 - smoothstep(0.35, 1.0, fp);
  float sw = 1.0 - smoothstep(0.35, 1.0, fp * uSuperCells / uGranCells);
  float aa = s.pixelSize / (max(mu, 0.08) * uGranCells * uGranSizeM); // pixel footprint, radians
  if (uHalpha > 0.5) return sunHalpha(s, mu, aa, sw);
  // Activity first: the granulation and network are skipped where a spot covers the pixel fully.
  vec4 sp = vec4(1.0, 1.0, 1.0, 0.0);
  if (uSpotCount > 0 || uRegionCount > 0) sp = sunActivity(s.dirBody, aa, mu);
  float m = 1.0;
  if (sp.a < 0.999) {
    if (gw > 0.0) {
      float g = (starGranuleRaw(starWorley(s.dirBody * uGranCells, uStarTime, 110.0, 70.0)) - GRAN_MEAN) / GRAN_STD;
      m += gw * uGranContrast * g;
    }
    if (sw > 0.0) {
      vec2 S = starWorley(s.dirBody * uSuperCells, uStarTime, 1.0, 1.0);
      float net = 1.0 - smoothstep(0.0, 0.12, S.y - S.x); // bright network on supergranule borders
      m += sw * uNetContrast * (net - NET_MEAN) / NET_MEAN * 0.25;
    }
  }
  return I * sp.rgb * mix(m, 1.0, sp.a);
}
