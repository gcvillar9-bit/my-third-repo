// Gas-giant shading (P3-A, priority 10). The albedo map (normalised by its mean, so the disk
// matches the geometric albedo p) is advected by a zonal jet profile plus divergence-free
// curl-noise eddies. Advection uses two phases of a bounded flow cycle crossfaded so each wraps
// while invisible (classic flow-map scheme): bands shear slowly with sim time without smearing.
// Jupiter adds a Great Red Spot vortex at the spot found in the map. Minnaert limb darkening
// L = E c p (2k+1)/(2 pi) mu0^k mu^(k-1) keeps the disk-integrated albedo for any k (k = 1: Lambert).
// Needs noise.glsl (pnoise) and, with RING_SHADOW, rings/ring-shadow.glsl before this file.
#define GIANT_MAX_JETS 8
#define GIANT_PI 3.14159265358979
uniform sampler2D uGiantMap;
uniform float uHasMap;
uniform float uMapScale;  // 1 / mean linear luminance of the map
uniform float uAlbedo;    // geometric albedo
uniform float uMinnaertK;
uniform vec3 uTint;
uniform float uRadius;    // equatorial radius, m
uniform vec4 uJets[GIANT_MAX_JETS]; // x lat rad, y speed m/s, z half-width rad (0 = unused)
uniform float uTurbSpeed; // m/s
uniform vec4 uFlow;       // x, y elapsed s of phases A and B; z weight of B; w amplitude (0 at high warp)
uniform vec4 uGrs;        // x lon rad, y lat rad, z semi-major m (east), w semi-minor m (north)
uniform float uGrsOmega;  // vortex angular speed, rad/s (0 = none)

vec4 giantSample(vec2 uv) {
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  return textureGrad(uGiantMap, uv, dx, dy);
}

float giantJets(float lat) {
  float u = 0.0;
  for (int i = 0; i < GIANT_MAX_JETS; i++) {
    vec4 j = uJets[i];
    if (j.z <= 0.0) continue;
    float x = (lat - j.x) / j.z;
    u += j.y * exp(-x * x);
  }
  return u;
}

// Curl of a noise stream function in the local tangent plane: (east, north), unit magnitude scale.
vec2 giantCurl(vec3 d, vec3 east, vec3 north) {
  const float F = 9.0;
  const float H = 0.15;
  vec3 p = d * F + vec3(17.0, 31.0, 47.0);
  float n0 = pnoise(p, vec3(256.0));
  float ne = pnoise(p + east * H, vec3(256.0));
  float nn = pnoise(p + north * H, vec3(256.0));
  return vec2(nn - n0, n0 - ne) / H;
}

// Upstream texture coordinate after advecting for t seconds with velocity vel (m/s, east/north).
vec2 giantUpstream(float lon, float lat, vec2 vel, float t, float grsQ, vec2 grsXY) {
  if (grsQ < 1.6 && uGrsOmega != 0.0) {
    // Elliptic solid-body core fading out by q = 1.6; rotate back in normalised coordinates.
    float th = -uGrsOmega * t * smoothstep(1.6, 0.7, grsQ);
    vec2 e = grsXY / uGrs.zw;
    e = vec2(cos(th) * e.x - sin(th) * e.y, sin(th) * e.x + cos(th) * e.y);
    vec2 xy = e * uGrs.zw;
    vec2 vort = (grsXY - xy) / max(t, 1.0); // velocity that carries the upstream point xy here
    vel = mix(vort, vel, smoothstep(1.0, 1.6, grsQ));
  }
  float lon2 = lon - vel.x * t / (uRadius * max(cos(lat), 0.05));
  float lat2 = clamp(lat - vel.y * t / uRadius, -1.5707, 1.5707);
  return vec2(lon2 / (2.0 * GIANT_PI) + 0.5, lat2 / GIANT_PI + 0.5);
}

vec3 giantAlbedo(SurfaceInput s) {
  if (uHasMap < 0.5) return uTint;
  vec3 d = s.dirBody;
  float lat = asin(clamp(d.z, -1.0, 1.0));
  float lon = atan(d.y, d.x);
  if (uFlow.w <= 0.0) return giantSample(s.uv).rgb * uMapScale;
  vec3 east = vec3(-d.y, d.x, 0.0);
  east = dot(east, east) > 1e-8 ? normalize(east) : vec3(0.0, 1.0, 0.0);
  vec3 north = cross(d, east);
  vec2 vel = vec2(giantJets(lat), 0.0) + uTurbSpeed * giantCurl(d, east, north);
  float dl = lon - uGrs.x;
  dl -= 2.0 * GIANT_PI * floor(dl / (2.0 * GIANT_PI) + 0.5);
  vec2 grsXY = vec2(dl * cos(uGrs.y), lat - uGrs.y) * uRadius;
  float grsQ = uGrsOmega != 0.0 ? length(grsXY / uGrs.zw) : 1e3;
  vec3 a = giantSample(giantUpstream(lon, lat, vel, uFlow.x * uFlow.w, grsQ, grsXY)).rgb;
  vec3 b = giantSample(giantUpstream(lon, lat, vel, uFlow.y * uFlow.w, grsQ, grsXY)).rgb;
  return mix(a, b, uFlow.z) * uMapScale;
}

vec3 shadeSurface(SurfaceInput s) {
  float mu0 = dot(s.normal, s.sunDir);
  if (mu0 <= 0.0) return vec3(0.0);
  float mu = max(dot(s.normal, s.viewDir), 1e-3);
  float k = uMinnaertK;
  float limb = pow(mu0, k) * pow(mu, k - 1.0);
  vec3 E = s.sunIlluminance * s.shadow;
#ifdef RING_SHADOW
  E *= ringSunTransmission(s.viewPos, s.sunDir);
#endif
  return E * giantAlbedo(s) * (uAlbedo * (2.0 * k + 1.0) / (2.0 * GIANT_PI)) * limb;
}
