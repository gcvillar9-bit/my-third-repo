// Strong-field lensing at reduced resolution: per-pixel RK4 on x'' = -1.5 h² x / r⁵ (r_s = 1),
// steps proportional to r, thin-disk crossings interpolated, RIAF glow accumulated per step.
// Pixels whose straight ray misses the marched sphere fall back to the weak-field LUT so the
// composite can blend across the boundary. Preceded by DEPTH, BLACKBODY, NOISE, lens-common, disk.
varying vec2 vUv;
uniform int uSteps;
uniform float uStepK;
uniform int uDiskMode;      // 0 none, 1 thin opaque disk, 2 RIAF glow
uniform float uFullMarch;   // 1 when the camera is inside (or close to) the marched sphere

void rk4(inout vec3 x, inout vec3 v, float k, float dt) {
  // a(x) = k x / r^5 with k = -1.5 h²
  vec3 x1 = x;
  float r2 = dot(x1, x1);
  vec3 a1 = k * x1 / (r2 * r2 * sqrt(r2));
  vec3 x2 = x + 0.5 * dt * v;
  vec3 v2 = v + 0.5 * dt * a1;
  r2 = dot(x2, x2);
  vec3 a2 = k * x2 / (r2 * r2 * sqrt(r2));
  vec3 x3 = x + 0.5 * dt * v2;
  vec3 v3 = v + 0.5 * dt * a2;
  r2 = dot(x3, x3);
  vec3 a3 = k * x3 / (r2 * r2 * sqrt(r2));
  vec3 x4 = x + dt * v3;
  vec3 v4 = v + dt * a3;
  r2 = dot(x4, x4);
  vec3 a4 = k * x4 / (r2 * r2 * sqrt(r2));
  x += dt / 6.0 * (v + 2.0 * v2 + 2.0 * v3 + v4);
  v += dt / 6.0 * (a1 + 2.0 * a2 + 2.0 * a3 + a4);
}

void main() {
  vec3 d = viewRay(vUv);
  float zl = linearFromLogDepth(texture(uDepth, vUv).r);
  if (zl < uHoleDist - uBoundM) {
    gl_FragColor = vec4(texture(uInput, vUv).rgb, 1.0);
    return;
  }
  float D = uDistRs;
  vec3 x;
  vec3 v;
  float bPhys;
  float preBend = 0.0;
  if (uFullMarch < 0.5) {
    vec3 s = cross(uCamDir, d);
    float b = D * length(s);
    float cosPsi = -dot(uCamDir, d);
    if (cosPsi <= 0.0 || b >= uRBound) {
      gl_FragColor = vec4(sky(weakLensDir(d)), 1.0);
      return;
    }
    float half_ = sqrt(max(uRBound * uRBound - b * b, 0.0));
    x = D * cross(d, s) - d * half_;
    v = d;
    bPhys = b;
    preBend = uBend * (cosPsi - half_ / uRBound) / max(b, 1.0);
  } else {
    x = uCamDir * D;
    vec3 rh = uCamDir;
    float dr = dot(d, rh);
    v = d + (sqrt(max(1.0 - 1.0 / D, 0.0)) - 1.0) * dr * rh;
    bPhys = D * length(cross(rh, d)) / sqrt(max(1.0 - 1.0 / D, 1e-4));
  }
  vec3 hv = cross(x, v);
  float hl = length(hv);
  float k = -1.5 * uBend * hl * hl;
  // Photon angular momentum about the disk axis per unit energy (the photon travels along -v).
  float lambda = hl > 1e-6 ? -bPhys * dot(hv / hl, uDiskN) : 0.0;
  float rEsc = max(uRBound, D) * 1.02;

  vec3 col = vec3(0.0);
  bool captured = false;
  bool escaped = false;
  bool blocked = false;
  for (int i = 0; i < 512; i++) {
    if (i >= uSteps) break;
    float r = length(x);
    float dt = uStepK * r;
    vec3 x0 = x;
    rk4(x, v, k, dt);
    float r1 = length(x);
    if (uDiskMode == 1) {
      float s0 = dot(x0, uDiskN);
      float s1 = dot(x, uDiskN);
      if (s0 * s1 < 0.0) {
        vec3 xc = mix(x0, x, s0 / (s0 - s1));
        float rc = length(xc);
        if (rc > uDiskIn && rc < uDiskOut) {
          col += thinDisk(xc, rc, lambda);
          blocked = true;
          break;
        }
      }
    } else if (uDiskMode == 2) {
      col += riafGlow(0.5 * (x0 + x), 0.5 * (r + r1), lambda) * length(x - x0);
    }
    if (r1 < 1.0) {
      captured = true;
      break;
    }
    if (r1 > rEsc && dot(x, v) > 0.0) {
      escaped = true;
      break;
    }
  }
  if (!captured && !blocked && (escaped || dot(x, v) > 0.0)) {
    vec3 vd = normalize(v);
    vec3 xh = normalize(x);
    float bb = length(cross(x, vd));
    float post = uBend * (1.0 - dot(xh, vd)) / max(bb, 1.0);
    col += sky(bendToward(vd, -xh, post + preBend));
  }
  gl_FragColor = vec4(col, 1.0);
}
