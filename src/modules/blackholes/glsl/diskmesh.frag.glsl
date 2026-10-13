uniform float uRin;
uniform float uRout;
uniform float uInnerCut;   // r_s: the lensing pass draws the disk inside this radius
uniform float uMeshLum;    // cd/m² at uRin
uniform float uRealistic;  // 1: physical r^-3 profile, 0: illustrative r^-1/2
varying vec3 vLocal;
varying vec3 vView;
void main() {
  float r = length(vLocal);
  if (r < uInnerCut) discard;
  float f = ntFlux(r) / uFluxPeak;
  float t = uDiskTmax * pow(max(f, 0.0), 0.25);
  // Special-relativistic Doppler of the Keplerian flow towards the camera, plus gravitational shift.
  vec3 k = -normalize(vView);
  float beta = sqrt(0.5 / r);
  vec3 vdir = normalize(cross(uDiskN, vLocal));
  float gam = inversesqrt(1.0 - beta * beta);
  float dop = 1.0 / (gam * (1.0 - beta * dot(vdir, k)));
  float g = mix(1.0, sqrt(1.0 - 1.0 / r), uGravity) * mix(1.0, dop, uDoppler);
  float prof = mix(pow(r / uRin, -0.5), pow(r / uRin, -3.0), uRealistic);
  prof *= smoothstep(uRout, uRout * 0.7, r);
  float n = diskNoise(vLocal, r);
  float g2 = g * g;
  float lum = uMeshLum * prof * g2 * g2 * mix(0.45, 1.5, smoothstep(-0.5, 0.6, n));
  gl_FragColor = vec4(blackbodyColor(clamp(g * t, 1000.0, 40000.0)) * lum * uExposure, 1.0);
  LOG_DEPTH_FRAGMENT();
}
