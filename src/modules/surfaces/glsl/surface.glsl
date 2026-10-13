// surfaces (P2-C) shading, priority 5: between the solar-system default (0) and Earth (10).
// Airless bodies: Lommel-Seeliger with a Hapke shadow-hiding opposition surge. Mars (SURF_MARS):
// Oren-Nayar with the Sun attenuated by the atmosphere transmittance LUT. Both normalise like the
// default shading (albedo map divided by its mean, scaled by the geometric albedo p), so the disk
// stays continuous with the point LOD. Close up, a tileable detail texture is applied triplanar on
// the Float64-anchored detail bands (SurfaceInput.detailOrigin), blending regolith on flats and rock
// on steep slopes.
uniform sampler2D uAlbedoMap; // shared with the default shading (same IUniform objects)
uniform float uHasMap;
uniform float uMapScale;
uniform float uAlbedo;
uniform vec3 uTint;
uniform sampler2D uSurfDetail; // RGBA8 tileable: R fine regolith, G rock blocks, B mottling
uniform float uSurfB0;         // opposition surge amplitude
uniform float uSurfH;          // opposition surge width (Hapke h)
uniform float uSurfRoughness;  // Oren-Nayar sigma (rad)
uniform vec3 uSurfRock;        // albedo factor of steep rock relative to the flat regolith
uniform float uSurfDetailAmp;  // contrast of the detail bands
uniform float uSurfRadiusKm;   // equatorial radius (atmosphere space)

#ifndef SOLAR_EQUIRECT_GLSL
#define SOLAR_EQUIRECT_GLSL
vec4 sampleEquirect(sampler2D t, vec2 uv) {
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  return textureGrad(t, uv, dx, dy);
}
#endif

// Detail texture repeats 16 times per noise period (256 band units), so the band domain stays periodic.
#define SURF_REPEAT 16.0

// Triplanar sample of the detail texture in band k's domain; w = blend weights from the body normal.
vec4 surfTriplanar(vec3 q, vec3 dqx, vec3 dqy, vec3 w) {
  float s = SURF_REPEAT / SURFACE_NOISE_PERIOD;
  vec4 a = textureGrad(uSurfDetail, q.yz * s, dqx.yz * s, dqy.yz * s);
  vec4 b = textureGrad(uSurfDetail, q.zx * s, dqx.zx * s, dqy.zx * s);
  vec4 c = textureGrad(uSurfDetail, q.xy * s, dqx.xy * s, dqy.xy * s);
  return a * w.x + b * w.y + c * w.z;
}

// Albedo multiplier from the detail bands: regolith speckle on flats, blocky rock on slopes.
vec3 surfDetail(SurfaceInput s, float rock) {
  vec3 w = pow(abs(s.normalBody), vec3(4.0));
  w /= max(w.x + w.y + w.z, 1e-5);
  float footprint = s.pixelSize / max(abs(dot(s.viewDir, s.up)), 0.05);
  vec3 dpx = dFdx(s.localPos);
  vec3 dpy = dFdy(s.localPos);
  float lambda = 10000.0;
  float m = 0.0;
  for (int k = 0; k < SURFACE_DETAIL_BANDS; k++) {
    float bw = smoothstep(1.0, 4.0, lambda / max(footprint, 1e-6));
    if (bw > 0.001) {
      vec3 q = s.detailOrigin[k] + s.localPos / lambda;
      vec4 t = surfTriplanar(q, dpx / lambda, dpy / lambda, w) - 0.5;
      float regolith = 0.6 * t.r + 0.4 * t.b;
      float blocks = 0.7 * t.g + 0.3 * t.r;
      m += bw * mix(regolith, blocks * 1.6, rock);
    }
    lambda *= 0.1;
  }
  return vec3(max(1.0 + uSurfDetailAmp * m, 0.2));
}

vec3 shadeSurface(SurfaceInput s) {
  float mu0 = dot(s.normal, s.sunDir);
  if (mu0 <= 0.0) return vec3(0.0);
  float mu = max(dot(s.normal, s.viewDir), 0.0);
  vec3 c = uHasMap > 0.5 ? sampleEquirect(uAlbedoMap, s.uv).rgb * uMapScale : uTint;
  float rock = smoothstep(0.06, 0.25, s.slope);
  c *= mix(vec3(1.0), uSurfRock, rock) * surfDetail(s, rock);
  vec3 E = s.sunIlluminance * s.shadow;
#ifdef SURF_MARS
  // Oren-Nayar (qualitative model), normalised like the default Lambert: L = E c (1.5 p / pi) mu0 (A + B ...).
  float s2 = uSurfRoughness * uSurfRoughness;
  float A = 1.0 - 0.5 * s2 / (s2 + 0.33);
  float B = 0.45 * s2 / (s2 + 0.09);
  vec3 li = s.sunDir - s.normal * mu0;
  vec3 vi = s.viewDir - s.normal * mu;
  float cphi = max(dot(li, vi) / max(length(li) * length(vi), 1e-5), 0.0);
  float sinA = sqrt(max(1.0 - min(mu0, mu) * min(mu0, mu), 0.0));
  float tanB = sqrt(max(1.0 - max(mu0, mu) * max(mu0, mu), 0.0)) / max(max(mu0, mu), 1e-3);
  vec3 T = atmoSunTransmittance(uSurfRadiusKm + s.height * 0.001, dot(s.up, s.sunDir));
  return E * T * c * (1.5 * uAlbedo / 3.14159265) * mu0 * (A + B * cphi * sinA * tanB);
#else
  // Lommel-Seeliger with Hapke's shadow-hiding opposition surge B(g) = B0 / (1 + tan(g/2) / h).
  float cosg = clamp(dot(s.sunDir, s.viewDir), -1.0, 1.0);
  float tanHalf = sqrt(max(1.0 - cosg, 0.0) / max(1.0 + cosg, 1e-4));
  float surge = 1.0 + uSurfB0 / (1.0 + tanHalf / uSurfH);
  return E * c * (2.0 * uAlbedo / 3.14159265) * lommelSeeliger(mu0, mu) * surge;
#endif
}
