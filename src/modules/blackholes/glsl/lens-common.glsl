// Shared by the lensing march and composite passes. Units: r_s = 1 for geodesics, metres for depth.
// Requires DEPTH_GLSL (linearFromLogDepth) before this chunk.
uniform sampler2D uInput;      // HDR scene (pre-exposed), full resolution
uniform sampler2D uDepth;      // main-scene log depth (background = 1)
uniform samplerCube uSkyCube;  // background captured at the camera (world axes)
uniform float uCubeReady;
uniform float uCubeScale;      // exposure now / exposure at capture
uniform mat3 uCamToWorld;      // camera rotation (camera at the origin)
uniform mat4 uViewProj;        // projection * view (rotation only)
uniform vec2 uTanHalf;         // tan(fovX/2), tan(fovY/2)
uniform vec3 uHoleDir;         // unit, camera -> hole, world axes
uniform vec3 uCamDir;          // unit, hole -> camera, world axes
uniform float uHoleDist;       // camera-hole distance, m
uniform float uDistRs;         // camera-hole distance, r_s
uniform float uRBound;         // radius of the marched sphere, r_s
uniform float uBoundM;         // uRBound in metres (foreground test)
uniform sampler2D uDeflLut;    // f(b) = alpha(b) b / 2 on a log-b grid (exact Schwarzschild)
uniform vec3 uDeflRange;       // log bMin, log bMax, LUT size
uniform float uBend;           // 1 = lensing on, 0 = straight rays

vec3 viewRay(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  return normalize(uCamToWorld * vec3(ndc * uTanHalf, -1.0));
}

// Total bending angle of a ray from infinity to infinity with impact parameter b (r_s).
float deflection(float b) {
  float t = (log(b) - uDeflRange.x) / (uDeflRange.y - uDeflRange.x);
  if (t >= 1.0) return 2.0 / b;
  float n = uDeflRange.z;
  float f = texture(uDeflLut, vec2((clamp(t, 0.0, 1.0) * (n - 1.0) + 0.5) / n, 0.5)).r;
  return 2.0 * f / b;
}

// Rotates unit d towards unit h by angle a (in the plane of d and h).
vec3 bendToward(vec3 d, vec3 h, float a) {
  vec3 t = h - d * dot(d, h);
  float tl = length(t);
  if (tl < 1e-9 || a == 0.0) return d;
  t /= tl;
  return cos(a) * d + sin(a) * t;
}

// Radiance arriving from direction `dir` without the hole: the on-screen scene when it lies
// behind the hole, else the captured background cube.
vec3 sky(vec3 dir) {
  vec4 clip = uViewProj * vec4(dir, 0.0);
  if (clip.w > 0.0) {
    vec2 ndc = clip.xy / clip.w;
    if (abs(ndc.x) < 0.995 && abs(ndc.y) < 0.995) {
      vec2 uv = ndc * 0.5 + 0.5;
      if (linearFromLogDepth(texture(uDepth, uv).r) > uHoleDist) return texture(uInput, uv).rgb;
    }
  }
  return uCubeReady > 0.5 ? textureLod(uSkyCube, dir, 0.0).rgb * uCubeScale : vec3(0.0);
}

// Weak-field lensing outside the marched sphere: the bending accumulated from the camera to
// infinity, alpha(b) (1 + cos psi) / 2, for sources at infinity.
vec3 weakLensDir(vec3 d) {
  float c = dot(d, uHoleDir);
  float b = uDistRs * length(cross(d, uHoleDir));
  float a = uBend * deflection(max(b, 2.6)) * 0.5 * (1.0 + c);
  return bendToward(d, uHoleDir, a);
}
