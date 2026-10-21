// Life module fragment shader. Prepended: DEPTH_GLSL, ATMOSPHERE_TRANSMITTANCE_GLSL. Faceted Lambert:
// the face normal comes from screen-space derivatives (no normal attribute; posed limbs stay faceted).
// Sun through the atmosphere at the ground plus a sky term; output L[cd/m2] * uExposure. Aerial
// perspective is added by the atmosphere composite.
uniform float uExposure;
uniform vec3 uSunRel;    // Sun centre, camera-relative, world axes, m
uniform vec3 uSunIllum;  // solar illuminance at Earth, lux per channel
uniform vec3 uUpWorld;   // local up at the anchor, world axes
uniform float uGroundRkm; // anchor distance from Earth's centre, km
varying vec3 vColor;
varying vec3 vWorld;
varying float vAo;

void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(n, vWorld) > 0.0) n = -n; // face the camera (double-sided leaves and fans)
  vec3 sunDir = normalize(uSunRel - vWorld);
  float mu = dot(uUpWorld, sunDir);
  vec3 T = atmoSunTransmittance(uGroundRkm, mu);
  vec3 E = uSunIllum * T;
  float ndl = max(dot(n, sunDir), 0.0);
  // Sky light: blue, from above, fading through twilight.
  float day = smoothstep(-0.12, 0.25, mu);
  float up = dot(n, uUpWorld);
  vec3 skyE = uSunIllum * vec3(0.06, 0.085, 0.13) * day * (0.55 + 0.45 * up);
  // Light bounced off the sunlit ground (albedo about 0.2) onto faces turned down.
  skyE += E * max(mu, 0.0) * 0.2 * (0.5 - 0.5 * up);
  vec3 L = vColor * vAo * (E * ndl + skyE) / 3.14159265;
  gl_FragColor = vec4(min(L * uExposure, vec3(60000.0)), 1.0);
  LOG_DEPTH_FRAGMENT();
}
