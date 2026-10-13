// Cosmos logarithmic depth (DESIGN 3.2). Include in BOTH the vertex and fragment shader of
// every ShaderMaterial. Matches three.js logarithmicDepthBuffer (near 0.05 m, far 1e27 m):
//   depth = log2(1 + w) / log2(far + 1)      w = clip-space w = view-space distance along -Z
// Vertex:   after gl_Position is set:  LOG_DEPTH_VERTEX();
// Fragment: at the end of main():      LOG_DEPTH_FRAGMENT();
// Screen passes decode the depth texture with linearFromLogDepth(d) (background pixels = far).
// RawShaderMaterial users must #define varying (out/in) before including this chunk.
#ifndef COSMOS_DEPTH_GLSL
#define COSMOS_DEPTH_GLSL
// log2(CAMERA_FAR + 1) for CAMERA_FAR = 1e27 (unit-tested against contracts.ts).
#define COSMOS_LOG2_FAR_PLUS_1 89.69205856195879
varying float vCosmosLogDepth;
#define LOG_DEPTH_VERTEX() vCosmosLogDepth = 1.0 + gl_Position.w
#define LOG_DEPTH_FRAGMENT() gl_FragDepth = log2(max(vCosmosLogDepth, 1.0)) / COSMOS_LOG2_FAR_PLUS_1
float linearFromLogDepth(float d) { return exp2(d * COSMOS_LOG2_FAR_PLUS_1) - 1.0; }
float logDepthFromLinear(float w) { return log2(1.0 + w) / COSMOS_LOG2_FAR_PLUS_1; }
#endif
