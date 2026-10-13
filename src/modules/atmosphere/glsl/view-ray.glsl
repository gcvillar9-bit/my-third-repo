// View ray helpers shared by the aerial-perspective LUT and the composite.
#ifndef ATMO_VIEW_RAY_GLSL
#define ATMO_VIEW_RAY_GLSL
uniform mat4 uInvProj;     // camera.projectionMatrixInverse
uniform mat3 uCamToWorld;  // camera rotation (view -> world axes)
uniform mat3 uWorldToAtmo; // world axes -> atmosphere space (body-fixed, z scaled by a/c)
uniform vec3 uCamPos;      // camera, atmosphere space, km
uniform float uCamH;       // camera height above the ground, km (float64-derived)
uniform vec3 uSunDir;      // unit, atmosphere space
uniform float uApMax;      // aerial-perspective range, km

// View-space direction (camera looks down -Z) for a screen uv in 0..1.
vec3 viewDirFromUv(vec2 uv) {
  vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  return normalize(vp.xyz / vp.w);
}

// Atmosphere-space unit ray for a view direction; .w = km of atmosphere space per km of view distance.
vec4 atmoRay(vec3 dirV) {
  vec3 rA = uWorldToAtmo * (uCamToWorld * dirV);
  float sc = length(rA);
  return vec4(rA / sc, sc);
}
#endif
