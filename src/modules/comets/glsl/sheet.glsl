// Dust fan: the sheet of grains spanned between neighbouring syndynes, which lies in the comet's orbital
// plane. Each vertex carries the sheet's face-on surface brightness; seen at an angle the optically thin
// sheet brightens as 1 / cos (capped: close to edge-on the ribbons in tail.glsl give it its thickness).
// Radiance in cd/m2 times uExposure. The fragment stage starts at the marker line.
attribute float aLum;
varying float vLum;
varying vec3 vView; // camera -> fragment, world axes
void main() {
  vec4 wc = modelMatrix * vec4(position, 1.0);
  vView = wc.xyz;
  vLum = aLum;
  gl_Position = projectionMatrix * viewMatrix * wc;
  LOG_DEPTH_VERTEX();
}
//#fragment
uniform vec3 uColor;  // linear RGB of luminance 1
uniform vec3 uNormal; // unit orbit normal, world axes
uniform float uExposure;
varying float vLum;
varying vec3 vView;
void main() {
  float c = abs(dot(normalize(vView), uNormal));
  float slant = 1.0 / max(c, 0.2);
  gl_FragColor = vec4(min(uColor * (vLum * slant * uExposure), vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
