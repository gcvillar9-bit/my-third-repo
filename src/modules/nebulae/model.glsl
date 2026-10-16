// Orion Nebula column model (GLSL twin of model.ts; prefixed with nebulaGlslDefines()). Local frame in pc:
// origin θ¹ Ori C, x east, y north, z away from Earth. A column is an Earth ray (ξ, η) = xy / (D + z).

float nebSmooth(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Smooth ionization-front depth under sky-plane position X (pc), with the Orion Bar escarpment.
float nebBowlZ(vec2 X) {
  float z = NEB_Z0 - NEB_BOWL_DEPTH * (1.0 - exp(-dot(X, X) / NEB_BOWL_2S2));
  float across = dot(X, NEB_BAR_N) - NEB_BAR_D;
  float along = -X.x * NEB_BAR_N.y + X.y * NEB_BAR_N.x;
  z -= NEB_BAR_RISE * nebSmooth(-NEB_BAR_W, NEB_BAR_W, across) *
    (1.0 - nebSmooth(NEB_BAR_LEN * 0.5, NEB_BAR_LEN, abs(along)));
  return z;
}

float nebThickness(float rho, float noise) {
  return (NEB_T_CORE + (NEB_T_OUTER - NEB_T_CORE) * nebSmooth(0.0, NEB_T_R, rho)) * (1.0 + NEB_T_NOISE * noise);
}

// Layer stack of a column. maps = (tau_V of the lanes, displacement, thickness noise).
// sheet = (z, half-thickness, w43, -), m43 = (z, half), veil = (z, half, tau), omc = (z, half, tau).
struct NebLayers {
  vec4 sheet;
  vec2 m43;
  vec3 veil;
  vec3 omc;
};

NebLayers nebColumn(vec2 X, vec3 maps) {
  NebLayers L;
  float rho = length(X);
  float t = nebThickness(rho, maps.z);
  float hw = 0.5 * t;
  float zs = nebBowlZ(X) + NEB_DISP * t * maps.y;
  float r43 = length(X - NEB_M43);
  float w43 = 1.0 - nebSmooth(0.7 * NEB_M43_R, NEB_M43_R, r43);
  float h43 = max(sqrt(max(NEB_M43_R * NEB_M43_R - r43 * r43, 0.0)), 0.05 * NEB_M43_R);
  L.sheet = vec4(zs, hw, w43, 0.0);
  L.m43 = vec2(0.0, h43);
  float front = min(zs - hw, w43 > 0.0 ? -h43 : 1e9);
  float back = max(zs + hw, w43 > 0.0 ? h43 : -1e9);
  float veilTau = min(maps.x + NEB_VEIL_BASE_TAU * (1.0 - nebSmooth(0.5 * NEB_VEIL_BASE_R, 1.5 * NEB_VEIL_BASE_R, rho)), NEB_TAU_MAX);
  L.veil = vec3(min(NEB_VEIL_Z, front - NEB_GAP - NEB_VEIL_HW), NEB_VEIL_HW, veilTau);
  L.omc = vec3(back + NEB_OMC_GAP + NEB_OMC_HW, NEB_OMC_HW, NEB_OMC_TAU * (1.0 - nebSmooth(NEB_OMC_R0, NEB_OMC_R1, rho)));
  return L;
}

float nebCdf(float u) { return nebSmooth(-1.0, 1.0, u); }
float nebPdf(float u) { return abs(u) < 1.0 ? 0.75 * (1.0 - u * u) : 0.0; }

// Fraction of a layer's column crossed by a segment (u linear from ua to ub; dtOverHw = length / half-thickness).
float nebFraction(float ua, float ub, float dtOverHw) {
  float du = ub - ua;
  if (abs(du) < 1e-4) return nebPdf(0.5 * (ua + ub)) * dtOverHw;
  return (nebCdf(ub) - nebCdf(ua)) / du * dtOverHw;
}

float nebCentre(float ua, float ub) {
  float du = ub - ua;
  if (abs(du) < 1e-4) return 0.5;
  return clamp(-ua / du, 0.0, 1.0);
}

float nebEdge(vec2 xe) {
  return 1.0 - nebSmooth(NEB_EDGE, 1.0, max(abs(xe.x), abs(xe.y)) / NEB_XI_MAX);
}
