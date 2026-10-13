// Earth v1 (P1 default; the P2 'earth' module overrides it): Blue Marble day map as linear
// reflectance, clouds from the packed brc map (B channel) blended as a 0.8-albedo layer, a GGX
// sun glint on the ocean mask, and city lights gated by the terminator.
uniform sampler2D uDayMap;
uniform sampler2D uNightMap;
uniform sampler2D uBrcMap;
uniform sampler2D uSpecMap;
uniform float uHasMaps;
uniform float uCityLuminance; // cd/m2 of a white night-map texel
vec3 shadeSurface(SurfaceInput s) {
  float mu0 = dot(s.normal, s.sunDir);
  float mu = max(dot(s.normal, s.viewDir), 1e-3);
  vec3 E = s.sunIlluminance * s.shadow;
  vec3 day = vec3(0.12);
  float cloud = 0.0;
  float ocean = 0.0;
  vec3 night = vec3(0.0);
  if (uHasMaps > 0.5) {
    day = sampleEquirect(uDayMap, s.uv).rgb;
    cloud = sampleEquirect(uBrcMap, s.uv).b;
    ocean = sampleEquirect(uSpecMap, s.uv).r;
    night = sampleEquirect(uNightMap, s.uv).rgb;
  }
  vec3 L = vec3(0.0);
  if (mu0 > 0.0) {
    vec3 ground = day * mu0 / 3.14159265;
    // GGX glint (alpha 0.0625, F0 0.02) on water, Schlick-GGX visibility.
    vec3 h = normalize(s.sunDir + s.viewDir);
    float nh = max(dot(s.normal, h), 0.0);
    float a2 = 0.0625 * 0.0625;
    float dn = nh * nh * (a2 - 1.0) + 1.0;
    float d = a2 / (3.14159265 * dn * dn);
    float f = 0.02 + 0.98 * pow(1.0 - max(dot(h, s.viewDir), 0.0), 5.0);
    float g = (mu0 / (mu0 * 0.875 + 0.125)) * (mu / (mu * 0.875 + 0.125));
    ground += vec3(ocean * d * f * g / (4.0 * mu));
    vec3 clouds = vec3(0.8 * mu0 / 3.14159265);
    L += E * mix(ground, clouds, cloud);
  }
  float dark = smoothstep(0.05, -0.1, mu0);
  L += night * uCityLuminance * dark * (1.0 - 0.7 * cloud);
  return L;
}
