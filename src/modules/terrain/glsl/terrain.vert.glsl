// Terrain patch vertex shader. render.ts prepends the depth chunk. object.position is the
// camera-relative tile centre (float64 on the CPU), object.quaternion is body-fixed -> world, and
// `position` holds Float32 offsets from the tile centre in body-fixed axes.
// Hand-off morph: uMorph = 0 flattens the patch onto the reference ellipsoid (what the sphere
// provider draws), uMorph = 1 is the full relief.
attribute vec4 aUpH; // xyz radial unit direction (body-fixed), w height above the ellipsoid, m
uniform float uMorph;
uniform vec3 uRadii;
varying vec3 vViewPos;    // camera-relative position, world axes, m
varying vec3 vDirBody;    // radial direction, body-fixed
varying vec3 vNormalBody; // shading normal, body-fixed
varying float vHeight;
void main() {
  vec3 p = position - aUpH.xyz * (aUpH.w * (1.0 - uMorph));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vViewPos = wp.xyz;
  vDirBody = aUpH.xyz;
  vec3 nEll = normalize(aUpH.xyz / (uRadii * uRadii));
  vNormalBody = mix(nEll, normal, uMorph);
  vHeight = aUpH.w * uMorph;
  gl_Position = projectionMatrix * viewMatrix * wp;
  LOG_DEPTH_VERTEX();
}
