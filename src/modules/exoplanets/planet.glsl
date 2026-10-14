// Exoplanet artist's impression: class-tinted Lambert sphere lit by its host star (not the Sun),
// optional latitude bands for giants and a faint self-glow for lava worlds and hot Jupiters.
uniform vec3 uExoHostPos;   // host centre relative to the camera, world axes, m
uniform vec3 uExoHostLux;   // host illuminance at the planet, lux per channel (linear RGB)
uniform vec3 uExoAlbedo;
uniform float uExoBands;
uniform vec3 uExoGlow;      // cd/m²

vec3 shadeSurface(SurfaceInput s) {
  vec3 l = normalize(uExoHostPos - s.viewPos);
  float ndl = max(dot(s.normal, l), 0.0);
  float lat = s.dirBody.z;
  float band = 1.0 + uExoBands * (0.22 * sin(lat * 23.0 + 2.0 * sin(lat * 7.0 + s.dirBody.x)) + 0.1 * sin(lat * 61.0));
  return uExoAlbedo * band * uExoHostLux * (ndl / 3.14159265) + uExoGlow * (1.0 - ndl);
}
