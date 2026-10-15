// Milky Way diffuse panorama on a unit sphere around the camera (background layer).
// The texture is galactic equirectangular: u = 0.5 − l/360°, v(row) = 0.5 − b/180°
// (north galactic pole on the top row; three.js flipY makes uv.y = 1 the top row).
#ifdef COSMOS_VERTEX
varying vec3 vDir;
void main() {
  vDir = position;  // object at the origin with identity rotation: ICRS world axes
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
#else
uniform sampler2D uMap;     // sRGB-encoded, mipmapped (decoded to linear by the GPU)
uniform vec2 uMapSize;      // texels
uniform mat3 uIcrsToGal;    // r_gal = M · r_icrs
uniform float uLuminance;   // cd/m² for a linear texel value of 1, times fade and gain
uniform float uExposure;
// A soft hole around an object another module draws itself (the Orion Nebula), so it is not counted twice: inside
// it the panorama is replaced by a smooth membrane through 8 taps on a ring around it (uvs from galacticUv on the
// CPU): their mean plus the first two angular harmonics, scaled as a harmonic function inside a disc (r/R, (r/R)²),
// so the fill follows the sky's gradient across the hole instead of leaving a flat disc.
uniform vec4 uHole;         // ICRS unit direction, strength (0 = off)
uniform vec3 uHoleA;        // tangent basis at the hole: tap k sits at position angle k·45° from A towards B
uniform vec3 uHoleB;
uniform vec2 uHoleCos;      // cos(outer radius), cos(inner radius)
uniform float uRingRadius;  // rad
uniform vec2 uRingUv[8];
uniform float uRingLod;
varying vec3 vDir;

// Cubic B-spline filter from 4 bilinear taps (smooth, no texel blocks when a texel covers many pixels).
vec3 bspline(vec2 uv) {
  vec2 p = uv * uMapSize - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / uMapSize;
  vec2 h1 = (i + 1.5 + w3 / g1) / uMapSize;
  vec3 a = textureLod(uMap, vec2(h0.x, h0.y), 0.0).rgb;
  vec3 b = textureLod(uMap, vec2(h1.x, h0.y), 0.0).rgb;
  vec3 c = textureLod(uMap, vec2(h0.x, h1.y), 0.0).rgb;
  vec3 d = textureLod(uMap, vec2(h1.x, h1.y), 0.0).rgb;
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 g = uIcrsToGal * dir;
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z, -1.0, 1.0));
  vec2 uv = vec2(fract(0.5 - l * 0.15915494309), 0.5 + b * 0.31830988618);
  // Screen-space footprint without the jump at the u = 0/1 seam.
  vec2 dx = vec2(dFdx(uv.x), dFdx(uv.y));
  vec2 dy = vec2(dFdy(uv.x), dFdy(uv.y));
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  float texelsPerPx = max(length(dx * uMapSize), length(dy * uMapSize));
  vec3 c = textureGrad(uMap, uv, dx, dy).rgb; // trilinear when minified
  float magnified = 1.0 - smoothstep(0.5, 1.0, texelsPerPx);
  if (magnified > 0.0) c = mix(c, bspline(uv), magnified);
  if (uHole.w > 0.0) {
    float cd = dot(dir, uHole.xyz);
    float m = uHole.w * smoothstep(uHoleCos.x, uHoleCos.y, cd);
    if (m > 0.0) {
      vec3 a0 = vec3(0.0);
      vec3 a1 = vec3(0.0);
      vec3 b1 = vec3(0.0);
      vec3 a2 = vec3(0.0);
      vec3 b2 = vec3(0.0);
      for (int k = 0; k < 8; k++) {
        vec3 t = textureLod(uMap, uRingUv[k], uRingLod).rgb;
        float p = float(k) * 0.78539816;
        a0 += t;
        a1 += t * cos(p);
        b1 += t * sin(p);
        a2 += t * cos(2.0 * p);
        b2 += t * sin(2.0 * p);
      }
      float rho = acos(clamp(cd, -1.0, 1.0)) / uRingRadius;
      float phi = atan(dot(dir, uHoleB), dot(dir, uHoleA));
      vec3 fill = a0 * 0.125 + rho * 0.25 * (a1 * cos(phi) + b1 * sin(phi)) +
        rho * rho * 0.25 * (a2 * cos(2.0 * phi) + b2 * sin(2.0 * phi));
      c = mix(c, max(fill, vec3(0.0)), m);
    }
  }
  gl_FragColor = vec4(c * uLuminance * uExposure, 1.0);
}
#endif
