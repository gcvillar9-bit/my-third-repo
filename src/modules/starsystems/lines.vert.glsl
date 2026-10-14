// Constellation lines between the stars' real 3D positions (pc, Sun-centred ICRS, J2000) with the same
// linear proper motion as the HYG points. Like the stars, both ends are projected as directions
// (at infinity), so a segment is the great-circle arc between the two stars as seen from the camera.
// Each end is pulled towards the other by uGap radians so the line stops short of the star image.
attribute vec3 velocity;
attribute vec3 other;
attribute vec3 otherVel;

uniform float uYears;  // years since J2000, clamped to ±1 Myr
uniform float uGap;    // radians

void main() {
  float k = uYears * 1.0227e-6;
  vec3 a = normalize(rteRelative(position + velocity * k));
  vec3 b = normalize(rteRelative(other + otherVel * k));
  float ang = acos(clamp(dot(a, b), -1.0, 1.0));
  float t = ang > 1e-6 ? min(0.4, uGap / ang) : 0.0;
  vec3 dir = normalize(mix(a, b, t));
  gl_Position = projectionMatrix * vec4((modelViewMatrix * vec4(dir, 0.0)).xyz, 1.0);
}
