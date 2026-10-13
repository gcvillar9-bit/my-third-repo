// Sun v1: emissive, limb-darkened disk I(mu) = I0 (1 - u (1 - mu)) per channel, with I0 chosen
// so the disk-averaged luminance equals uDiskLuminance (cd/m2). The granulation map modulates
// it by +-50% around its mean.
uniform sampler2D uSunMap;
uniform float uHasMap;
uniform float uMapScale;
uniform float uDiskLuminance;
uniform vec3 uSunColor; // linear RGB, luminance 1
vec3 shadeSurface(SurfaceInput s) {
  float mu = clamp(dot(s.normal, s.viewDir), 0.0, 1.0);
  vec3 u = vec3(0.50, 0.60, 0.72);
  vec3 I = uDiskLuminance * uSunColor * (1.0 - u * (1.0 - mu)) / (1.0 - u / 3.0);
  float m = 1.0;
  if (uHasMap > 0.5) {
    float t = dot(sampleEquirect(uSunMap, s.uv).rgb, vec3(0.2126, 0.7152, 0.0722)) * uMapScale;
    m = mix(1.0, t, 0.5);
  }
  return I * m;
}
