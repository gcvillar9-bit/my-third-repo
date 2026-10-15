// One-time copy of an 8-bit nebula texture into a linear-light HalfFloat target (render.ts), whose mip chain then
// averages light rather than encoded values. Prefixed with nebulaGlslDefines().
uniform sampler2D uSrc;
uniform float uMode; // 0: emission, v^NEB_ENC = L / NEB_LREF; 1: core detail ratio 2^((v - 0.5) · 2 · NEB_CORE_SPAN)
varying vec2 vUv;
void main() {
  vec3 v = textureLod(uSrc, vUv, 0.0).rgb;
  gl_FragColor = uMode < 0.5
    ? vec4(pow(v, vec3(NEB_ENC)), 1.0)
    : vec4(vec3(exp2((v.r - 0.5) * 2.0 * NEB_CORE_SPAN)), 1.0);
}
