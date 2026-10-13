// Analytic sphere shadows (eclipses, moon transits): up to 4 occluders. The visible fraction of
// the solar disk is 1 - overlap(sun disk, occluder disk) / area(sun disk) using the exact
// circle-overlap area, which yields umbra, penumbra and annular phases.
// Uniforms (camera-relative, world axes, metres; fill with createShadowUniforms()):
//   uSunSphere   xyz = Sun centre, w = Sun radius
//   uOccluders[] xyz = occluder centre, w = radius;  uOccluderCount = number in use (0..4)
#ifndef COSMOS_SHADOWS_GLSL
#define COSMOS_SHADOWS_GLSL
#define COSMOS_MAX_OCCLUDERS 4
uniform vec4 uSunSphere;
uniform vec4 uOccluders[COSMOS_MAX_OCCLUDERS];
uniform int uOccluderCount;
// Area of the intersection of two circles with radii r1, r2 and centre distance d.
float circleOverlap(float r1, float r2, float d) {
  if (d >= r1 + r2) return 0.0;
  float rmin = min(r1, r2);
  if (d <= abs(r1 - r2)) return 3.14159265 * rmin * rmin;
  float a1 = clamp((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1), -1.0, 1.0);
  float a2 = clamp((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2), -1.0, 1.0);
  float k = (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2);
  return r1 * r1 * acos(a1) + r2 * r2 * acos(a2) - 0.5 * sqrt(max(k, 0.0));
}
// Angle between two directions, robust for small angles.
float cosmosAngleBetween(vec3 a, vec3 b) { return atan(length(cross(a, b)), dot(a, b)); }
// Fraction of the Sun visible from point p (camera-relative, m), 0..1.
float sunVisibility(vec3 p) {
  vec3 toSun = uSunSphere.xyz - p;
  float ds = length(toSun);
  float rs = asin(clamp(uSunSphere.w / ds, 0.0, 1.0));
  float vis = 1.0;
  for (int i = 0; i < COSMOS_MAX_OCCLUDERS; i++) {
    if (i >= uOccluderCount) break;
    vec3 toOcc = uOccluders[i].xyz - p;
    float dOcc = length(toOcc);
    if (dOcc >= ds || dOcc <= uOccluders[i].w) continue; // behind the Sun, or inside the occluder
    float ro = asin(clamp(uOccluders[i].w / dOcc, 0.0, 1.0));
    float sep = cosmosAngleBetween(toSun, toOcc);
    vis *= 1.0 - circleOverlap(rs, ro, sep) / (3.14159265 * rs * rs);
  }
  return clamp(vis, 0.0, 1.0);
}
#endif
