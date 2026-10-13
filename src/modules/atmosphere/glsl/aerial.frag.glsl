// Aerial-perspective atlas 1024x32: 32 slices of 32x32 froxels side by side. Slice i holds the
// in-scattered radiance (rgb) and mean transmittance (a) from the camera to depth
// uApMax * ((i + 0.5) / 32)^2 along the froxel's view ray.
uniform int uSteps;
void main() {
  vec2 px = gl_FragCoord.xy;
  float slice = floor(px.x / 32.0);
  vec2 suv = vec2(px.x - slice * 32.0, px.y) / 32.0;
  vec4 ray = atmoRay(viewDirFromUv(suv));
  vec3 rd = ray.xyz;
  vec3 ro = uCamPos;
  float r = length(ro);
  float tSlice = uApMax * pow((slice + 0.5) / 32.0, 2.0);
  float tMax = min(tSlice, max(raySphere(ro, rd, uAtmoTop).y, 0.0));
  float tG = groundDistance(r, uCamH, dot(ro, rd) / r);
  if (tG > 0.0) tMax = min(tMax, tG);
  int n = min(max(2 * (int(slice) + 1), 2), uSteps);
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  vec3 f = vec3(0.0);
  atmoMarch(ro, rd, uSunDir, 0.0, tMax, n, false, false, L, T, f);
  gl_FragColor = vec4(L, dot(T, vec3(1.0 / 3.0)));
}
