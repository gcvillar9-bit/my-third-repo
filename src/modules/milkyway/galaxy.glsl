// GalaxyModel, GLSL twin of components()/dustKappa()/skyLuminance() in model.ts. Prefixed with
// modelGlslDefines(). The planar arm field comes from the baked uArmField texture (armfield.glsl).
uniform sampler2D uArmField;
// Measured dust near the Sun (Edenhofer et al. 2024, tools/milkyway/volumes/dust.mjs): a cube in
// model axes centred on the Sun and the vertical optical depth through the map. Both store
// sqrt(value / max). Absent until the atlas has loaded them (uDustOn = 0).
precision lowp sampler3D;
uniform sampler3D uDust3D;      // 8 pc voxels
uniform sampler3D uDustCoarse;  // the same cube averaged to 32 pc voxels
uniform sampler2D uDustCol;
uniform float uDustOn;
uniform vec3 uDustHalf;   // half extents of the cube, kpc
uniform vec2 uDustMax;    // kappaMax (1/kpc), tauMax
uniform vec2 uDustFade;   // the measured dust fades into the model's between these radii, kpc
#define DUST_SUBSTEPS 6

// Measured opacity (1/kpc) at offset d from the Sun (model axes, kpc), model height z, for a
// sample that stands for a path of length ds: the fine cube for short paths, the coarse cube for
// medium ones, and for long ones (which would miss the thin clouds) the measured vertical optical
// depth spread over the model's dust layer.
float mwMeasuredDust(vec3 d, float z, float ds) {
  float toCoarse = smoothstep(0.010, 0.020, ds);
  float toSheet = smoothstep(0.048, 0.110, ds);
  vec3 uvw = d / (2.0 * uDustHalf) + 0.5;
  float k = 0.0;
  if (toSheet < 1.0 && abs(d.z) < uDustHalf.z) {
    if (toCoarse < 1.0) {
      float v = texture(uDust3D, uvw).r;
      k += (1.0 - toCoarse) * v * v;
    }
    if (toCoarse > 0.0) {
      float v = texture(uDustCoarse, uvw).r;
      k += toCoarse * v * v;
    }
    k *= uDustMax.x;
  }
  if (toSheet > 0.0) {
    float c = texture2D(uDustCol, uvw.xy).r;
    k = mix(k, uDustMax.y * c * c * exp(-abs(z) / MW_DUST_HZ) / (2.0 * MW_DUST_HZ), toSheet);
  }
  return k;
}

void mwSample(vec3 p, vec3 rd, float dt, out vec3 j, out float kappa) {
  vec4 f = texture2D(uArmField, p.xy / (2.0 * MW_RMAX) + 0.5);
  float R = length(p.xy);
  // Disc components follow the warped mid-plane (Chen et al. 2019) and flare outwards
  // (Lopez-Corredoira & Molgo 2014) at constant surface brightness; twin of model.ts.
  float zw = smoothstep(MW_R0, MW_R0 + MW_WARP_BLEND, R) * MW_WARP_A * pow(max(R - MW_WARP_RW, 0.0), MW_WARP_B) *
    (p.y * MW_WARP_C + p.x * MW_WARP_S) / max(R, 1e-4);
  float az = abs(p.z - zw);
  float xf = max(R - MW_FLARE_SUN_R, 0.0);
  float ft = 1.0 + xf * (MW_FLARE_THIN_K1 + MW_FLARE_THIN_K2 * xf);
  float xk = max(R, MW_FLARE_SUN_R) - MW_FLARE_THICK_R;
  float fk = (1.0 + xk * (MW_FLARE_THICK_K1 + MW_FLARE_THICK_K2 * xk)) * MW_FLARE_THICK_NORM;
  float hr = R / MW_HOLE_R;
  float hole = 1.0 - MW_HOLE_DEPTH * exp(-hr * hr);
  float thin = MW_THIN_J0 * exp(-(R - MW_R0) / MW_THIN_HR - az / (MW_THIN_HZ * ft)) / ft * hole * (1.0 + MW_OLD_CONTRAST * f.y);
  // MW_THICK_NORM: thick/thin ratio of the mid-plane density at the Sun (not of the surface density).
  float thick = MW_THIN_J0 * MW_THICK_NORM * exp(-(R - MW_R0) / MW_THICK_HR - az / (MW_THICK_HZ * fk)) / fk;
  // One bar frame (bar.angleDeg) for the bulge and the long bar; bulge axes MW_BULGE_X0 : Y0 : Z0.
  float xb = -p.x * MW_BAR_C + p.y * MW_BAR_S;
  float yb = p.x * MW_BAR_S + p.y * MW_BAR_C;
  float qx = xb / MW_BULGE_X0;
  float qy = yb / MW_BULGE_Y0;
  float q = qx * qx + qy * qy;
  float zz = p.z / MW_BULGE_Z0;
  zz *= zz;
  float bulge = MW_BULGE_J0 * exp(-0.5 * sqrt(q * q + zz * zz));
  float bar = MW_BAR_J0 * exp(-pow(abs(xb) / MW_BAR_L, MW_BAR_N) - abs(yb) / MW_BAR_YS - abs(p.z) / MW_BAR_ZS);
  float radial = exp(-(R - MW_R0) / MW_YOUNG_HR);
  float young = MW_YOUNG_J0 * radial * exp(-az / MW_YOUNG_HZ) * f.x;
  float hii = MW_HII_J0 * radial * exp(-az / MW_HII_HZ) * f.w;
  j = thin * MW_COL_THIN + thick * MW_COL_THICK + bulge * MW_COL_BULGE + bar * MW_COL_BAR + young * MW_COL_YOUNG +
    hii * MW_COL_HII;
  kappa = MW_DUST_K0 * exp(-(R - MW_R0) / MW_DUST_HR - az / MW_DUST_HZ) * (1.0 + MW_DUST_ARM * f.z);
  if (uDustOn > 0.0) {
    vec3 d = p - MW_SUN;
    float w = uDustOn * (1.0 - smoothstep(uDustFade.x, uDustFade.y, length(d)));
    if (w > 0.0) {
      // Average the measured dust over the step (up to DUST_SUBSTEPS samples about 32 pc apart).
      float n = clamp(ceil(dt / 0.032), 1.0, float(DUST_SUBSTEPS));
      float km = 0.0;
      for (int i = 0; i < DUST_SUBSTEPS; i++) {
        if (float(i) >= n) break;
        vec3 o = rd * (((float(i) + 0.5) / n - 0.5) * dt);
        km += mwMeasuredDust(d + o, p.z + o.z, dt / n);
      }
      kappa = mix(kappa, km / n, w);
    }
  }
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
    mwSample(ro + rd * (ta + dt * jitter), rd, dt, j, k);
    vec3 tau = k * MW_REDDEN * dt;
    vec3 att = exp(-tau);
    vec3 fct = mix(vec3(1.0), (1.0 - att) / max(tau, vec3(1e-6)), step(vec3(1e-4), tau));
    L += T * j * dt * fct;
    T *= att;
    if (T.r < 1e-3 && T.g < 1e-3 && T.b < 1e-3) break;
  }
  return L;
}
