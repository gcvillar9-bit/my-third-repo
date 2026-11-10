// Coma: the back faces of a sphere of the coma radius around the nucleus. Each fragment integrates a steady
// outflow (density ~ 1/rho^2) along its view ray from the camera outwards, in closed form:
//   column = (pi/2 + atan(t0 / b)) / b     b = impact parameter, t0 = distance along the ray to closest approach
// which is pi/b seen from outside and still holds with the camera inside the coma. uSoft (the nucleus radius
// or half a pixel, whichever is larger) removes the 1/b singularity. Radiance in cd/m2 times uExposure.
// The fragment stage starts at the marker line.
varying vec3 vOff; // fragment relative to the nucleus, world axes, m
void main() {
  vOff = mat3(modelMatrix) * position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform vec3 uCenter; // camera -> nucleus, world axes, m
uniform float uRc;    // coma radius, m
uniform float uSoft;  // m
uniform vec3 uK;      // colour * I / (2 pi^2 0.65 Rc), cd/m
uniform float uExposure;
varying vec3 vOff;
void main() {
  vec3 x = uCenter + vOff;
  float lx = max(length(x), 1e-3);
  // cross(vOff, uCenter) has no cancellation, unlike sqrt(d^2 - t0^2).
  float b = length(cross(vOff, uCenter)) / lx;
  float t0 = dot(x, uCenter) / lx;
  float bEff = sqrt(b * b + uSoft * uSoft);
  float column = (1.57079633 + atan(t0, bEff)) / bEff;
  float cut = 1.0 - smoothstep(0.3, 1.0, b / uRc);
  gl_FragColor = vec4(min(uK * (column * cut * uExposure), vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
