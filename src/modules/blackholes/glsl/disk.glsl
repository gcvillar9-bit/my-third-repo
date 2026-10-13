// Accretion-disk emission (GLSL twin of disk.ts). Units r_s = 1, c = 1 (M = 1/2).
// Requires BLACKBODY_GLSL and NOISE_GLSL before this chunk.
uniform vec3 uDiskN;        // unit disk axis (rotation sense), world axes
uniform vec3 uDiskA;        // in-plane basis (azimuth 0)
uniform vec3 uDiskB;        // n x A
uniform float uDiskIn;      // r_s
uniform float uDiskOut;     // r_s
uniform float uDiskTmax;    // K at the flux peak
uniform float uDiskLum;     // cd/m² at the flux peak (rest frame)
uniform float uFluxPeak;    // ntFlux at its maximum
uniform vec3 uPhase;        // Keplerian shear phases (r_s/c) of two noise layers + weight of layer 1
uniform float uDoppler;     // 1 on, 0 off
uniform float uGravity;     // 1 on, 0 off
uniform float uObsShift;    // static observer blueshift 1/sqrt(1 - 1/r_cam)
uniform float uExposure;

// Page-Thorne flux for a = 0 (arbitrary units), r in r_s; 0 inside r_isco = 3.
float ntFlux(float r) {
  float x = 2.0 * r;
  if (x <= 6.0) return 0.0;
  float y = sqrt(x);
  const float S3 = 1.7320508;
  const float S6 = 2.4494897;
  float j = 2.0 * (y - S6) - S3 * log(((y - S3) * (S6 + S3)) / ((y + S3) * (S6 - S3)));
  return j / (pow(x, 2.5) * (x - 3.0));
}

// g = nu_obs / nu_emit for a Keplerian emitter at r and a photon with L_z/E = lambda.
float diskG(float r, float lambda) {
  r = max(r, 1.55);
  float om = sqrt(0.5 / (r * r * r));
  float full = sqrt(1.0 - 1.5 / r) / max(1.0 - om * lambda, 1e-3);
  float grav = sqrt(1.0 - 1.0 / r);
  float g = mix(1.0, grav * uObsShift, uGravity) * mix(1.0, full / grav, uDoppler);
  return g;
}

// Keplerian-sheared filament noise in (azimuth, log r), crossfaded between two phase layers.
float diskNoise(vec3 p, float r) {
  float phi = atan(dot(p, uDiskB), dot(p, uDiskA));
  float om = sqrt(0.5 / (r * r * r));
  float lr = log(r) * 7.0;
  const float K = 1.9098593; // 12 / 2pi
  vec3 per = vec3(12.0, 65536.0, 65536.0);
  float a = pnoise(vec3((phi - om * uPhase.x) * K, lr, 0.0), per)
    + 0.5 * pnoise(vec3((phi - om * uPhase.x) * K * 2.0, lr * 2.3, 3.1), per * vec3(2.0, 1.0, 1.0));
  float b = pnoise(vec3((phi - om * uPhase.y) * K, lr, 11.0), per)
    + 0.5 * pnoise(vec3((phi - om * uPhase.y) * K * 2.0, lr * 2.3, 17.0), per * vec3(2.0, 1.0, 1.0));
  return mix(b, a, uPhase.z);
}

// Pre-exposed radiance of the thin disk at crossing point p (radius r) for photon lambda.
vec3 thinDisk(vec3 p, float r, float lambda) {
  float f = ntFlux(r) / uFluxPeak;
  f *= smoothstep(uDiskOut, uDiskOut * 0.75, r);
  if (f <= 0.0) return vec3(0.0);
  float g = diskG(r, lambda);
  float t = uDiskTmax * pow(f, 0.25);
  float n = diskNoise(p, r);
  float fil = mix(0.35, 1.7, smoothstep(-0.55, 0.65, n));
  float g2 = g * g;
  float lum = uDiskLum * f * g2 * g2 * fil;
  return blackbodyColor(clamp(g * t, 1000.0, 40000.0)) * lum * uExposure;
}

// Optically thin, geometrically thick RIAF-like glow: emissivity per unit length at p.
uniform float uRiafT;
uniform float uRiafLum;
vec3 riafGlow(vec3 p, float r, float lambda) {
  if (r < 1.02) return vec3(0.0);
  float z = dot(p, uDiskN);
  float h = 0.45 * r;
  float rho = pow(r / 2.0, -2.2) * exp(-(z * z) / (h * h));
  float g = diskG(r, lambda);
  float g2 = g * g;
  float n = diskNoise(p, max(r, 1.6));
  float lum = uRiafLum * rho * g2 * g2 * mix(0.6, 1.4, smoothstep(-0.5, 0.6, n));
  return blackbodyColor(clamp(g * uRiafT * sqrt(3.0 / max(r, 1.5)), 1000.0, 40000.0)) * lum * uExposure;
}
