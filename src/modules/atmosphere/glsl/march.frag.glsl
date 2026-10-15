// Reduced-resolution in-scattering march (P4-P). Texel (i, j) is the full-resolution pixel (2i, 2j):
// its depth and the ray through its centre. Two outputs per texel:
//   oL = (L per unit sun illuminance, path length tEnd - tStart in km; -1 when the texel does not march)
//   oT = (transmittance, end type: 1 = the ray ends on geometry or the ground, 0 = it leaves the shell)
// The composite upsamples them from neighbours with the same end type (path-length weighted) and
// marches at full resolution only where no neighbour matches (e.g. the limb's last pixel).
layout(location = 0) out highp vec4 oL;
layout(location = 1) out highp vec4 oT;

void main() {
  AtmoPixel p = atmoPixel(2 * ivec2(gl_FragCoord.xy));
  if (p.kind != ATMO_MARCH) {
    oL = vec4(0.0, 0.0, 0.0, -1.0);
    oT = vec4(1.0);
    return;
  }
  vec3 L;
  vec3 T;
  atmoMarchPixel(p, L, T);
  bvec3 bad = bvec3(isnan(L.r) || isinf(L.r), isnan(L.g) || isinf(L.g), isnan(L.b) || isinf(L.b));
  if (any(bad)) L = vec3(0.0);
  oL = vec4(max(L, 0.0), p.tEnd - p.tStart);
  oT = vec4(clamp(T, 0.0, 1.0), p.geomIn || p.hitsGround ? 1.0 : 0.0);
}
