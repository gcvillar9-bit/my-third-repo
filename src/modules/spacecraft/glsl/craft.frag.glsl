// Spacecraft shading: Lambert sunlight (eclipsed by the planet through shadows.glsl), a soft
// highlight on foil and glass, light reflected by the planet below (low orbits), and a small fill
// light so faces turned from the Sun keep their shape. The fill is NOT physical: in space a face
// in shadow is nearly black. Output: luminance in cd/m² times the shared exposure.
uniform float uExposure;
uniform vec3 uSunDir;     // unit, craft -> Sun, world axes
uniform vec3 uSunLux;     // solar illuminance at the craft, lux per channel
uniform vec3 uPlanetDir;  // unit, craft -> planet centre, world axes
uniform vec3 uPlanetLux;  // illuminance from the planet's sunlit face, lux per channel
uniform float uFill;      // fill light as a fraction of direct sunlight
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying float vShaded;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vWorld);
  float eclipse = sunVisibility(vWorld);
  vec3 sun = uSunLux * eclipse * (1.0 - vShaded);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 lit = sun * ndl;
  // Planet-shine wraps around the craft: the planet fills nearly half the sky from a low orbit.
  float wrap = max(0.5 + 0.5 * dot(n, uPlanetDir), 0.0);
  lit += uPlanetLux * wrap * wrap;
  // Fill light from the camera's side, dimmed (not removed) inside the planet's shadow.
  lit += uSunLux * uFill * mix(0.2, 1.0, eclipse) * (0.3 + 0.7 * max(dot(n, v), 0.0));
  vec3 L = vColor.rgb * lit / 3.14159265;
  // Blinn-Phong highlight, tighter and stronger with gloss.
  float gloss = vColor.a;
  vec3 h = normalize(uSunDir + v);
  float shininess = mix(8.0, 96.0, gloss);
  L += sun * gloss * 0.5 * step(0.0, dot(n, uSunDir)) * pow(max(dot(n, h), 0.0), shininess) / 3.14159265;
  gl_FragColor = vec4(L * uExposure, 1.0);
  LOG_DEPTH_FRAGMENT();
}
