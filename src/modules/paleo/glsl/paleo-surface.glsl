// Deep-time Earth (paleo module): definitions of the EARTH_PALEO hooks declared in the earth shading
// (glsl/shading-earth.glsl), appended after it by the paleo priority-20 wrapper. Requires
// earth-common.glsl (earthEquirect). Everything is a no-op while uPaleoSeaDrop and uPaleoMix are 0.
uniform sampler2D uPaleoSurface;  // baked synthetic surface: sRGB albedo, a = open water
uniform float uPaleoMix;          // 0 modern imagery .. 1 synthetic surface
uniform sampler2D uPaleoQuat;     // linear RG8: R seabed depth today (m / 255), G ice threshold (m of sea-level drop / 255)
uniform sampler2D uPaleoLandFill; // sRGB: today's land colours pushed into the sea (exposed shelves)
uniform float uPaleoSeaDrop;      // global sea level below today, m (0 outside the ice ages)

// Linear reflectance of ice-age ice sheets (the Blue Marble East Antarctic sample, about 224/223/228 sRGB).
const vec3 PALEO_ICE = vec3(0.75, 0.74, 0.77);

// Ice ages over modern imagery: x = exposed seabed, y = ice sheet (both 0..1).
vec2 earthPaleoIceAge(vec2 uv, float ocean) {
  if (uPaleoSeaDrop <= 0.0) return vec2(0.0);
  vec2 q = earthEquirect(uPaleoQuat, uv).rg * 255.0;
  float exposed = ocean * step(0.5, q.r) * (1.0 - smoothstep(uPaleoSeaDrop - 2.0, uPaleoSeaDrop + 2.0, q.r));
  float ice = step(0.5, q.g) * (1.0 - step(254.5, q.g)) * smoothstep(q.g, q.g + 8.0, uPaleoSeaDrop);
  return vec2(exposed, ice);
}

float earthPaleoWater(vec2 uv, float ocean) {
  vec2 ia = earthPaleoIceAge(uv, ocean);
  ocean *= (1.0 - ia.x) * (1.0 - ia.y);
  if (uPaleoMix > 0.0) ocean = mix(ocean, earthEquirect(uPaleoSurface, uv).a, uPaleoMix);
  return ocean;
}

void earthPaleoSurface(SurfaceInput s, inout vec3 day, inout vec3 night, inout float ocean) {
  vec2 ia = earthPaleoIceAge(s.uv, ocean);
  if (ia.x > 0.0) day = mix(day, earthEquirect(uPaleoLandFill, s.uv).rgb, ia.x);
  day = mix(day, PALEO_ICE, ia.y);
  ocean *= (1.0 - ia.x) * (1.0 - ia.y);
  if (uPaleoMix > 0.0) {
    vec4 p = earthEquirect(uPaleoSurface, s.uv);
    day = mix(day, p.rgb, uPaleoMix);
    ocean = mix(ocean, p.a, uPaleoMix);
    night *= 1.0 - uPaleoMix;
  }
}
