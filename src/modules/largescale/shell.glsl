// Laniakea outline (overlay layer, display-referred, additive, both faces, no depth): a faint
// fresnel-rim glow plus contour slices every CONTOUR_MPC along supergalactic north. Positions are Mpc
// in the `universe` frame (RTE high/low camera, rte.glsl prepended in the vertex stage).
varying vec3 vN;
varying vec3 vRel;
varying float vH;
#ifdef COSMOS_VERTEX
uniform vec3 uCentre;
uniform vec3 uAxisZ;
void main() {
  vRel = rteRelative(position);
  vN = normal;
  vH = dot(position - uCentre, uAxisZ);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vRel, 1.0);
}
#else
uniform float uFade;
uniform vec3 uColor;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vRel)));
  float rim = pow(1.0 - ndv, 3.0);
  float h = vH / CONTOUR_MPC;
  float g = abs(fract(h - 0.5) - 0.5) / max(fwidth(h), 1e-4);
  float line = 1.0 - min(g, 1.0);
  gl_FragColor = vec4(uColor * uFade * (0.2 * rim + 0.05 * line), 1.0);
}
#endif
