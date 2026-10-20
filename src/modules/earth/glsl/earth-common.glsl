// Earth helpers shared by the surface shading and the cloud shell. Requires NOISE_GLSL (gnoise).
#ifndef EARTH_COMMON_GLSL
#define EARTH_COMMON_GLSL
#define EARTH_PI 3.14159265358979
uniform sampler2D uEarthBrc;   // linear: R bump, G roughness, B clouds
uniform float uEarthHasMaps;
uniform mat3 uEarthWorldToBody; // world axes -> body-fixed axes
uniform float uEarthRadiusKm;  // equatorial radius (= atmosphere bottom), km
uniform float uEarthCloudAltKm;
uniform float uEarthCloudZonal; // 0 today's cloud map .. 1 zonal weather bands (deep time)

// Equirectangular uv (u = lon / 2pi + 0.5 east-positive, v = lat / pi + 0.5) of a body-fixed unit vector.
vec2 earthUv(vec3 d) {
  return vec2(atan(d.y, d.x) * 0.15915494309 + 0.5, asin(clamp(d.z, -1.0, 1.0)) * 0.31830988618 + 0.5);
}

// Seam-safe sampling: the u derivative is wrapped so the longitude-180 seam keeps its mip level.
vec4 earthEquirect(sampler2D t, vec2 uv) {
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  return textureGrad(t, uv, dx, dy);
}

// Cloud cover 0..1 without today's geography: the equatorial convergence band, clear subtropics,
// the mid-latitude storm tracks and polar stratus, broken up by continental-scale noise. Used in deep
// time, where today's cloud map would trace today's continents.
float earthZonalClouds(vec3 d) {
  float lat = asin(clamp(d.z, -1.0, 1.0)) * 57.29578;
  float a = abs(lat);
  float cover = 0.3 + 0.32 * exp(-pow(lat / 6.0, 2.0)) + 0.3 * exp(-pow((a - 55.0) / 10.0, 2.0)) -
    0.2 * exp(-pow((a - 24.0) / 8.0, 2.0));
  float n = 0.55 * gnoise(d * 7.0) + 0.3 * gnoise(d * 17.0) + 0.15 * gnoise(d * 41.0);
  return smoothstep(0.42, 0.75, cover + 0.55 * n);
}

// Cloud optical density 0..1 at body-fixed unit direction d: brc.B shaped by fBm detail (8 km and
// 2 km wavelengths) that fades out when one pixel covers more than the wavelength.
float earthCloudDensity(vec3 d, vec2 uv, float pixelSize) {
  float c = earthEquirect(uEarthBrc, uv).b;
  if (uEarthCloudZonal > 0.0) c = mix(c, earthZonalClouds(d), uEarthCloudZonal);
  vec3 p = d * (uEarthRadiusKm / 8.0);
  float w1 = 1.0 - smoothstep(2000.0, 8000.0, pixelSize);
  float w2 = 1.0 - smoothstep(500.0, 2000.0, pixelSize);
  float n = 0.65 * gnoise(p) * w1 + 0.35 * gnoise(p * 4.0) * w2;
  float edge = 4.0 * c * (1.0 - c);
  return uEarthHasMaps > 0.5 ? clamp((c - 0.06) * 1.2 + 0.45 * n * edge, 0.0, 1.0) : 0.0;
}
#endif
