// sun: photosphere SurfaceShading (priority 10 for 'sun'; starSurface() reuses it for other stars).
// Radiance = I0 * P(mu) * granulation, where P is the Neckel (2005) 5th-order limb-darkening
// polynomial per channel and I0 makes the disk mean equal the star's mean disk luminance (cd/m2).
// Granulation: animated Worley cells (F2 - F1 lanes) over a supergranular network, normalised to
// zero mean and unit rms (GRAN_MEAN/GRAN_STD from the CPU twin in granulation.ts), faded out once
// a pixel covers a granule so the disk mean stays exact at every distance.
// Simulated activity on top (Sun only): bipolar sunspot groups (umbrae, filamentary penumbrae, pores),
// limb-brightened faculae, and an H-alpha mode (uHalpha) with network, fibrils, filaments, plage and flares.
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
uniform vec4 uSpot[64];     // (dir, umbra radius; negative: a pore without penumbra)
uniform int uSpotCount;
uniform vec4 uRegion[24];   // active regions: (centre, radius; the polarities sit at +/-0.5 radii)
uniform vec4 uRegionB[24];  // (signed Joy tilt rad, strength 0..1, flare 0..1, seed)
uniform int uRegionCount;
uniform vec4 uFil[24];      // H-alpha filaments: (dir * intensity, seed 0..255 + half-length in radii)
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

// Penumbral filaments: value noise on circles of the polar angle (n bundles around at the first octave,
// then 2.13x finer each), stretched along the radial coordinate x so they are long and thin, and
// contrast-shaped into bright/dark alternation. Octaves fade once a pixel spans one and the rest are
// renormalised with the finer ones weighted up, so the penumbra always shows the finest resolvable
// filaments at a steady contrast (about -0.5..0.5).
float penumbraFilaments(vec2 cs, float x, float n, float seed, float aaAng) {
  float sum = 0.0;
  float wsum = 0.0;
  float k = n / 6.2831853;
  float amp = 0.5;
  for (int o = 0; o < 4; o++) {
    float fo = float(o);
    float w = amp * (1.0 - smoothstep(0.5, 1.05, aaAng * k));
    if (w <= 0.0) break;
    float v = sunVNoise(vec3(cs * k, x * (1.3 + 0.9 * fo) + seed + 7.1 * fo));
    sum += w * (smoothstep(0.25, 0.8, v) - 0.5);
    wsum += w;
    k *= 2.13;
    amp *= 1.35;
  }
  return sum / max(wsum, 0.5);
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

// Sunspots and pores: rgb = intensity multiplier, a = coverage (granulation is suppressed under it).
// aa = pixel footprint, radians.
vec4 sunSpots(vec3 d, float aa) {
  vec3 mul = vec3(1.0);
  float cover = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= uSpotCount) break;
    vec4 sp = uSpot[i];
    float w = abs(sp.w);
    float k = floor(w);
    float ru = w - k;
    bool pore = sp.w < 0.0;
    vec3 A;
    vec3 B;
    spotSeed(k, A, B);
    float rp = pore ? ru : ru * uPenRatio * (1.0 + 0.1 * A.x);
    vec3 dv = d - sp.xyz;
    float d2 = dot(dv, dv);
    float edge = 1.3 * rp + aa;
    if (ru <= 0.0 || d2 > edge * edge) continue;
    float r = sqrt(d2);
    vec3 e1 = normalize(cross(vec3(0.0, 0.0, 1.0), sp.xyz));
    vec3 e2 = cross(sp.xyz, e1);
    vec2 lp = vec2(dot(dv, e1), dot(dv, e2));
    vec2 cs = lp / max(r, 1e-9);
    if (pore) {
      float R = ru * (1.0 + 0.25 * spotWobble(cs, A, B));
      float p = 1.0 - smoothstep(0.4 * R - aa, R + aa, r);
      vec3 pI = sunPoreI(mix(3.0, 1.9, smoothstep(0.0008, 0.0023, ru)));
      mul = min(mul, mix(vec3(1.0), pI, p));
      cover = max(cover, p);
      continue;
    }
    float Ro = rp * (1.0 + 0.24 * spotWobble(cs, A, B));            // outer penumbra boundary
    float Ri = ru * (1.0 + 0.2 * spotWobble(cs, B.zxy, A.yzx));      // umbra boundary
    float x = clamp((r - Ri) / max(Ro - Ri, 1e-7), 0.0, 1.0);
    // Slightly curved filaments: the polar angle twists a little with the radius.
    float beta = 0.1 * B.x * x + 0.015 * sin(x * 4.0 + k);
    float cb = cos(beta);
    float sb = sin(beta);
    vec2 ct = vec2(cs.x * cb - cs.y * sb, cs.x * sb + cs.y * cb);
    float n = max(20.0, 6.2831853 * rp * 696.0 / 2.4);              // bundles ~2.4 Mm apart at the edge
    float f = penumbraFilaments(ct, x, n, k * 0.37, aa / max(r, 0.4 * ru));
    float pen = 1.0 - smoothstep(Ro * (1.0 + 0.035 * f) - 0.03 * rp - aa, Ro * (1.0 + 0.035 * f) + aa, r);
    // Bright penumbral grains at the inner filament heads, intruding a little into the umbra.
    float grains = smoothstep(0.06, 0.3, f) * (1.0 - smoothstep(0.0, 0.35, x));
    float um = 1.0 - smoothstep(Ri * (0.95 - 0.05 * grains) - aa, Ri * (1.03 - 0.04 * grains) + aa, r);
    float penI = uPenumbra * (1.0 + 0.55 * f + 0.12 * grains) * mix(0.92, 1.05, smoothstep(0.1, 0.7, x));
    // Umbra: near black-brown, darker core, lighter in small spots; faint umbral dots (~0.3 Mm).
    float core = smoothstep(0.0, 0.85, r / Ri);
    vec3 umI = uUmbra * mix(1.5, 1.0, smoothstep(0.003, 0.012, ru)) * mix(0.45, 1.12, core);
    float dots = smoothstep(0.72, 0.86, sunVNoise(vec3(lp / 0.0005, k)));
    umI *= 1.0 + 0.8 * dots * (1.0 - smoothstep(0.3, 1.0, aa / 0.0005));
    vec3 m = mix(vec3(penI), umI, um);
    mul = min(mul, mix(vec3(1.0), m, pen));
    cover = max(cover, pen);
  }
  return vec4(mul, cover);
}

// Active-region mask (max over regions of a soft disc times its strength); idx returns the region.
float sunRegionMask(vec3 d, out int idx) {
  float f = 0.0;
  idx = -1;
  for (int i = 0; i < 24; i++) {
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

// Pores (umbra-only specks, ~1-2.5 Mm across) clustered around the two polarity centres of region i, the
// following polarity more fragmented. Cells of ~3.5 Mm in the region's own frame, so pores stay put while
// the group spreads; their number follows the region's strength. Faded out below a pixel.
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
      float lead = exp(-(pow((un.x - 0.5) / 0.11, 2.0) + pow(un.y / 0.09, 2.0)));
      float foll = exp(-(pow((un.x + 0.48) / 0.18, 2.0) + pow(un.y / 0.13, 2.0)));
      float dens = B.y * (0.3 * lead + 0.5 * foll + 0.012 * exp(-dot(un, un) / 0.2));
      if (h.z > dens) continue;
      float pr = CELL * (0.15 + 0.2 * fract(h.x * 31.0 + h.y * 17.0));
      float p = 1.0 - smoothstep(0.35 * pr - aa, pr + aa, length(q - pc));
      best = max(best, p * min(1.0, pr / max(aa, 1e-9)));
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
  vec4 sp = uSpotCount > 0 ? sunSpots(d, aa) : vec4(1.0, 1.0, 1.0, 0.0);
  if (uRegionCount > 0) {
    int idx;
    float reg = sunRegionMask(d, idx);
    if (idx >= 0) {
      float po = sunPores(sunRegionLocal(d, idx), idx, aa) * (1.0 - sp.a);
      vec3 pI = sunPoreI(2.6);
      sp.rgb = min(sp.rgb, mix(vec3(1.0), pI, po));
      sp.a = max(sp.a, po);
      // Faculae: limb-brightened network around the region (white light shows them near the limb only).
      sp.rgb *= 1.0 + (1.0 - sp.a) * uFacular * pow(1.0 - mu, 1.5) * reg * sunPatches(d, aa) * 2.0;
    }
  }
  return sp;
}

// On-disk H-alpha filaments (the quiescent prominences seen from above): long sinuous dark ribbons with
// a ragged width and short barbs to one side, faded to their area mean below a pixel.
float sunFilaments(vec3 d, float aa) {
  float dark = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i >= uFilCount) break;
    vec4 F = uFil[i];
    float k = floor(F.w);
    float L = F.w - k;
    float inten = length(F.xyz);
    vec3 A = F.xyz / inten;
    vec3 dv = d - A;
    if (dot(dv, dv) > 1.1 * L * L) continue;
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
    float w = max(L * (0.014 + 0.016 * h.z), 0.0035) * sqrt(max(1.0 - u * u, 0.0)) *
      (0.45 + 0.9 * sunVNoise(vec3(u * 11.0, s1, 3.0)));
    float barb = smoothstep(0.68, 0.88, sunVNoise(vec3(u * 19.0, s1, 5.0)));
    w *= 1.0 + 1.6 * barb * step(0.0, off * (h.z - 0.5));
    float core = 1.0 - smoothstep(0.45 * w, w + aa, abs(off));
    dark = max(dark, core * min(inten, 1.0) * min(1.0, w / max(aa, 1e-9)));
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
  float flare = b.z * exp(-pow((abs(v) - 0.09) / 0.025, 2.0)) * (1.0 - smoothstep(0.2, 0.42, abs(u)));
  float hw = 0.02;
  float fil = step(0.3, fract(b.w * 7.13)) * b.y * (1.0 - min(b.z * 2.0, 1.0)) *
    (1.0 - smoothstep(0.5 * hw, hw + aa / r.w, abs(v))) * (1.0 - smoothstep(0.2, 0.38, abs(u))) *
    min(1.0, hw * r.w / max(aa, 1e-9));
  return vec2(flare, fil);
}

// Narrowband H-alpha look: deep red-orange disk, chromospheric network and fibrils, dark filaments,
// bright plage with flare ribbons around active regions, dark spots.
vec3 sunHalpha(SurfaceInput s, float mu, float aa, float sw) {
  vec3 d = s.dirBody;
  float m = 1.0;
  if (sw > 0.0) {
    vec2 S = starWorley(d * uSuperCells, uStarTime, 1.0, 1.0);
    float net = 1.0 - smoothstep(0.0, 0.35, S.y - S.x);
    float brk = sunVNoise(d * uSuperCells * 3.0); // the network is broken into bright mottles
    m += sw * 0.24 * (net * (0.25 + 1.8 * brk * brk) - 0.35);
  }
  float mott = 0.6 * sunVNoise(d * 90.0) + 0.4 * sunVNoise(d * 230.0);
  m += 0.22 * (mott - 0.5) * (1.0 - smoothstep(0.3, 1.0, aa * 230.0));
  // Dark fibrils / spicule texture: elongated noise (stretched along latitude circles), slowly evolving.
  vec3 fd = d * vec3(700.0, 700.0, 260.0) + vec3(0.0, 0.0, uStarTime / 600.0);
  float fib = 0.6 * sunVNoise(fd) + 0.4 * sunVNoise(fd * 2.1);
  m += 0.28 * (fib - 0.5) * (1.0 - smoothstep(0.3, 1.0, aa * 1400.0));
  if (uFilCount > 0) m *= 1.0 - 0.62 * sunFilaments(d, aa);
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
    vec4 sp = sunSpots(d, aa);
    m *= mix(1.0, 0.75 * dot(sp.rgb, vec3(0.3333)), sp.a);
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
  float m = 1.0;
  if (gw > 0.0) {
    float g = (starGranuleRaw(starWorley(s.dirBody * uGranCells, uStarTime, 110.0, 70.0)) - GRAN_MEAN) / GRAN_STD;
    m += gw * uGranContrast * g;
  }
  if (sw > 0.0) {
    vec2 S = starWorley(s.dirBody * uSuperCells, uStarTime, 1.0, 1.0);
    float net = 1.0 - smoothstep(0.0, 0.12, S.y - S.x); // bright network on supergranule borders
    m += sw * uNetContrast * (net - NET_MEAN) / NET_MEAN * 0.25;
  }
  if (uSpotCount > 0 || uRegionCount > 0) {
    vec4 sp = sunActivity(s.dirBody, aa, mu);
    I *= sp.rgb;
    m = mix(m, 1.0, sp.a);
  }
  return I * m;
}
