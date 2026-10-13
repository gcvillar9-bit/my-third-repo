// GalaxyModel, GLSL twin of components()/dustKappa()/skyLuminance() in model.ts. Prefixed with
// modelGlslDefines(). The planar arm field comes from the baked uArmField texture (armfield.glsl).
uniform sampler2D uArmField;

void mwSample(vec3 p, out vec3 j, out float kappa) {
  vec4 f = texture2D(uArmField, p.xy / (2.0 * MW_RMAX) + 0.5);
  float R = length(p.xy);
  float az = abs(p.z);
  float hr = R / MW_HOLE_R;
  float hole = 1.0 - MW_HOLE_DEPTH * exp(-hr * hr);
  float thin = MW_THIN_J0 * exp(-(R - MW_R0) / MW_THIN_HR - az / MW_THIN_HZ) * hole * (1.0 + MW_OLD_CONTRAST * f.y);
  float thick = MW_THIN_J0 * MW_THICK_NORM * exp(-(R - MW_R0) / MW_THICK_HR - az / MW_THICK_HZ);
  float xb = -p.x * MW_BAR_C + p.y * MW_BAR_S;
  float yb = p.x * MW_BAR_S + p.y * MW_BAR_C;
  float qx = xb / MW_BULGE_X0;
  float qy = yb / MW_BULGE_Y0;
  float q = qx * qx + qy * qy;
  float zz = p.z / MW_BULGE_Z0;
  zz *= zz;
  float bulge = MW_BULGE_J0 * exp(-0.5 * sqrt(q * q + zz * zz));
  float bar = MW_BAR_J0 * exp(-pow(abs(xb) / MW_BAR_L, MW_BAR_N) - abs(yb) / MW_BAR_YS - az / MW_BAR_ZS);
  float radial = exp(-(R - MW_R0) / MW_YOUNG_HR);
  float young = MW_YOUNG_J0 * radial * exp(-az / MW_YOUNG_HZ) * f.x;
  float hii = MW_HII_J0 * radial * exp(-az / MW_HII_HZ) * f.w;
  j = thin * MW_COL_THIN + thick * MW_COL_THICK + bulge * MW_COL_BULGE + bar * MW_COL_BAR + young * MW_COL_YOUNG +
    hii * MW_COL_HII;
  kappa = MW_DUST_K0 * exp(-(R - MW_R0) / MW_DUST_HR - az / MW_DUST_HZ) * (1.0 + MW_DUST_ARM * f.z);
}

// Ray segment inside the bounding cylinder (x = t0, y = t1; empty when y <= x).
vec2 mwClip(vec3 ro, vec3 rd) {
  float t0 = 0.0;
  float t1 = 1e9;
  if (abs(rd.z) < 1e-9) {
    if (abs(ro.z) > MW_ZMAX) return vec2(1.0, 0.0);
  } else {
    float a = (-MW_ZMAX - ro.z) / rd.z;
    float b = (MW_ZMAX - ro.z) / rd.z;
    t0 = max(t0, min(a, b));
    t1 = min(t1, max(a, b));
  }
  float A = dot(rd.xy, rd.xy);
  float B = dot(ro.xy, rd.xy);
  float C = dot(ro.xy, ro.xy) - MW_RMAX * MW_RMAX;
  if (A < 1e-12) {
    if (C > 0.0) return vec2(1.0, 0.0);
  } else {
    float disc = B * B - A * C;
    if (disc <= 0.0) return vec2(1.0, 0.0);
    float s = sqrt(disc);
    t0 = max(t0, (-B - s) / A);
    t1 = min(t1, (-B + s) / A);
  }
  return vec2(t0, t1);
}

// Emission + dust absorption along a ray (model kpc): Lsun pc^-3 · kpc, weighted by the component colours.
vec3 mwMarch(vec3 ro, vec3 rd, int steps, float jitter) {
  vec2 seg = mwClip(ro, rd);
  if (seg.y <= seg.x) return vec3(0.0);
  bool quad = abs(ro.z) < MW_ZMAX && length(ro.xy) < MW_RMAX;
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  float fs = float(steps);
  for (int i = 0; i < 256; i++) {
    if (i >= steps) break;
    float u0 = float(i) / fs;
    float u1 = float(i + 1) / fs;
    if (quad) {
      u0 *= u0;
      u1 *= u1;
    }
    float ta = seg.x + (seg.y - seg.x) * u0;
    float dt = (seg.y - seg.x) * (u1 - u0);
    vec3 j;
    float k;
    mwSample(ro + rd * (ta + dt * jitter), j, k);
    vec3 tau = k * MW_REDDEN * dt;
    vec3 att = exp(-tau);
    vec3 fct = mix(vec3(1.0), (1.0 - att) / max(tau, vec3(1e-6)), step(vec3(1e-4), tau));
    L += T * j * dt * fct;
    T *= att;
    if (T.r < 1e-3 && T.g < 1e-3 && T.b < 1e-3) break;
  }
  return L;
}
