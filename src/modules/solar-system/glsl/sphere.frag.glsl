// Cube-sphere surface fragment main (solar-system 'sphere' provider). sphere.ts prepends the
// depth, SurfaceInput, shadows, phase and equirect chunks plus the body's SurfaceShading GLSL
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
void main() {
  SurfaceInput s;
  vec3 dirB = normalize(vPosBody);
  vec3 nB = normalize(vPosBody / (uRadii * uRadii));
  s.viewPos = vViewPos;
  s.viewDir = normalize(-vViewPos);
  s.normalBody = nB;
  s.normal = normalize(uBodyToWorld * nB);
  s.up = s.normal;
  s.dirBody = dirB;
  s.uv = vec2(atan(dirB.y, dirB.x) * 0.15915494309 + 0.5, asin(clamp(dirB.z, -1.0, 1.0)) * 0.31830988618 + 0.5);
  s.height = 0.0;
  s.slope = 0.0;
  s.sunDir = normalize(uSunPos - vViewPos);
  s.sunIlluminance = uSunIlluminance;
  s.shadow = sunVisibility(vViewPos);
  s.pixelSize = length(vViewPos) * uPixelAngle;
  s.localPos = vPosBody;
  for (int k = 0; k < SURFACE_DETAIL_BANDS; k++) s.detailOrigin[k] = vec3(0.0);
  vec3 L = shadeSurface(s);
  gl_FragColor = vec4(min(max(L, 0.0) * uExposure * uFade, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
