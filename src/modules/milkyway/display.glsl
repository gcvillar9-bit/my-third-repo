// Background-layer display of the galaxy: the cached reduced-resolution march (full-screen
// triangle) or the baked sky cube (MW_CUBE, unit sphere around the camera). Output L · uExposure.
#ifdef COSMOS_VERTEX
varying vec2 vUv;
varying vec3 vDir;
void main() {
#ifdef MW_CUBE
  vDir = position;  // object at the origin with identity rotation: world (ICRS) axes
  vUv = vec2(0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#else
  vUv = uv;
  vDir = vec3(0.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
#endif
}
#else
uniform sampler2D uTex;
uniform samplerCube uCube;
uniform mat3 uWorldToModel;
uniform float uScale;       // weight · gain / STORE_SCALE
uniform float uExposure;
varying vec2 vUv;
varying vec3 vDir;
void main() {
#ifdef MW_CUBE
  vec3 c = textureCube(uCube, uWorldToModel * normalize(vDir)).rgb;
#else
  vec3 c = texture2D(uTex, vUv).rgb;
#endif
  gl_FragColor = vec4(c * uScale * uExposure, 1.0);
}
#endif
