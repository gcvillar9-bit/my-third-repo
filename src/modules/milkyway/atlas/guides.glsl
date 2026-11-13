// Atlas guides (background layer, additive): markers, lines and shell outlines for structures
// that are invisible to the eye or are concepts. Guides are not light: they output a fixed
// pre-exposed colour, so they look the same at every exposure. Positions are pc from the ssb in
// ICRS axes with the camera as an RTE high/low pair (rte.glsl, prepended in the vertex stage).
// One source, three variants: GUIDE_MARKER (points), GUIDE_LINE (line segments), GUIDE_SHELL
// (instanced unit spheres or one mesh, bright where the surface is seen edge-on).
uniform float uGuide;          // global guide opacity (guides.ts)
uniform float uGroup[8];       // per settings group, 0 or 1
varying vec4 vColor;
#ifdef GUIDE_MARKER
varying float vShape;
varying float vSize;
#endif
#ifdef GUIDE_SHELL
varying vec3 vNormal;
varying vec3 vView;
#endif

#ifdef COSMOS_VERTEX
attribute vec3 color;
attribute float group;
uniform float uPixelAngle;
#ifdef GUIDE_MARKER
attribute vec4 params;         // radius (pc), smallest radius (px), far distance (pc), shape code
#define MAX_MARKER_PX 40.0
void main() {
  vec3 rel = rteRelative(position);
  float d = max(length(rel), 1e-6);
  // Only rings grow to the real angular size of the object; other symbols keep their size.
  float real = params.w > 1.5 && params.w < 2.5 ? params.x / (d * uPixelAngle) : 0.0;
  float px = clamp(max(real, params.y), params.y, MAX_MARKER_PX);
  // Fade out towards the far limit, and when the real object is much larger than the symbol.
  float a = uGuide * uGroup[int(group)] * (1.0 - smoothstep(0.6 * params.z, params.z, d)) *
    (1.0 - smoothstep(2.0 * MAX_MARKER_PX, 4.0 * MAX_MARKER_PX, real));
  if (a < 0.004) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = projectionMatrix * vec4((modelViewMatrix * vec4(rel / d, 0.0)).xyz, 1.0);
  gl_PointSize = 2.0 * px + 3.0;
  vColor = vec4(color, a);
  vShape = params.w;
  vSize = px;
}
#endif
#ifdef GUIDE_LINE
attribute float flat;          // 1 for lines that lie in the Galactic plane (arms)
uniform float uPlaneFade;      // 0 when the camera looks along the Galactic plane, 1 from above
void main() {
  vec3 rel = rteRelative(position);
  float d = max(length(rel), 1e-6);
  // Lines in the plane pile up into one bright streak when seen edge-on: fade them out there.
  float a = uGuide * uGroup[int(group)] * mix(1.0, uPlaneFade, flat);
  gl_Position = projectionMatrix * vec4((modelViewMatrix * vec4(rel / d, 0.0)).xyz, 1.0);
  vColor = vec4(color, a);
}
#endif
#ifdef GUIDE_SHELL
#ifdef GUIDE_INSTANCED
attribute vec3 iCenter;        // pc
attribute vec3 iScale;         // semi-axes, pc
attribute vec4 iQuat;          // local axes -> ICRS
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
#else
uniform vec3 uShellCenter;     // pc
uniform float uShellRadius;    // pc
#endif
void main() {
#ifdef GUIDE_INSTANCED
  vec3 p = qrot(iQuat, position * iScale) + iCenter;
  vec3 n = qrot(iQuat, position / iScale);
  vec3 centre = iCenter;
  float radius = max(iScale.x, max(iScale.y, iScale.z));
#else
  vec3 p = position;
  vec3 n = normal;
  vec3 centre = uShellCenter;
  float radius = uShellRadius;
#endif
  vec3 rel = rteRelative(p);
  vec4 mv = modelViewMatrix * vec4(rel, 0.0);
  vNormal = (modelViewMatrix * vec4(n, 0.0)).xyz;
  vView = mv.xyz;
  // Directions only (no depth in the background layer): scale to unit distance for the projection.
  gl_Position = projectionMatrix * vec4(mv.xyz / max(length(mv.xyz), 1e-6), 1.0);
  // A shell is an outline seen from outside: it fades out as the camera comes close or goes inside,
  // so it never veils the sky.
  float outside = smoothstep(1.6, 3.2, length(rteRelative(centre)) / radius);
  vColor = vec4(color, uGuide * uGroup[int(group)] * outside);
}
#endif
#else
#ifdef GUIDE_MARKER
void main() {
  vec2 q = (gl_PointCoord - 0.5) * (2.0 * vSize + 3.0);
  float r = length(q);
  float a = 0.0;
  if (vShape < 1.5) a = smoothstep(vSize, vSize - 1.2, r);                                  // dot
  else if (vShape < 2.5) a = smoothstep(1.1, 0.0, abs(r - vSize + 0.5));                    // ring
  else if (vShape < 3.5) a = smoothstep(1.0, 0.0, min(abs(q.x), abs(q.y))) * step(r, vSize + 1.0);  // cross
  else if (vShape < 4.5) a = smoothstep(1.1, 0.0, abs(abs(q.x) + abs(q.y) - vSize));        // diamond
  else a = smoothstep(1.1, 0.0, abs(max(abs(q.x), abs(q.y)) - vSize + 0.5));                // square
  a *= vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * a * 0.4, 1.0);
}
#endif
#ifdef GUIDE_LINE
void main() {
  if (vColor.a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * vColor.a * 0.45, 1.0);
}
#endif
#ifdef GUIDE_SHELL
void main() {
  float c = abs(dot(normalize(vNormal), normalize(vView)));
  // Bright only where the surface is seen edge-on: the outline of the shell.
  float rim = pow(1.0 - c, 6.0);
  float a = vColor.a * (0.003 + 0.2 * rim);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor.rgb * a, 1.0);
}
#endif
#endif
