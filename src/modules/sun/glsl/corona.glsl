// sun: corona shell. A back-faced sphere of uShellR solar radii around the Sun; each fragment takes
// its view ray's impact parameter p (closest approach to the Sun's centre, solar radii) and outputs
// the Baumbach K+F brightness B(p) (about 1e-6 of the disk), shaped by streamers that depend only
// on the direction of closest approach (so every structure is radial). Physically pre-exposed:
// invisible next to the photosphere or a daylight sky, it appears when the disk is occluded
// (totality) or at very low exposure. The Moon and the disk itself occlude it through log depth.
// The fragment stage starts at the marker line.
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

void main() {
  vec3 d = normalize(vViewPos);
  float tc = dot(uSunCenter, d);
  vec3 c = d * max(tc, 0.0) - uSunCenter; // Sun centre -> closest point of the ray (or the camera)
  float p = length(c) / uSunRadius;
  if (p < 1.0 || p > uShellR) discard;
  vec3 q = c / (p * uSunRadius);
  float B = dot(uBaumA, pow(vec3(p), -uBaumP));
  float lat = dot(q, uSunPole);
  float eq = 1.0 - lat * lat;            // cos^2(latitude): streamers crowd the equator
  float rays = 0.6 * coronaNoise(q * 7.0) + 0.4 * coronaNoise(q * 29.0);
  float shape = mix(0.35, 1.0, eq * eq) * (0.45 + 1.1 * rays);
  shape *= 1.0 + 0.9 * eq * eq * (p - 1.0); // equatorial streamers fall off more slowly
  float halfRay = tc > 0.0 ? 1.0 : 0.5;     // the camera sits inside the corona looking away
  float edge = 1.0 - smoothstep(0.6 * uShellR, uShellR, p);
  vec3 L = uCoronaL * B * shape * halfRay * edge;
  gl_FragColor = vec4(min(L * uExposure * uFade, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
