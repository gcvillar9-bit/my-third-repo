// Curved surfaces drawn with flat facets (cube-spheres, coarse terrain tiles, cloud shells) sag
// below the true surface inside every facet: 0.03-0.06% of the radius for a 32-cell face, which is
// 1-2 km on Mars or Earth and 20 km on Jupiter. Anything that reads depth then sees the mesh grid:
// the atmosphere's path to the ground changes by the sag, and a shell a few km above the surface
// can dip under it. These helpers return the factor k that slides a fragment along its view ray
// onto the exact surface: position' = k * position (camera-relative), view depth' = k * depth,
// and the fragment writes its depth with LOG_DEPTH_FRAGMENT_AT(k).
#ifndef COSMOS_FACET_GLSL
#define COSMOS_FACET_GLSL
// Unit sphere: `unit` is the fragment's interpolated position on the unit sphere (its length
// falls short of 1 by the sag) and `d` the camera-to-fragment vector in the same space (body axes,
// divided by the radii). Solves |unit + t d| = 1 for the root next to the facet, in the form
// that does not cancel (c is the sag itself). A camera outside the sphere takes the near root
// (back toward the camera), one inside the far root (onward to the shell). The camera's side
// decides, not the sign of b: on a limb facet b can turn slightly positive while the surface is
// still the near one. Right at the surface, where float32 cannot tell the side, b breaks the tie.
float cosmosSphereFactor(vec3 unit, vec3 d) {
  float a = dot(d, d);
  float b = dot(unit, d);
  float c = dot(unit, unit) - 1.0;
  float disc = b * b - a * c;
  if (c >= 0.0 || disc <= 0.0 || a <= 0.0) return 1.0;
  float s = sqrt(disc);
  float cam2 = dot(unit - d, unit - d);
  bool outside = cam2 > 1.00001 || (cam2 > 0.99999 && b < 0.0);
  float t = outside ? c / (s - b) : -c / (s + b);
  return clamp(1.0 + t, 0.02, 4.0);
}
// Local form for terrain, where only fragment-local quantities are precise: P is the
// camera-relative fragment, u the local vertical (unit), rho the true surface radius there and
// delta how far the fragment lies below it (m). Solves |P (1 + tau) - C| = rho with the centre
// C = P - u (rho - delta); no body-centre coordinates enter, so there is no cancellation.
float cosmosCurveFactor(vec3 P, vec3 u, float rho, float delta) {
  float a = dot(P, P);
  float b = (rho - delta) * dot(P, u);
  float c = -delta * (2.0 * rho - delta);
  float disc = b * b - a * c;
  if (delta <= 0.0 || disc <= 0.0 || a <= 0.0) return 1.0;
  float s = sqrt(disc);
  // Terrain is seen from above its surface: always the near root.
  return clamp(1.0 + c / (s - b), 0.02, 1.0);
}
// LOG_DEPTH_FRAGMENT() for a fragment moved by the factor k (needs depth.glsl before this chunk).
#define LOG_DEPTH_FRAGMENT_AT(k) gl_FragDepth = logDepthFromLinear(max((vCosmosLogDepth - 1.0) * (k), 0.0))
#endif
