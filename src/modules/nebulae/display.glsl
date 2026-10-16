// Background-layer composite of the cached nebula march (display.ts twin): a quad over the march rect, blended
// premultiplied (dust dims what is behind, stars drawn later stay undimmed). Output L · uExposure.
#ifdef COSMOS_VERTEX
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
#else
uniform sampler2D uTex;      // march: components · uStore, opacity
uniform vec2 uTexScale;      // used part of the target, uv
uniform vec2 uTexMax;        // last texel centre, uv
uniform float uInvStore;
uniform float uGain;
uniform float uExposure;
uniform float uAlphaScale;   // 1 - milkyWayFade: near the Sun the panorama stands for the whole sky glow
uniform mat3 uBasis;         // columns: RGB of unit-luminance Hα, [OIII], scattered
uniform float uAstro;        // 1: Astrophoto tone curve
uniform float uAstroRef;     // cd/m², the calibrated core
uniform float uAstroPeak;
uniform float uSoft;
uniform float uSaturation;
// Full-resolution detail for distant views (the march runs at a reduced resolution).
uniform sampler2D uEmission; // linear-light, mipmapped: L / NEB_LREF per component
uniform sampler2D uCore;     // linear-light, mipmapped: Hubble detail ratio (R)
uniform float uHasCore;
uniform float uDetail;
uniform float uLodBias;
uniform vec3 uOrigin;
uniform mat3 uRayBasis;
uniform vec4 uRect;
varying vec2 vUv;

float nebLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 m = texture2D(uTex, min(vUv * uTexScale, uTexMax));
  vec3 L = max(m.rgb, vec3(0.0)) * uInvStore * uGain;
  if (uDetail > 0.0) {
    // Where the view ray meets the plane through θ¹ Ori C: sharp texel over the march-resolution average.
    vec3 rd = uRayBasis * vec3(mix(uRect.xy, uRect.zw, vUv), 1.0);
    float t = -uOrigin.z / rd.z;
    if (t > 0.0) {
      vec3 p = uOrigin + rd * t;
      vec2 xe = p.xy / (NEB_D + p.z);
      vec2 uv = vec2(0.5 - xe.x * (0.5 / NEB_XI_MAX), 0.5 + xe.y * (0.5 / NEB_XI_MAX));
      vec3 sharp = texture2D(uEmission, uv).rgb;
      vec3 soft = texture2D(uEmission, uv, uLodBias).rgb;
      float s = sharp.x + sharp.y + sharp.z;
      float b = soft.x + soft.y + soft.z;
      float ratio = b > 1e-9 ? s / b : 1.0;
      // The Hubble core detail the march resolution averaged away.
      vec2 cuv = vec2(0.5 - xe.x * (0.5 / NEB_CORE_XI), 0.5 + xe.y * (0.5 / NEB_CORE_XI));
      if (uHasCore > 0.5 && all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0)))) {
        float cs = texture2D(uCore, cuv).r;
        float cb = texture2D(uCore, cuv, uLodBias).r;
        ratio *= cb > 1e-6 ? cs / cb : 1.0;
      }
      L *= mix(1.0, clamp(ratio, 0.25, 4.0), uDetail);
    }
  }
  vec3 rgb = uBasis * L;
  if (uAstro > 0.5) {
    // Exposure-independent stretch of the physical luminance against the calibrated core (display.ts ASTRO).
    float y = nebLum(rgb);
    float ys = y > 0.0 ? uAstroPeak * uAstroRef * asinh(y / (uSoft * uAstroRef)) / asinh(1.0 / uSoft) : 0.0;
    rgb *= y > 0.0 ? ys / y : 0.0;
    rgb = max(vec3(ys) + uSaturation * (rgb - vec3(ys)), vec3(0.0));
  }
  gl_FragColor = vec4(rgb * uExposure, clamp(m.a, 0.0, 1.0) * uAlphaScale);
}
#endif
