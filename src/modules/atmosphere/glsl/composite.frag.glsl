// Atmosphere composite (ScreenPass stage 'atmosphere'). Depends only on the scene colour and the
// log depth texture, so it works over any geometry provider.
//   camera inside:  sky pixels -> sky-view LUT + background * transmittance LUT (stars fade in daylight);
//                   geometry nearer than uApMax -> aerial-perspective atlas; farther -> raymarch.
//   camera outside: per-pixel raymarch through the shell (limb glow, terminator, haze over the disk).
// out = in * T + L * E_sun * exposure.
uniform sampler2D uInput;
uniform sampler2D uDepth;
uniform sampler2D uSkyView;
uniform sampler2D uAerial;
uniform vec3 uSunE;       // solar illuminance at the body, lux per channel
uniform float uExposure;
uniform float uInside;
uniform float uSunTPost;  // multiply surface pixels by the Sun transmittance
uniform int uSteps;
varying vec2 vUv;

vec3 skyViewLookup(vec3 ro, float r, vec3 rd, bool hitsGround) {
  vec3 up = ro / r;
  float vzc = dot(rd, up);
  vec3 side = cross(up, rd);
  float sl = length(side);
  float lvc = 1.0;
  if (sl > 1e-5) {
    side /= sl;
    vec3 fwd = cross(side, up);
    vec2 lp = vec2(dot(uSunDir, fwd), dot(uSunDir, side));
    float ll = length(lp);
    lvc = ll > 1e-5 ? lp.x / ll : 1.0;
  }
  return texture(uSkyView, skyViewUv(r, uCamH, hitsGround, vzc, lvc)).rgb;
}

vec4 aerialSlice(vec2 uv, float slice) {
  vec2 p = clamp(uv * 32.0, vec2(0.5), vec2(31.5));
  return texture(uAerial, vec2((slice * 32.0 + p.x) / 1024.0, p.y / 32.0));
}

vec4 aerialLookup(vec2 uv, float t) {
  float s = sqrt(t / uApMax) * 32.0 - 0.5;
  if (s <= 0.0) {
    vec4 a = aerialSlice(uv, 0.0);
    float w = clamp(t / (uApMax * (0.5 / 32.0) * (0.5 / 32.0)), 0.0, 1.0);
    return vec4(a.rgb * w, mix(1.0, a.a, w));
  }
  float i0 = min(floor(s), 31.0);
  float i1 = min(i0 + 1.0, 31.0);
  return mix(aerialSlice(uv, i0), aerialSlice(uv, i1), clamp(s - i0, 0.0, 1.0));
}

void main() {
  vec3 col = texture(uInput, vUv).rgb;
  vec3 dirV = viewDirFromUv(vUv);
  vec4 ray = atmoRay(dirV);
  vec3 rd = ray.xyz;
  vec3 ro = uCamPos;
  float r = length(ro);
  vec2 top = raySphere(ro, rd, uAtmoTop);
  if (top.y <= 0.0) {
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  float d = texture(uDepth, vUv).r;
  bool bg = d >= 0.9999999;
  float tGeom = bg ? 1e30 : linearFromLogDepth(d) / max(-dirV.z, 1e-6) * 0.001 * ray.w;
  float tStart = max(top.x, 0.0);
  bool geomIn = !bg && tGeom < top.y;
  if (geomIn && tGeom <= tStart) {
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  float mu = dot(ro, rd) / r;
  float tG;
  if (uInside > 0.5) {
    tG = groundDistance(r, uCamH, mu);
  } else {
    vec2 g = raySphere(ro, rd, uAtmoBottom);
    tG = g.x > 0.0 ? g.x : -1.0;
  }
  bool hitsGround = tG > 0.0 && tG < top.y;
  float tEnd = geomIn ? tGeom : (hitsGround ? tG : top.y);
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  vec3 f = vec3(0.0);
  if (uInside > 0.5 && !geomIn) {
    L = skyViewLookup(ro, r, rd, hitsGround);
    T = hitsGround ? vec3(0.0) : texture(uTransLut, transmittanceUv(r, mu)).rgb;
  } else if (uInside > 0.5 && tGeom < uApMax) {
    vec4 ap = aerialLookup(vUv, tGeom);
    L = ap.rgb;
    T = vec3(ap.a);
  } else {
    // Split at the closest approach to the centre so limb rays get fine steps where the air is densest.
    float tc = clamp(-dot(ro, rd), tStart, tEnd);
    int n = uSteps;
    if (tc > tStart + 1e-3 && tc < tEnd - 1e-3) {
      atmoMarch(ro, rd, uSunDir, tStart, tc, n / 2, true, false, L, T, f);
      atmoMarch(ro, rd, uSunDir, tc, tEnd, n - n / 2, false, false, L, T, f);
    } else {
      atmoMarch(ro, rd, uSunDir, tStart, tEnd, n, tc >= tEnd - 1e-3, false, L, T, f);
    }
  }
  if (uSunTPost > 0.5 && geomIn) {
    vec3 P = ro + rd * tGeom;
    float rp = length(P);
    if (rp < uAtmoBottom + 0.02 * (uAtmoTop - uAtmoBottom)) {
      float rs = max(rp, uAtmoBottom + 1e-4);
      col *= texture(uTransLut, transmittanceUv(rs, dot(P, uSunDir) / rp)).rgb;
    }
  }
  vec3 outc = col * T + L * uSunE * uExposure;
  gl_FragColor = vec4(min(max(outc, 0.0), vec3(60000.0)), 1.0);
}
