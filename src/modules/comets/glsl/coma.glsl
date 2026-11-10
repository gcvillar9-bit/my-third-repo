// Coma: the back faces of a sphere of three coma radii around the nucleus. Each fragment integrates a steady
// outflow (density ~ 1/rho^2) along its view ray from the camera outwards, in closed form:
//   column = (pi/2 + atan(t0 / b)) / b     b = impact parameter, t0 = distance along the ray to closest approach
// which is pi/b seen from outside and still holds with the camera inside the coma. uSoft (a few nucleus
// radii or half a pixel, whichever is larger) removes the 1/b singularity. The sunlit side of the nucleus
// is the active one, so rays passing sunward of it are brighter (the total stays within about 30%).
// Radiance in cd/m2 times uExposure. The fragment stage starts at the marker line.
varying vec3 vOff; // fragment relative to the nucleus, world axes, m
void main() {
  vOff = mat3(modelMatrix) * position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform vec3 uCenter; // camera -> nucleus, world axes, m
uniform vec3 uSunDir; // unit, nucleus -> Sun, world axes
uniform float uRc;    // coma radius, m
uniform float uSoft;  // m
uniform vec3 uK;      // colour * I / (2 pi^2 0.93 Rc), cd/m
uniform float uExposure;
varying vec3 vOff;
void main() {
  vec3 x = uCenter + vOff;
  float lx = max(length(x), 1e-3);
  vec3 ray = x / lx;
  // cross(vOff, uCenter) has no cancellation, unlike sqrt(d^2 - t0^2).
  float b = length(cross(vOff, uCenter)) / lx;
  float t0 = dot(ray, uCenter);
  float bEff = sqrt(b * b + uSoft * uSoft);
  float column = (1.57079633 + atan(t0, bEff)) / bEff;
  // Exponential outskirts (the gas that glows is destroyed by sunlight on the scale of uRc), ending at 3 uRc.
  float cut = exp(-b / uRc) * (1.0 - smoothstep(2.4, 3.0, b / uRc));
  // Direction from the nucleus to the ray's closest point, against the Sun's direction.
  vec3 near = vOff - ray * dot(ray, vOff);
  float sunward = dot(near, uSunDir) / max(length(near), 1e-3);
  float lit = 0.65 + 0.8 * smoothstep(-0.2, 1.0, sunward) * smoothstep(0.0, uSoft, b);
  gl_FragColor = vec4(min(uK * (column * cut * lit * uExposure), vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
