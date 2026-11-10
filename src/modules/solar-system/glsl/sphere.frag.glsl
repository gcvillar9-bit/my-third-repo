// Cube-sphere surface fragment main (solar-system 'sphere' provider). sphere.ts prepends the
// depth, facet, SurfaceInput, shadows, phase and equirect chunks plus the body's SurfaceShading GLSL
// (which defines shadeSurface). Output: L[cd/m2] * uExposure, clamped below the half-float max.
uniform float uExposure;
uniform float uFade;
uniform float uPixelAngle;
uniform vec3 uRadii;
uniform mat3 uBodyToWorld;
uniform vec3 uSunPos;         // camera-relative Sun centre, world axes, m
uniform vec3 uSunIlluminance; // lux per channel at the body
varying vec3 vPosBody;
varying vec3 vViewPos;
varying vec3 vUnit;

// The mesh's flat facets sag below the ellipsoid; cosmosSphereFactor (facet.glsl) slides each
// fragment back along its view ray onto the exact ellipsoid, so depth, shading position and
// shadows no longer carry the mesh grid (it showed through the atmosphere on the low presets).
void main() {
  SurfaceInput s;
  vec3 viewB = vViewPos * uBodyToWorld; // camera to facet point, body-fixed axes
  float k = cosmosSphereFactor(vUnit, viewB / uRadii);
  vec3 viewPos = vViewPos * k;
  vec3 posBody = vPosBody + viewB * (k - 1.0);
  vec3 dirB = normalize(posBody);
  vec3 nB = normalize(posBody / (uRadii * uRadii));
  s.viewPos = viewPos;
  s.viewDir = normalize(-viewPos);
  s.normalBody = nB;
  s.normal = normalize(uBodyToWorld * nB);
  s.up = s.normal;
  s.dirBody = dirB;
  s.uv = vec2(atan(dirB.y, dirB.x) * 0.15915494309 + 0.5, asin(clamp(dirB.z, -1.0, 1.0)) * 0.31830988618 + 0.5);
  s.height = 0.0;
  s.slope = 0.0;
  s.sunDir = normalize(uSunPos - viewPos);
  s.sunIlluminance = uSunIlluminance;
  s.shadow = sunVisibility(viewPos);
  s.pixelSize = length(viewPos) * uPixelAngle;
  s.localPos = posBody;
  for (int k2 = 0; k2 < SURFACE_DETAIL_BANDS; k2++) s.detailOrigin[k2] = vec3(0.0);
  vec3 L = shadeSurface(s);
  gl_FragColor = vec4(min(max(L, 0.0) * uExposure * uFade, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT_AT(k);
}
