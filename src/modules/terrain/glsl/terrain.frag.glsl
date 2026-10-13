// Terrain patch fragment main. render.ts prepends the depth, SurfaceInput, shadows and noise
// chunks plus the body's SurfaceShading GLSL (shadeSurface), the same shading the sphere uses.
// Fragment detail: periodic noise anchored at Float64 per-band origins (no jitter at 1 m bands),
// perturbing the normal and modulating radiance, filtered by pixel footprint.
uniform float uExposure;
uniform float uPixelAngle;
uniform float uMorph;
uniform vec3 uRadii;
uniform mat3 uBodyToWorld;
uniform vec3 uSunPos;         // camera-relative Sun centre, world axes, m
uniform vec3 uSunIlluminance; // lux per channel at the body
uniform vec3 uDetailOrigin[SURFACE_DETAIL_BANDS];
uniform float uDetailStrength;
varying vec3 vViewPos;
varying vec3 vDirBody;
varying vec3 vNormalBody;
varying float vHeight;

void main() {
  SurfaceInput s;
  vec3 dirB = normalize(vDirBody);
  vec3 upB = normalize(dirB / (uRadii * uRadii));
  vec3 nB = normalize(vNormalBody);
  s.viewPos = vViewPos;
  s.viewDir = normalize(-vViewPos);
  s.dirBody = dirB;
  s.uv = vec2(atan(dirB.y, dirB.x) * 0.15915494309 + 0.5, asin(clamp(dirB.z, -1.0, 1.0)) * 0.31830988618 + 0.5);
  s.height = vHeight;
  s.sunDir = normalize(uSunPos - vViewPos);
  s.sunIlluminance = uSunIlluminance;
  s.shadow = sunVisibility(vViewPos);
  s.pixelSize = length(vViewPos) * uPixelAngle;
  s.localPos = transpose(uBodyToWorld) * vViewPos;
  for (int k = 0; k < SURFACE_DETAIL_BANDS; k++) s.detailOrigin[k] = uDetailOrigin[k];
  s.up = normalize(uBodyToWorld * upB);

  // Band-limited detail: bands whose wavelength spans more than ~4 pixels.
  float albedoMod = 0.0;
  vec3 g = vec3(0.0);
  vec3 P = vec3(SURFACE_NOISE_PERIOD);
  float lambda = 10000.0;
  // Footprint along the view direction grows at grazing angles: filter by the long axis.
  float footprint = s.pixelSize / max(abs(dot(s.viewDir, s.up)), 0.05);
  for (int k = 0; k < SURFACE_DETAIL_BANDS; k++) {
    float w = smoothstep(2.0, 4.0, lambda / max(footprint, 1e-6)) * uMorph * uDetailStrength;
    if (w > 0.001) {
      vec3 q = s.detailOrigin[k] + s.localPos / lambda;
      float n0 = pnoise(q, P);
      float e = 0.05;
      vec3 d = vec3(pnoise(q + vec3(e, 0.0, 0.0), P), pnoise(q + vec3(0.0, e, 0.0), P), pnoise(q + vec3(0.0, 0.0, e), P)) - n0;
      g += w * 0.12 * d / e;
      albedoMod += w * 0.06 * n0;
    }
    lambda *= 0.1;
  }
  nB = normalize(nB - (g - dot(g, nB) * nB));
  s.normalBody = nB;
  s.normal = normalize(uBodyToWorld * nB);
  s.slope = 1.0 - dot(s.normal, s.up);
  vec3 L = shadeSurface(s) * (1.0 + albedoMod);
  gl_FragColor = vec4(min(max(L, 0.0) * uExposure, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
