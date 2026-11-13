// Atlas star points (background layer): cluster member stars, Cepheids, satellite galaxies and
// the populations of the Galactic centre. Positions are pc from the ssb in ICRS axes; the camera
// arrives as an RTE high/low pair (rte.glsl, prepended in the vertex stage).
// A point is either a star (blob = 0: the HYG point-spread function) or a clump of unresolved
// light with a physical radius (blob > 0, pc), drawn as a Gaussian of that size.
// Points flagged `ext` are dimmed and reddened by the dust of the galaxy model along the line of
// sight (closed-form vertical integral in 6 sub-segments; the arm dust lanes are left out).
varying vec3 vColor;
varying float vSigma;
varying float vRadius;
varying float vHalo;
#ifdef COSMOS_VERTEX
attribute float absMag;
attribute vec3 color;
attribute float blob;
attribute float ext;
uniform float uScale;       // LUX_MAG0 · exposure / pixelSolidAngle (E → pre-exposed L per px)
uniform float uPixelAngle;
uniform float uGain;        // 0 hides the layer
uniform vec3 uCamModel;     // camera, model kpc
uniform vec3 uSunModel;     // Sun, model kpc
uniform mat3 uWorldToModel;
#define CORE_SIGMA 0.65
#define MIN_PEAK 2.0e-4
#define MIN_BLOB_PEAK 2.0e-5  // clumps overlap, so their summed glow shows below the star threshold
#define HALO_K 0.012
#define HALO_FLOOR 0.002
#define MAX_RADIUS 48.0
#define MAX_BLOB_PX 24.0

float slabIntegral(float za, float zb) {
  // Mean of exp(-|z| / hz) along a straight segment from height za to zb.
  float a = abs(za) / MW_DUST_HZ;
  float b = abs(zb) / MW_DUST_HZ;
  if (za * zb < 0.0) return (2.0 - exp(-a) - exp(-b)) / max(a + b, 1e-6);
  float d = b - a;
  return abs(d) < 1e-4 ? exp(-a) : (exp(-a) - exp(-b)) / d;
}

float dustTau(vec3 a, vec3 b) {
  vec3 ab = b - a;
  float len = length(ab);
  float tau = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 p0 = a + ab * (float(i) / 6.0);
    vec3 p1 = a + ab * (float(i + 1) / 6.0);
    float R = length(0.5 * (p0.xy + p1.xy));
    tau += exp(-(R - MW_R0) / MW_DUST_HR) * slabIntegral(p0.z, p1.z);
  }
  return MW_DUST_K0 * tau * len / 6.0;
}

void main() {
  vec3 rel = rteRelative(position);
  float d = max(length(rel), 1e-6);
  float m = absMag + 5.0 * log2(d * 0.1) * 0.30102999566;
  vec3 tint = color;
  if (ext > 0.5) {
    float tau = min(dustTau(uCamModel, uSunModel + uWorldToModel * (position * 1e-3)), 40.0);
    m += 1.0857 * tau;
    tint *= exp(-tau * (MW_REDDEN - 1.0));
  }
  float i1 = uGain * uScale * exp2(-1.3287712380 * m);
  float sigma = CORE_SIGMA;
  if (blob > 0.0) sigma = length(vec2(CORE_SIGMA, blob / (d * uPixelAngle)));
  float peak = i1 / (6.2831853 * sigma * sigma);
  if (peak < (blob > 0.0 ? MIN_BLOB_PEAK : MIN_PEAK)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    vSigma = 1.0;
    vRadius = 0.0;
    vHalo = 0.0;
    return;
  }
  vec3 dir = rel / d;  // directions only: drawn at infinity like the HYG stars
  gl_Position = projectionMatrix * vec4((modelViewMatrix * vec4(dir, 0.0)).xyz, 1.0);
  vColor = tint * i1;
  vSigma = sigma;
  if (blob > 0.0) {
    vRadius = min(3.0 * sigma, MAX_BLOB_PX);
    vHalo = 0.0;
  } else {
    vRadius = clamp(sqrt(max(i1 * HALO_K / HALO_FLOOR - 1.0, 0.0)), 2.0, MAX_RADIUS);
    vHalo = HALO_K;
  }
  gl_PointSize = 2.0 * vRadius + 1.0;
}
#else
void main() {
  vec2 q = (gl_PointCoord - 0.5) * (2.0 * vRadius + 1.0);
  float r2 = dot(q, q);
  float R2 = vRadius * vRadius;
  if (r2 > R2) discard;
  float core = exp(-0.5 * r2 / (vSigma * vSigma)) / (6.2831853 * vSigma * vSigma);
  float halo = vHalo / (1.0 + r2) * (1.0 - smoothstep(0.36 * R2, R2, r2));
  gl_FragColor = vec4(min(vColor * (core + halo), vec3(60000.0)), 1.0);
}
#endif
