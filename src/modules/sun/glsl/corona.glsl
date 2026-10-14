// sun: corona shell. A back-faced sphere of uShellR solar radii around the Sun; each fragment takes
// its view ray's impact parameter p (closest approach to the Sun's centre, solar radii) and outputs
// the Baumbach K+F brightness B(p) (about 1e-6 of the disk), shaped by streamers that depend only
// on the direction of closest approach (so every structure is radial). Physically pre-exposed:
// invisible next to the photosphere or a daylight sky, it appears when the disk is occluded
// (totality) or at very low exposure. The Moon and the disk itself occlude it through log depth.
// Prominences and the chromospheric fringe ride on the same shell near the limb (pink, H-alpha
// dominated, ~1e-5 of the disk: only in totality); in the H-alpha view they are lit relative to the
// H-alpha disk and the corona is off. The fragment stage starts at the marker line.
varying vec3 vViewPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vViewPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform float uExposure;
uniform float uFade;
uniform vec3 uSunCenter;  // camera-relative Sun centre, world axes, m
uniform float uSunRadius; // m
uniform vec3 uSunPole;    // unit rotation pole, world axes
uniform vec3 uCoronaL;    // cd/m2 per channel for B/B_sun = 1 (mean disk luminance x colour)
uniform vec3 uBaumA;      // Baumbach coefficients a_i (already times the 1e-6 scale)
uniform vec3 uBaumP;      // Baumbach exponents p_i
uniform float uShellR;    // shell radius, solar radii
uniform float uCoronaOn;  // 0 in the H-alpha view (the white-light corona is hidden)
uniform float uHalpha;
uniform vec4 uProm[16];   // prominence anchors (dir, world axes; type 0 hedgerow / 1 loops)
uniform vec4 uPromB[16];  // (height, half-width along the limb, seed, intensity), solar radii
uniform int uPromCount;
uniform vec3 uPromL;      // cd/m2 per channel of a prominence of unit field (physical, pink)
uniform vec3 uHaPromL;    // same in the H-alpha view (relative to the H-alpha disk)
uniform float uChromo;    // chromosphere / spicule fringe relative to a prominence
varying vec3 vViewPos;

float coronaHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float coronaNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(coronaHash(i), coronaHash(i + vec3(1, 0, 0)), f.x),
        mix(coronaHash(i + vec3(0, 1, 0)), coronaHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(coronaHash(i + vec3(0, 0, 1)), coronaHash(i + vec3(1, 0, 1)), f.x),
        mix(coronaHash(i + vec3(0, 1, 1)), coronaHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// Prominences above the limb: each anchor is projected onto the sky plane; (u, y) are the angle along
// the limb in half-widths and the height in prominence heights. An anchor behind the limb by depth
// hides the base of its prominence; one well in front is seen on the disk (as a filament) instead.
float promField(vec3 q, float h, vec3 n, float rOverD) {
  float sum = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uPromCount) break;
    vec4 A = uProm[i];
    vec4 B = uPromB[i];
    float H = B.x;
    float W = B.y;
    float depth = dot(A.xyz, -n) - rOverD; // > 0: on the visible hemisphere
    float hh = h + 0.5 * depth * depth * step(depth, 0.0);
    if (hh > 1.25 * H || B.w <= 0.0) continue;
    float vis = smoothstep(-0.45, -0.1, depth) * (1.0 - smoothstep(0.08, 0.25, depth));
    if (vis <= 0.0) continue;
    vec3 ap = A.xyz - dot(A.xyz, n) * n;
    float apl = length(ap);
    if (apl < 1e-3) continue;
    ap /= apl;
    float u = atan(dot(cross(ap, q), n), dot(ap, q)) / W;
    if (abs(u) > 1.5) continue;
    float y = hh / H;
    float b = 0.0;
    if (A.w < 0.5) {
      // Hedgerow: a ragged-topped sheet of fine vertical threads with knots and gaps.
      float top = 0.85 + 0.35 * (coronaNoise(vec3(u * 3.0 + B.z * 31.0, 1.0, 2.0)) - 0.5);
      float env = (1.0 - smoothstep(0.55, 1.0, abs(u) + 0.35 * y * y)) * (1.0 - smoothstep(0.65 * top, top, y));
      float thr = coronaNoise(vec3(u * 26.0 + B.z * 50.0, y * 1.2, B.z * 13.0));
      float thr2 = coronaNoise(vec3(u * 9.0 + B.z * 9.0, y * 5.0, 5.0));
      float knots = coronaNoise(vec3(u * 14.0, y * 9.0, B.z * 3.0));
      b = env * (0.1 + 2.2 * thr * thr * (0.4 + thr2) * (0.6 + 0.8 * knots));
    } else {
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float e = length(vec2(u * (1.0 + 0.22 * fk) + 0.1 * fk, y * (1.0 + 0.3 * fk)));
        float t = (e - 1.0 + 0.06 * (coronaNoise(vec3(u * 6.0, fk, B.z * 30.0)) - 0.5)) / 0.06;
        b += exp(-t * t) * (1.0 - 0.25 * fk);
      }
      b *= 0.9 + 0.4 * coronaNoise(vec3(u * 15.0, y * 15.0, B.z * 20.0));
    }
    sum += b * vis * B.w;
  }
  return sum;
}

void main() {
  vec3 d = normalize(vViewPos);
  float tc = dot(uSunCenter, d);
  vec3 c = d * max(tc, 0.0) - uSunCenter; // Sun centre -> closest point of the ray (or the camera)
  float p = length(c) / uSunRadius;
  if (p < 1.0 || p > uShellR) discard;
  vec3 q = c / (p * uSunRadius);
  vec3 Lp = vec3(0.0);
  float h = p - 1.0;
  if (h < 0.2 && (uPromCount > 0 || uChromo > 0.0)) {
    float D = length(uSunCenter) / uSunRadius;
    float f = promField(q, h, uSunCenter / (D * uSunRadius), 1.0 / D);
    f += uChromo * exp(-h / 0.006) * (0.5 + coronaNoise(q * 900.0));
    Lp = (uHalpha > 0.5 ? uHaPromL : uPromL) * f;
  }
  if (uCoronaOn < 0.5) {
    if (h >= 0.2) discard;
    gl_FragColor = vec4(min(Lp * uExposure * uFade, vec3(60000.0)), 1.0);
    LOG_DEPTH_FRAGMENT();
    return;
  }
  float B = dot(uBaumA, pow(vec3(p), -uBaumP));
  float lat = dot(q, uSunPole);
  float eq = 1.0 - lat * lat;            // cos^2(latitude): streamers crowd the equator
  float rays = 0.6 * coronaNoise(q * 7.0) + 0.4 * coronaNoise(q * 29.0);
  float shape = mix(0.35, 1.0, eq * eq) * (0.45 + 1.1 * rays);
  shape *= 1.0 + 0.9 * eq * eq * (p - 1.0); // equatorial streamers fall off more slowly
  float halfRay = tc > 0.0 ? 1.0 : 0.5;     // the camera sits inside the corona looking away
  float edge = 1.0 - smoothstep(0.6 * uShellR, uShellR, p);
  vec3 L = uCoronaL * B * shape * halfRay * edge + Lp;
  gl_FragColor = vec4(min(L * uExposure * uFade, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
