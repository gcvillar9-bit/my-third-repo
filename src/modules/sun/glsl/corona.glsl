// sun: corona shell. A back-faced sphere of uShellR solar radii around the Sun; each fragment takes
// its view ray's impact parameter p (closest approach to the Sun's centre, solar radii) and outputs
// the Baumbach K+F brightness B(p) (about 1e-6 of the disk), shaped by structures that depend only
// on the direction of closest approach (so every structure is radial): the cycle's Ludendorff flattening
// (streamers crowd the equator at minimum, rounder at maximum), helmet streamers over the filament
// channels and active regions (the prominence anchors), and fainter fine rays. Physically pre-exposed:
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
uniform vec4 uProm[32];   // prominence anchors (dir, world axes; type 0 hedgerow / 1 loops)
uniform vec4 uPromB[32];  // (height, half-width along the limb, seed, intensity), solar radii
uniform int uPromCount;
uniform vec3 uPromL;      // cd/m2 per channel of a prominence of unit field (physical, pink)
uniform vec3 uHaPromL;    // same in the H-alpha view (relative to the H-alpha disk)
uniform float uChromo;    // chromosphere / spicule fringe relative to a prominence
uniform float uPixAngle;  // radians per pixel (fades sub-pixel prominence threads)
uniform float uRound;     // 0 at solar minimum (flattened corona) .. 1 near maximum (round), from the SSN
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

// Active-region loop system in (u, y) units: several strands with their own footpoints, heights and
// lean, each wiggling and varying in thickness and brightness along the arch (knots and gaps), brighter
// legs, and faint vertical threads (coronal rain) under the arches.
float promLoops(float u, float y, float seed) {
  float b = 0.0;
  float env = 0.0;
  for (int k = 0; k < 6; k++) {
    float fk = float(k);
    float h1 = coronaHash(vec3(seed * 71.0, fk, 1.0));
    float h2 = coronaHash(vec3(seed * 53.0, fk, 2.0));
    float h3 = coronaHash(vec3(seed * 37.0, fk, 3.0));
    float c = (h1 - 0.5) * 0.7;              // arch centre along the limb
    float w = 0.45 + 0.5 * h2;               // half-span between the footpoints
    float ht = 0.4 + 0.6 * h3;               // apex height
    float lean = (h2 - 0.5) * 0.6;
    float uu = (u - c - lean * y) / w;
    float yy = y / ht;
    float e = length(vec2(uu, yy));
    float s = atan(yy, uu);                  // 0..pi from one footpoint to the other
    float wig = 0.07 * (coronaNoise(vec3(s * 3.0 + fk * 5.3, seed * 19.0, 1.0)) - 0.5);
    float th = 0.025 + 0.045 * coronaNoise(vec3(s * 2.5 + fk * 2.1, seed * 13.0, 4.0));
    float t = (e - 1.0 + wig) / th;
    float along = coronaNoise(vec3(s * 5.0 + fk * 3.7, seed * 29.0, 7.0));
    float br = (0.25 + 1.4 * along * along) * (1.0 + 0.6 * (1.0 - sin(clamp(s, 0.0, 3.1416))));
    b += exp(-t * t) * br * (1.0 - 0.08 * fk);
    env = max(env, 1.0 - smoothstep(0.85, 1.05, e));
  }
  float rain = smoothstep(0.55, 0.85, coronaNoise(vec3(u * 34.0, y * 1.6, seed * 41.0)));
  return b + 0.35 * env * rain * (1.0 - 0.6 * y);
}

// Quiescent hedgerow in (u, y) units: a sheet of fine vertical threads (three octaves, each faded out once
// a pixel spans one, aaU = pixel footprint in u), a ragged top, tapered ends, dark voids, and legs (barbs)
// down to the chromosphere with arches between them.
float promHedgerow(float u, float y, float seed, float aaU) {
  float top = 0.85 + 0.35 * (coronaNoise(vec3(u * 3.0 + seed * 31.0, 1.0, 2.0)) - 0.5) +
    0.15 * (coronaNoise(vec3(u * 13.0, 0.0, seed * 5.0)) - 0.5);
  float taper = abs(u) + 0.6 * y * y + 0.2 * (coronaNoise(vec3(u * 2.0, y * 2.0, seed * 11.0)) - 0.5);
  float env = (1.0 - smoothstep(0.55, 1.0, taper)) * (1.0 - smoothstep(0.65 * top, top, y));
  env *= mix(1.0, smoothstep(0.35, 0.7, coronaNoise(vec3(u * 4.0, 0.0, seed * 9.0))), 1.0 - smoothstep(0.0, 0.35, y));
  if (env <= 0.0) return 0.0;
  float thr = 0.0;
  float wsum = 0.0;
  float amp = 1.0;
  float fq = 40.0;
  for (int o = 0; o < 3; o++) {
    float fo = float(o);
    float w = amp * (1.0 - smoothstep(0.25, 0.5, aaU * fq));
    float t = coronaNoise(vec3(u * fq + seed * 50.0 + fo * 17.0, y * 1.5, seed * 13.0 + fo * 5.0));
    thr += w * t * t + (amp - w) * 0.29; // an unresolved octave keeps its mean
    wsum += amp;
    fq *= 2.3;
    amp *= 0.8;
  }
  thr /= wsum;
  float thr2 = coronaNoise(vec3(u * 9.0 + seed * 9.0, y * 5.0, 5.0));
  float knots = coronaNoise(vec3(u * 14.0, y * 9.0, seed * 3.0));
  // Dark gaps between thread bundles (tall and narrow) and a few bubbles low in the sheet.
  float gaps = smoothstep(0.6, 0.8, coronaNoise(vec3(u * 11.0, y * 1.4, seed * 7.0)));
  float bubble = smoothstep(0.66, 0.82, coronaNoise(vec3(u * 6.0, y * 4.0, seed * 3.0 + 9.0))) *
    (1.0 - smoothstep(0.25, 0.55, y));
  float voids = 1.0 - 0.45 * gaps - 0.5 * bubble;
  return env * voids * (0.1 + 2.2 * thr * (0.4 + thr2) * (0.6 + 0.8 * knots));
}

// Prominences above the limb: each anchor is projected onto the sky plane; (u, y) are the angle along
// the limb in half-widths and the height in prominence heights. An anchor behind the limb by depth
// hides the base of its prominence; one well in front is seen on the disk (as a filament) instead.
float promField(vec3 q, float h, vec3 n, float rOverD) {
  float sum = 0.0;
  vec3 qs = q - dot(q, n) * n; // q on the sky plane (q itself leans towards the camera)
  float qsl = length(qs);
  vec3 qp = qsl > 1e-6 ? qs / qsl : q;
  for (int i = 0; i < 32; i++) {
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
    if (dot(ap, qp) < cos(min(1.5 * W, 3.0))) continue; // cheap cull before the atan
    float u = atan(dot(cross(ap, q), n), dot(ap, q)) / W;
    if (abs(u) > 1.5) continue;
    float y = hh / H;
    float b = 0.0;
    if (A.w < 0.5) {
      b = promHedgerow(u, y, B.z, uPixAngle / (rOverD * W));
    } else {
      b = promLoops(u, y, B.z);
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
  // The shell overlaps the disk a little: the tessellated disk's silhouette chords fall inside the true
  // sphere, and the disk depth-occludes the shell everywhere it does cover.
  if (p < 0.985 || p > uShellR) discard;
  vec3 q = c / (p * uSunRadius);
  vec3 Lp = vec3(0.0);
  float h = max(p - 1.0, 0.0);
  if (h < 0.2 && (uPromCount > 0 || uChromo > 0.0)) {
    float D = length(uSunCenter) / uSunRadius;
    float f = promField(q, h, uSunCenter / (D * uSunRadius), 1.0 / D);
    f += uChromo * exp(-h / 0.006) * (0.5 + coronaNoise(q * 900.0));
    // White light: a soft knee keeps a prominence within a few times the inner corona (no clipping into a
    // white bead) while its threads still show.
    Lp = uHalpha > 0.5 ? uHaPromL * f : uPromL * 1.6 * (1.0 - exp(-f / 1.6));
  }
  if (uCoronaOn < 0.5) {
    if (h >= 0.2) discard;
    gl_FragColor = vec4(min(Lp * uExposure * uFade, vec3(60000.0)), 1.0);
    LOG_DEPTH_FRAGMENT();
    return;
  }
  float B = dot(uBaumA, pow(vec3(max(p, 1.0)), -uBaumP));
  float lat = dot(q, uSunPole);
  float eq = 1.0 - lat * lat;            // cos^2(latitude)
  float eq4 = eq * eq * eq * eq;
  float shape = mix(0.2 + 0.8 * eq4, 1.0, uRound);
  // Helmet streamers: broad over their anchor's position angle at the base, narrowing into stalks, seen
  // where the anchor lies near the plane of the sky.
  vec3 n = uSunCenter / length(uSunCenter);
  float sig2 = 0.09 / (p * p) + 0.012;
  float hel = 0.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uPromCount) break;
    vec3 A = uProm[i].xyz;
    vec3 ap = A - dot(A, n) * n;
    float l2 = dot(ap, ap);
    if (l2 < 0.04) continue;
    hel += l2 * uPromB[i].w * exp(-2.0 * (1.0 - dot(ap, q) * inversesqrt(l2)) / sig2);
  }
  shape *= 0.55 + 0.6 * min(hel, 2.0);
  float rays = 0.6 * coronaNoise(q * 7.0) + 0.4 * coronaNoise(q * 29.0);
  shape *= 0.7 + 0.6 * rays;
  shape *= 1.0 + 0.9 * eq * eq * h;       // equatorial streamers fall off more slowly
  float halfRay = tc > 0.0 ? 1.0 : 0.5;     // the camera sits inside the corona looking away
  float edge = 1.0 - smoothstep(0.6 * uShellR, uShellR, p);
  vec3 L = uCoronaL * B * shape * halfRay * edge + Lp;
  gl_FragColor = vec4(min(L * uExposure * uFade, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
