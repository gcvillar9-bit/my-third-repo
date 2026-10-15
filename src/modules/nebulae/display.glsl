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
uniform float uAlphaScale;   // 1 - milkyWayFade: near the Sun the panorama photo already holds M42's dust
uniform mat3 uBasis;         // columns: RGB of unit-luminance Hα, [OIII], scattered
uniform float uAstro;        // 1: Astrophoto tone curve
uniform float uSoft;
uniform float uSaturation;
// Full-resolution detail for distant views (the march runs at a reduced resolution).
uniform sampler2D uEmission;
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
      vec3 sharp = pow(texture2D(uEmission, uv).rgb, vec3(NEB_ENC));
      vec3 soft = pow(texture2D(uEmission, uv, uLodBias).rgb, vec3(NEB_ENC));
      float s = sharp.x + sharp.y + sharp.z;
      float b = soft.x + soft.y + soft.z;
      float ratio = b > 1e-6 ? clamp(s / b, 0.25, 4.0) : 1.0;
      L *= mix(1.0, ratio, uDetail);
    }
  }
  vec3 rgb = uBasis * L * uExposure;
  if (uAstro > 0.5) {
    float y = nebLum(rgb);
    float ys = y > 0.0 ? asinh(y / uSoft) / asinh(1.0 / uSoft) : 0.0;
    rgb *= y > 0.0 ? ys / y : 0.0;
    rgb = max(vec3(ys) + uSaturation * (rgb - vec3(ys)), vec3(0.0));
  }
  gl_FragColor = vec4(rgb, clamp(m.a, 0.0, 1.0) * uAlphaScale);
}
#endif
