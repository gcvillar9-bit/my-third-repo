// Earth shading (P2, priority 10). Requires NOISE_GLSL, ATMOSPHERE_TRANSMITTANCE_GLSL and
// earth-common.glsl. Day map as linear reflectance lit by the Sun through the atmosphere
// (transmittance LUT) and under cloud shadows; GGX ocean glint whose roughness covers unresolved
// waves, with procedural water normals at low altitude; city lights gated by the terminator.
// Clouds themselves are drawn by the cloud shell; aerial perspective by the atmosphere pass.
uniform sampler2D uEarthDay;
uniform sampler2D uEarthNight;
uniform sampler2D uEarthSpec;
uniform sampler2D uEarthWaves;
uniform float uEarthCityLuminance; // cd/m2 of a white night-map texel
uniform float uEarthTime;          // s

// Water normal in body axes: two scrolling layers of the tileable wave map on the band-3 (10 m)
// detail domain, triplanar on the body-fixed ellipsoid normal. Tiles of 32 and 64 band units divide the
// SURFACE_NOISE_PERIOD of 256, so the float64-anchored origins stay seamless.
vec3 earthWaterNormal(SurfaceInput s, float strength) {
  // Sea water is level: start from the ellipsoid normal, never the terrain/relief normal.
  vec3 nB = normalize(uEarthWorldToBody * s.up);
  vec3 p = s.detailOrigin[3] + s.localPos / 10.0;
  vec3 w = nB * nB;
  w /= (w.x + w.y + w.z);
  vec2 drift1 = vec2(0.09, 0.025) * uEarthTime;
  vec2 drift2 = vec2(-0.05, 0.07) * uEarthTime;
  vec2 px = p.yz, py = p.zx, pz = p.xy;
  vec2 tx = (texture(uEarthWaves, px / 32.0 + drift1 / 32.0).xy + texture(uEarthWaves, px / 64.0 + drift2 / 64.0).yx) - 1.0;
  vec2 ty = (texture(uEarthWaves, py / 32.0 + drift1 / 32.0).xy + texture(uEarthWaves, py / 64.0 + drift2 / 64.0).yx) - 1.0;
  vec2 tz = (texture(uEarthWaves, pz / 32.0 + drift1 / 32.0).xy + texture(uEarthWaves, pz / 64.0 + drift2 / 64.0).yx) - 1.0;
  vec3 g = w.x * vec3(0.0, tx.x, tx.y) + w.y * vec3(ty.y, 0.0, ty.x) + w.z * vec3(tz.x, tz.y, 0.0);
  g -= nB * dot(nB, g);
  return normalize(nB + strength * g);
}

// Terrain detail bands (albedo noise and normal perturbation) apply on land only: the sea is level.
#define SURFACE_DETAIL_MASK 1
float surfaceDetailMask(SurfaceInput s) {
  return uEarthHasMaps > 0.5 ? 1.0 - step(0.5, earthEquirect(uEarthSpec, s.uv).r) : 1.0;
}

vec3 shadeSurface(SurfaceInput s) {
  vec2 uv = s.uv;
  vec3 day = vec3(0.12);
  vec3 night = vec3(0.0);
  float ocean = 0.0;
  if (uEarthHasMaps > 0.5) {
    day = earthEquirect(uEarthDay, uv).rgb;
    night = earthEquirect(uEarthNight, uv).rgb;
    ocean = earthEquirect(uEarthSpec, uv).r;
  }
  float mu0g = dot(s.up, s.sunDir);
  // Sun through the atmosphere at this point, then through the cloud layer above it.
  vec3 Tsun = atmoSunTransmittance(uEarthRadiusKm + s.height * 0.001, mu0g);
  vec3 sunB = uEarthWorldToBody * s.sunDir;
  vec3 q = normalize(s.dirBody + sunB * (uEarthCloudAltKm / uEarthRadiusKm) / max(mu0g, 0.08));
  float cloudShadow = 1.0 - 0.8 * earthCloudDensity(q, earthUv(q), s.pixelSize);
  vec3 E = s.sunIlluminance * s.shadow * Tsun * cloudShadow;

  // Ocean: procedural normals fade in below ~6 m per pixel; unresolved waves widen the lobe.
  float unresolved = smoothstep(2.0, 20.0, s.pixelSize);
  float waveStrength = ocean * (1.0 - smoothstep(1.0, 6.0, s.pixelSize));
  vec3 nWater = transpose(uEarthWorldToBody) * earthWaterNormal(s, waveStrength);
  vec3 n = normalize(mix(s.normal, nWater, step(0.5, ocean)));
  float mu0 = dot(n, s.sunDir);
  float mu = max(dot(n, s.viewDir), 1e-3);
  vec3 L = vec3(0.0);
  if (mu0 > 0.0) {
    float alpha = mix(0.06, 0.25, unresolved);
    float a2 = alpha * alpha;
    vec3 h = normalize(s.sunDir + s.viewDir);
    float nh = max(dot(n, h), 0.0);
    float dn = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (EARTH_PI * dn * dn);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(h, s.viewDir), 0.0), 5.0);
    float k = 0.5 * alpha;
    float G = (mu0 / (mu0 * (1.0 - k) + k)) * (mu / (mu * (1.0 - k) + k));
    float glint = ocean * D * F * G / (4.0 * mu);
    L += E * (day * max(dot(s.normal, s.sunDir), 0.0) / EARTH_PI + vec3(glint));
  }
  // City lights: on after sunset (geometric Sun elevation below ~6 deg), dimmed under clouds.
  float dark = 1.0 - smoothstep(-0.15, 0.1, mu0g);
  float cloudHere = earthCloudDensity(s.dirBody, uv, s.pixelSize);
  L += night * uEarthCityLuminance * dark * (1.0 - 0.8 * cloudHere);
  return L;
}
