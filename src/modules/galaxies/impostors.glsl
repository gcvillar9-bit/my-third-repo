// Galaxy impostors (background layer): one instanced quad per candidate galaxy (compacted on the CPU), faded unless
// the galaxy's angular radius exceeds a few pixels. Disc galaxies are drawn as their projected ellipse
// (major axis = disc line of nodes, minor axis foreshortened by |n·v|, floored for edge-on discs) with
// the face-on morphology sprite rotated into place; ellipticals are axis-ratio billboards. Surface
// brightness L = E / Ω is independent of distance, so the quad carries the galaxy's integrated flux.
varying vec2 vUv;
varying vec2 vTile;
varying vec3 vWarm;
varying vec3 vCool;
uniform vec2 uTileSize;  // tile size in atlas uv
#ifdef COSMOS_VERTEX
attribute vec3 iPos;     // Mpc, universe frame
attribute vec4 iQuat;    // galaxy-local → universe (normalised int8)
attribute float iRadius; // kpc
attribute float iAbsMag;
attribute float iType;
uniform float uLumScale; // LUX_MAG0 · exposure
uniform float uPixelAngle;
uniform vec3 uSunPos;
uniform float uPanoFade;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uSpriteGain[6];
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
int morph(int t) {
  if (t <= 7) return 0;
  if (t == 8) return 1;
  if (t == 9 || t == 10) return 2;
  if (t == 11) return 3;
  if (t <= 14) return 4;
  return 5;
}
void cull() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUv = vec2(0.0);
  vTile = vec2(0.0);
  vWarm = vec3(0.0);
  vCool = vec3(0.0);
}
void main() {
  vec3 rel = rteRelative(iPos);
  float d = max(length(rel), 1e-9);
  float R = iRadius * 1e-3;
  float rpx = R / (d * uPixelAngle);
  float w = smoothstep(IMPOSTOR_LO, IMPOSTOR_HI, rpx) * smoothstep(0.6, 1.5, d / R);
  float mSun = iAbsMag + 25.0 + 5.0 * log2(max(length(iPos - uSunPos), 1e-9)) * 0.30102999566;
  if (mSun < PANO_MAG) w *= uPanoFade;
  if (w < 1e-3) { cull(); return; }
  vec3 v = rel / d;
  vec4 q = normalize(iQuat);
  vec3 ex = qrot(q, vec3(1.0, 0.0, 0.0));
  vec3 ey = qrot(q, vec3(0.0, 1.0, 0.0));
  vec3 n = qrot(q, vec3(0.0, 0.0, 1.0));
  int t = int(iType + 0.5);
  int k = morph(t);
  vec3 a;
  vec3 b;
  vec2 A2 = vec2(1.0, 0.0);
  vec2 B2 = vec2(0.0, 1.0);
  float c;
  if (k == 0) {
    vec3 px = ex - v * dot(ex, v);
    a = length(px) > 1e-4 ? normalize(px) : normalize(cross(v, abs(v.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    b = cross(v, a);
    c = mix(1.0 - 0.1 * float(t), 1.0, abs(dot(ex, v)));
  } else {
    vec3 ax = cross(v, n);
    float la = length(ax);
    a = la > 1e-4 ? ax / la : ex;
    b = cross(v, a);
    vec3 bd = cross(n, a);
    bd *= dot(bd, b) < 0.0 ? -1.0 : 1.0;
    c = max(abs(dot(n, v)), 0.15);
    A2 = vec2(dot(a, ex), dot(a, ey));
    B2 = vec2(dot(bd, ex), dot(bd, ey));
  }
  float lum = uLumScale * exp2(-1.3287712380 * (iAbsMag + 25.0)) / (4.0 * R * R * c) * w * uSpriteGain[k];
  if (lum < 1e-6) { cull(); return; }
  vec2 corner = position.xy;
  vec3 p = v + (R / d) * (corner.x * a + corner.y * c * b);  // scaled by 1/d: projection-invariant
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(p, 1.0));
  vUv = corner.x * A2 + corner.y * B2;
  vTile = vec2(float(k % 3), float(k / 3)) * uTileSize;
  vWarm = uWarm * lum;
  vCool = uCool * lum;
}
#else
uniform sampler2D uAtlas;
void main() {
  if (max(abs(vUv.x), abs(vUv.y)) > 1.0) discard;
  vec4 s = texture2D(uAtlas, vTile + (vUv * 0.5 + 0.5) * uTileSize);
  gl_FragColor = vec4(vWarm * (s.r * s.r) + vCool * (s.g * s.g), 1.0);
}
#endif
