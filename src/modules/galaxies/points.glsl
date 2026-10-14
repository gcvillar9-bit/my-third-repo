// Galaxy point sprites (background layer). Positions are Mpc in the `universe` frame (supergalactic axes,
// origin Milky Way centre); the camera arrives as an RTE high/low pair (rte.glsl, prepended in the vertex
// stage). Brightness from absolute magnitude and distance; the point fades out where the galaxy's
// angular radius reaches a few pixels and its oriented impostor (impostors.glsl) takes over.
varying vec3 vColor;
#ifdef COSMOS_VERTEX
attribute float absMag;
attribute float radius;  // kpc
attribute float gtype;   // Hubble type code
uniform float uScale;    // LUX_MAG0 · exposure / pixelSolidAngle (E → pre-exposed L per px)
uniform float uPixelAngle;
uniform vec3 uSunPos;    // Mpc, universe frame
uniform float uPanoFade; // 0 near the Sun, where the stars panorama already shows the bright galaxies
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uYoung[16];
#define CORE_PEAK 0.3767  // 1 / (2π σ²), σ = 0.65 px
void main() {
  vec3 rel = rteRelative(position);
  float d = max(length(rel), 1e-9);
  float m = absMag + 25.0 + 5.0 * log2(d) * 0.30102999566;
  float rpx = radius * 1e-3 / (d * uPixelAngle);
  float w = 1.0 - smoothstep(IMPOSTOR_LO, IMPOSTOR_HI, rpx);
  float mSun = absMag + 25.0 + 5.0 * log2(max(length(position - uSunPos), 1e-9)) * 0.30102999566;
  if (mSun < PANO_MAG) w *= uPanoFade;
  float i1 = uScale * exp2(-1.3287712380 * m) * w;
  if (i1 * CORE_PEAK < 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }
  vec3 dir = rel / d;  // directions only: drawn at infinity like the stars
  gl_Position = projectionMatrix * vec4((modelViewMatrix * vec4(dir, 0.0)).xyz, 1.0);
  vColor = mix(uWarm, uCool, uYoung[int(gtype + 0.5)]) * i1 * CORE_PEAK;
  gl_PointSize = 5.0;
}
#else
void main() {
  vec2 r = (gl_PointCoord - 0.5) * 5.0;
  gl_FragColor = vec4(vColor * exp(-dot(r, r) / 0.845), 1.0);
}
#endif
