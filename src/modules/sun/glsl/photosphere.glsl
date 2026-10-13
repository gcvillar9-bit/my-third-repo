// sun: photosphere SurfaceShading (priority 10 for 'sun'; starSurface() reuses it for other stars).
// Radiance = I0 * P(mu) * granulation, where P is the Neckel (2005) 5th-order limb-darkening
// polynomial per channel and I0 makes the disk mean equal the star's mean disk luminance (cd/m2).
// Granulation: animated Worley cells (F2 - F1 lanes) over a supergranular network, normalised to
// zero mean and unit rms (GRAN_MEAN/GRAN_STD from the CPU twin in granulation.ts), faded out once
// a pixel covers a granule so the disk mean stays exact at every distance.
uniform vec3 uStarI0;       // cd/m2 per channel at disk centre (mu = 1)
uniform vec3 uLimbA[6];     // limb-darkening coefficients A_k per channel
uniform float uGranCells;   // star radius / granule size (cells per unit direction)
uniform float uSuperCells;  // star radius / supergranule size
uniform float uGranSizeM;   // granule size, m
uniform float uGranContrast;
uniform float uNetContrast;
uniform float uStarTime;    // s, wrapped to one day (the animation is exactly periodic over a day)

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

vec3 shadeSurface(SurfaceInput s) {
  float mu = clamp(dot(s.normal, s.viewDir), 0.0, 1.0);
  vec3 P = uLimbA[0] + mu * (uLimbA[1] + mu * (uLimbA[2] + mu * (uLimbA[3] + mu * (uLimbA[4] + mu * uLimbA[5]))));
  vec3 I = max(P, vec3(0.0)) * uStarI0;
  // Footprint of one pixel in granule units (foreshortened towards the limb).
  float fp = s.pixelSize / max(mu, 0.08) / uGranSizeM;
  float gw = 1.0 - smoothstep(0.35, 1.0, fp);
  float sw = 1.0 - smoothstep(0.35, 1.0, fp * uSuperCells / uGranCells);
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
  return I * m;
}
