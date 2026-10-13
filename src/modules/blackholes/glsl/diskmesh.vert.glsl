// Large-scale thin disk of an X-ray binary: annulus with log-spaced radii (aRp = (rho, phi)).
attribute vec2 aRp;
uniform float uRin;    // r_s
uniform float uRout;   // r_s
uniform float uRs;     // m
varying vec3 vLocal;   // position relative to the hole, r_s, world axes
varying vec3 vView;    // camera-relative, m
void main() {
  float r = uRin * pow(uRout / uRin, aRp.x);
  vec3 p = r * (cos(aRp.y) * uDiskA + sin(aRp.y) * uDiskB);
  vLocal = p;
  vec4 wp = modelMatrix * vec4(p * uRs, 1.0);
  vView = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  LOG_DEPTH_VERTEX();
}
