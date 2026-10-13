// Milky Way diffuse panorama on a unit sphere around the camera (background layer).
// The texture is galactic equirectangular: u = 0.5 − l/360°, v(row) = 0.5 − b/180°
// (north galactic pole on the top row; three.js flipY makes uv.y = 1 the top row).
#ifdef COSMOS_VERTEX
varying vec3 vDir;
void main() {
  vDir = position;  // object at the origin with identity rotation: ICRS world axes
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
#else
uniform sampler2D uMap;
uniform mat3 uIcrsToGal;    // r_gal = M · r_icrs
uniform float uLuminance;   // cd/m² for a linear texel value of 1, times fade and gain
uniform float uExposure;
varying vec3 vDir;
void main() {
  vec3 g = uIcrsToGal * normalize(vDir);
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z, -1.0, 1.0));
  vec2 uv = vec2(fract(0.5 - l * 0.15915494309), 0.5 + b * 0.31830988618);
  vec3 c = texture2D(uMap, uv).rgb;
  gl_FragColor = vec4(c * uLuminance * uExposure, 1.0);
}
#endif
