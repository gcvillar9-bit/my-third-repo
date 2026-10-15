// Reduced-resolution ray march of the Orion Nebula over the screen rect of its box (GLSL twin of marchRay in
// model.ts). Writes the radiance of the three components (Hα+[NII], [OIII]+Hβ, scattered; cd/m² · uStore) and the
// V-band opacity 1 - T of the background. Exposure-independent, so the result is cached while the view is still.
// Prefixed with nebulaGlslDefines() + model.glsl.
uniform sampler2D uEmission;  // observed column radiance per component, (L / NEB_LREF)^(1 / NEB_ENC)
uniform sampler2D uMaps;      // tau_V / NEB_TAU_MAX, displacement, thickness noise (0.5 = 0)
uniform sampler2D uCore;      // Hubble detail ratio, 0.5 + log2(ratio) / (2 NEB_CORE_SPAN)
uniform sampler2D uBlueNoise;
uniform vec3 uOrigin;         // camera, local pc
uniform mat3 uRayBasis;       // columns: right · tan(fovX/2), up · tan(fovY/2), forward (local axes)
uniform vec4 uRect;           // NDC rect covered by this target (x0, y0, x1, y1)
uniform int uSteps;
uniform float uStore;
uniform float uJitterOffset;
uniform float uPixelAngle;    // radians per march pixel
uniform float uHasCore;
varying vec2 vUv;

struct NebPoint {
  float z;
  vec3 S;
  NebLayers L;
};

NebPoint nebEval(vec3 ro, vec3 rd, float t) {
  vec3 p = ro + rd * t;
  vec2 xe = p.xy / (NEB_D + p.z);
  vec2 uv = vec2(0.5 - xe.x * (0.5 / NEB_XI_MAX), 0.5 + xe.y * (0.5 / NEB_XI_MAX));
  float lod = log2(max(t * uPixelAngle / NEB_TEXEL_PC, 1.0));
  vec3 S = NEB_LREF * pow(textureLod(uEmission, uv, lod).rgb, vec3(NEB_ENC));
  vec3 m = textureLod(uMaps, uv, max(lod - 1.0, 0.0)).rgb; // maps are half the emission resolution
  vec3 maps = vec3(m.x * NEB_TAU_MAX, m.y * 2.0 - 1.0, m.z * 2.0 - 1.0);
  if (uHasCore > 0.5) {
    vec2 cuv = vec2(0.5 - xe.x * (0.5 / NEB_CORE_XI), 0.5 + xe.y * (0.5 / NEB_CORE_XI));
    if (all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0)))) {
      float clod = log2(max(t * uPixelAngle / NEB_CORE_TEXEL_PC, 1.0));
      S *= exp2((textureLod(uCore, cuv, clod).r - 0.5) * 2.0 * NEB_CORE_SPAN);
    }
  }
  float edge = nebEdge(xe);
  S *= edge;
  maps.x *= edge;
  NebPoint q;
  q.z = p.z;
  q.S = S;
  q.L = nebColumn(xe * NEB_D, maps);
  return q;
}

// Sheet tracing: the vertical gap to the nearest emitting layer sets the next step.
float nebStep(NebPoint p, float base) {
  float gap = abs(p.z - p.L.sheet.x) - p.L.sheet.y;
  if (p.L.sheet.z > 0.0) gap = min(gap, abs(p.z - p.L.m43.x) - p.L.m43.y);
  return clamp(0.8 * gap, NEB_MIN_STEP * base, NEB_MAX_STEP * base);
}

float nebBefore(float cE, float cA) { return nebSmooth(-0.05, 0.05, cE - cA); }

// One segment a -> b: radiance into Lsum, transmittance per component (xyz) and in V (w) into T.
void nebSegment(NebPoint a, NebPoint b, float dt, inout vec4 T, inout vec3 Lsum) {
  float sUa = (a.z - a.L.sheet.x) / a.L.sheet.y;
  float sUb = (b.z - b.L.sheet.x) / b.L.sheet.y;
  float fSheet = nebFraction(sUa, sUb, dt / (0.5 * (a.L.sheet.y + b.L.sheet.y)));
  float cSheet = nebCentre(sUa, sUb);
  float mUa = (a.z - a.L.m43.x) / a.L.m43.y;
  float mUb = (b.z - b.L.m43.x) / b.L.m43.y;
  float f43 = nebFraction(mUa, mUb, dt / (0.5 * (a.L.m43.y + b.L.m43.y)));
  float c43 = nebCentre(mUa, mUb);
  float vUa = (a.z - a.L.veil.x) / a.L.veil.y;
  float vUb = (b.z - b.L.veil.x) / b.L.veil.y;
  float tauVeil = 0.5 * (a.L.veil.z + b.L.veil.z) * nebFraction(vUa, vUb, dt / (0.5 * (a.L.veil.y + b.L.veil.y)));
  float cVeil = nebCentre(vUa, vUb);
  float oUa = (a.z - a.L.omc.x) / a.L.omc.y;
  float oUb = (b.z - b.L.omc.x) / b.L.omc.y;
  float tauOmc = 0.5 * (a.L.omc.z + b.L.omc.z) * nebFraction(oUa, oUb, dt / (0.5 * (a.L.omc.y + b.L.omc.y)));
  float cOmc = nebCentre(oUa, oUb);
  float w43 = 0.5 * (a.L.sheet.z + b.L.sheet.z);
  float veilCol = 0.5 * (a.L.veil.z + b.L.veil.z);
  vec3 s = 0.5 * (a.S + b.S) * exp(veilCol * NEB_EXT); // de-reddened by the veil in front
  vec3 eSheet = s * (1.0 - w43) * fSheet *
    exp(-NEB_EXT * (tauVeil * nebBefore(cSheet, cVeil) + tauOmc * nebBefore(cSheet, cOmc)));
  vec3 e43 = s * w43 * f43 * exp(-NEB_EXT * (tauVeil * nebBefore(c43, cVeil) + tauOmc * nebBefore(c43, cOmc)));
  Lsum += T.xyz * (eSheet + e43);
  float tau = tauVeil + tauOmc;
  T *= exp(-vec4(NEB_EXT, 1.0) * tau);
}

void main() {
  vec2 ndc = mix(uRect.xy, uRect.zw, vUv);
  vec3 rd = normalize(uRayBasis * vec3(ndc, 1.0));
  vec3 safe = vec3(abs(rd.x) < 1e-9 ? 1e-9 : rd.x, abs(rd.y) < 1e-9 ? 1e-9 : rd.y, abs(rd.z) < 1e-9 ? 1e-9 : rd.z);
  vec3 ta = (vec3(-NEB_HALF, -NEB_HALF, NEB_Z_MIN) - uOrigin) / safe;
  vec3 tb = (vec3(NEB_HALF, NEB_HALF, NEB_Z_MAX) - uOrigin) / safe;
  vec3 tmin = min(ta, tb);
  vec3 tmax = max(ta, tb);
  float t0 = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float t1 = min(min(tmax.x, tmax.y), tmax.z);
  if (t1 <= t0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float jitter = fract(texture2D(uBlueNoise, gl_FragCoord.xy / 64.0).r + uJitterOffset);
  float base = (t1 - t0) / float(uSteps);
  NebPoint a = nebEval(uOrigin, rd, t0);
  vec4 T = vec4(1.0);
  vec3 Lsum = vec3(0.0);
  float t = t0;
  for (int i = 0; i < NEB_MAX_LOOP; i++) {
    if (i >= uSteps || t >= t1 || T.w < NEB_T_EXIT) break;
    float dt = nebStep(a, base) * (i == 0 ? 0.25 + 0.75 * jitter : 1.0);
    if (i == uSteps - 1 || t + dt > t1) dt = t1 - t;
    t += dt;
    NebPoint b = nebEval(uOrigin, rd, t);
    nebSegment(a, b, dt, T, Lsum);
    a = b;
  }
  gl_FragColor = vec4(Lsum * uStore, 1.0 - T.w);
}
