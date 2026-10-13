// Planar arm field: GLSL twin of armField() in model.ts. Baked once into an RGBA16F texture that
// covers |x|, |y| < MW_RMAX (model kpc): r = young arm proximity, g = old-disk arm term,
// b = dust on the inner arm edges, a = HII clump amplitude. Prefixed with modelGlslDefines().
varying vec2 vUv;

uint hashCell(uint cx, uint cy) {
  uint h = (cx * 0x8da6b343u) ^ (cy * 0xd8163841u);
  h ^= h >> 15u;
  h *= 0x2c1b3c6du;
  h ^= h >> 12u;
  h *= 0x297a2d39u;
  h ^= h >> 15u;
  return h;
}

float smooth01(float t) {
  float c = clamp(t, 0.0, 1.0);
  return c * c * (3.0 - 2.0 * c);
}

vec4 armField(vec2 p) {
  float R = max(length(p), 0.05);
  float lnR = log(R);
  float beta = atan(p.y, -p.x);
  vec4 o = vec4(0.0);
  for (int i = 0; i < MW_NARMS; i++) {
    vec4 A = MW_ARM_A[i];
    vec4 B = MW_ARM_B[i];
    float best = 1e9;
    float taper = 0.0;
    for (int k = -1; k <= 1; k++) {
      float b = beta + 6.283185307179586 * float(k);
      if (b < B.z || b > B.w) continue;
      float lnRa = A.y - (b - A.x) * (b < A.x ? A.z : A.w);
      float d = R * (lnR - lnRa);
      if (abs(d) < abs(best)) {
        best = d;
        taper = smooth01((b - B.z) / MW_TAPER) * smooth01((B.w - b) / MW_TAPER);
      }
    }
    if (best > 1e8) continue;
    float w = max(0.1, (B.x + MW_WIDTH_GROWTH * (R - B.y)) * MW_WIDTH_SCALE);
    float g = exp(-0.5 * (best / w) * (best / w)) * taper;
    o.x += MW_ARM_C[i].x * g;
    o.y += MW_ARM_C[i].y * g;
    float e = (best + MW_DUST_EDGE_OFFSET * w) / (MW_DUST_EDGE_WIDTH * w);
    o.z += MW_ARM_C[i].z * exp(-0.5 * e * e) * taper;
  }
  ivec2 c = ivec2(floor(p / MW_HII_CELL));
  uint h1 = hashCell(uint(c.x), uint(c.y));
  uint h2 = hashCell(h1, 7u);
  if (float(h2 & 0xffffu) / 65535.0 < MW_HII_FRACTION) {
    vec2 u = vec2(float(h1 & 0xffffu), float(h1 >> 16u)) / 65535.0;
    vec2 cp = (vec2(c) + 0.2 + 0.6 * u) * MW_HII_CELL;
    float amp = 0.4 + 0.6 * float(h2 >> 16u) / 65535.0;
    vec2 dd = p - cp;
    o.w = amp * exp(-0.5 * dot(dd, dd) / (MW_HII_SIGMA * MW_HII_SIGMA)) * o.x;
  }
  return o;
}

void main() {
  gl_FragColor = armField((vUv * 2.0 - 1.0) * MW_RMAX);
}
