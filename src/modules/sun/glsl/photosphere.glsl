// sun: photosphere SurfaceShading (priority 10 for 'sun'; starSurface() reuses it for other stars).
// Radiance = I0 * P(mu) * granulation, where P is the Neckel (2005) 5th-order limb-darkening
// polynomial per channel and I0 makes the disk mean equal the star's mean disk luminance (cd/m2).
// Granulation: animated Worley cells (F2 - F1 lanes) over a supergranular network, normalised to
// zero mean and unit rms (GRAN_MEAN/GRAN_STD from the CPU twin in granulation.ts), faded out once
// a pixel covers a granule so the disk mean stays exact at every distance.
// Simulated activity on top (Sun only): sunspots with filamentary penumbrae, limb-brightened faculae,
// and an H-alpha mode (uHalpha) with network, fibrils, filaments, plage and flare ribbons.
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
uniform vec4 uSpot[48];     // (dir, umbra radius)
uniform int uSpotCount;
uniform vec4 uRegion[24];   // active regions: (centre, radius)
uniform vec4 uRegionB[24];  // (signed Joy tilt rad, strength 0..1, flare 0..1, seed)
uniform int uRegionCount;
uniform vec3 uUmbra;        // umbra intensity per channel (slightly redder)
uniform float uPenumbra;    // mean penumbra intensity
uniform float uPenRatio;    // penumbra / umbra radius
uniform float uFacular;     // facular contrast at the limb
uniform vec3 uDrift;        // differential rotation relative to sun.fixed, deg/day: x + y s^2 + z s^4
uniform vec4 uFilament;     // (seed, days since the filament bucket began, fade, 0)
uniform float uHalpha;      // 1: narrowband H-alpha look (not physical exposure)
uniform vec3 uHaI0;         // H-alpha disk-centre radiance per channel, disk-mean luminance matched
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

// Sunspots: rgb = intensity multiplier, a = coverage (penumbra and umbra). aa = pixel footprint, radians.
vec4 sunSpots(vec3 d, float aa) {
  vec3 mul = vec3(1.0);
  float cover = 0.0;
  for (int i = 0; i < 48; i++) {
    if (i >= uSpotCount) break;
    vec4 sp = uSpot[i];
    float ru = sp.w;
    float rp = ru * uPenRatio;
    vec3 dv = d - sp.xyz;
    float d2 = dot(dv, dv);
    float edge = 1.1 * rp + aa;
    if (ru <= 0.0 || d2 > edge * edge) continue;
    float r = sqrt(d2);
    vec3 e1 = normalize(cross(vec3(0.0, 0.0, 1.0), sp.xyz));
    vec3 e2 = cross(sp.xyz, e1);
    vec2 cs = vec2(dot(dv, e1), dot(dv, e2)) / max(r, 1e-9);
    float seed = fract(ru * 9137.0) * 40.0;
    // Radial penumbral filaments (~0.3-0.6 Mm wide, two octaves), faded once a pixel covers one.
    float nfil = clamp(floor(rp * 696.0 / 0.35), 40.0, 400.0);
    float k = nfil / 6.2831853;
    float x = r / rp;
    float fil = 0.65 * sunVNoise(vec3(cs * k, x * 2.5 + seed)) + 0.35 * sunVNoise(vec3(cs * 2.3 * k, x * 5.0 - seed));
    float filAA = 1.0 - smoothstep(0.5, 1.5, aa * nfil / (6.2831853 * max(r, 0.3 * rp)));
    float rag = rp * (1.0 + 0.22 * (sunVNoise(vec3(cs * 3.0, seed)) - 0.5) + 0.08 * (fil - 0.5));
    float pen = 1.0 - smoothstep(rag - 0.04 * rp - aa, rag + aa, r);
    float ur = ru * (1.0 + 0.25 * (sunVNoise(vec3(cs * 2.0, seed + 3.0)) - 0.5));
    float um = 1.0 - smoothstep(0.92 * ur - aa, 1.06 * ur + aa, r);
    float penI = uPenumbra * (1.0 + filAA * 0.45 * (fil - 0.5)) * mix(0.88, 1.05, x);
    // Darker umbral core with faint umbral dots.
    float dots = sunVNoise(vec3(cs * r * 696.0 / 0.4, seed)) * filAA;
    vec3 umI = uUmbra * mix(0.7, 1.15, smoothstep(0.0, ur, r)) * (0.9 + 0.25 * dots);
    vec3 m = mix(vec3(penI), umI, um);
    mul = mix(mul, min(mul, m), pen);
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

// Patchy small-scale magnetic brightening (faculae / plage), mean ~0.35, faded to it below a pixel.
float sunPatches(vec3 d, float aa) {
  float n = 0.6 * sunVNoise(d * 170.0) + 0.4 * sunVNoise(d * 420.0);
  float v = smoothstep(0.42, 0.72, n);
  return mix(v, 0.35, smoothstep(0.3, 1.0, aa * 170.0));
}

vec3 sunRotZ(vec3 d, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * d.x - s * d.y, s * d.x + c * d.y, d.z);
}

// Dark sinuous filaments: thin contours of a noise field in channels, drifting with the differential
// rotation since the bucket began (they re-form, and the old ones vanish, every bucket).
float sunFilaments(vec3 d, float aa) {
  float s2 = d.z * d.z;
  float drift = (uDrift.x + uDrift.y * s2 + uDrift.z * s2 * s2) * uFilament.y * 0.01745329;
  vec3 q = sunRotZ(d, -drift) * 3.0 + uFilament.x;
  float chan = smoothstep(0.56, 0.68, sunVNoise(q * 0.8 + 7.0));
  float n = 0.65 * sunVNoise(q * 2.2) + 0.35 * sunVNoise(q * 5.3);
  float hw = 0.022 + aa * 12.0;
  float line = 1.0 - smoothstep(hw, hw * 1.6, abs(n - 0.5));
  float lat = abs(d.z);
  return line * chan * uFilament.z * (1.0 - smoothstep(0.85, 0.95, lat)) * min(1.0, 0.03 / hw);
}

// Two-ribbon flare over region i (u along the Joy-tilted axis, v across the polarity line).
float sunFlare(vec3 d, int i) {
  vec4 r = uRegion[i];
  vec4 b = uRegionB[i];
  if (b.z <= 0.0) return 0.0;
  vec3 e = normalize(cross(vec3(0.0, 0.0, 1.0), r.xyz));
  vec3 n = cross(r.xyz, e);
  vec3 ax = cos(b.x) * e - sin(b.x) * n;
  vec3 pe = cross(r.xyz, ax);
  vec3 dv = d - r.xyz;
  float u = dot(dv, ax) / r.w;
  float v = dot(dv, pe) / r.w + 0.05 * sin(u * 11.0 + b.w * 40.0);
  float rib = exp(-pow((abs(v) - 0.09) / 0.025, 2.0)) * (1.0 - smoothstep(0.2, 0.42, abs(u)));
  return b.z * rib;
}

// Narrowband H-alpha look: deep red disk, chromospheric network and fibrils, filaments, plage, flares.
vec3 sunHalpha(SurfaceInput s, float mu, float aa, float sw) {
  vec3 d = s.dirBody;
  float m = 1.0;
  if (sw > 0.0) {
    vec2 S = starWorley(d * uSuperCells, uStarTime, 1.0, 1.0);
    float net = 1.0 - smoothstep(0.0, 0.35, S.y - S.x);
    float brk = sunVNoise(d * uSuperCells * 3.0); // the network is broken into bright mottles
    m += sw * 0.3 * (net * (0.4 + 1.2 * brk) - 0.35);
  }
  float mott = 0.6 * sunVNoise(d * 90.0) + 0.4 * sunVNoise(d * 230.0);
  m += 0.22 * (mott - 0.5) * (1.0 - smoothstep(0.3, 1.0, aa * 230.0));
  // Dark fibrils / spicule texture: elongated noise (stretched along latitude circles), slowly evolving.
  vec3 fd = d * vec3(700.0, 700.0, 260.0) + vec3(0.0, 0.0, uStarTime / 600.0);
  float fib = 0.6 * sunVNoise(fd) + 0.4 * sunVNoise(fd * 2.1);
  m += 0.28 * (fib - 0.5) * (1.0 - smoothstep(0.3, 1.0, aa * 1400.0));
  m *= 1.0 - 0.6 * sunFilaments(d, aa);
  if (uRegionCount > 0) {
    int idx;
    float reg = sunRegionMask(d, idx);
    if (reg > 0.0) {
      m *= 1.0 + 0.9 * reg * sunPatches(d, aa);
      m += 2.5 * sunFlare(d, idx);
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
  if (uSpotCount > 0) {
    vec4 sp = sunSpots(s.dirBody, aa);
    I *= sp.rgb;
    m = mix(m, 1.0, sp.a);
    if (uRegionCount > 0) {
      int idx;
      float reg = sunRegionMask(s.dirBody, idx);
      if (reg > 0.0) m += (1.0 - sp.a) * uFacular * pow(1.0 - mu, 1.5) * reg * sunPatches(s.dirBody, aa) * 2.0;
    }
  }
  return I * m;
}
