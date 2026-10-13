// Relative-to-eye positioning for large point clouds (DESIGN 3.2). The cloud's float32
// positions are relative to the cloud origin (in the cloud's axes). The CPU passes the camera
// position relative to the same origin split into float32 high/low parts (splitDouble in
// src/core/math64.ts). Orientation: set object.quaternion = view.frameQuat(cloudFrame) and keep
// object.position at 0, then use modelViewMatrix * vec4(rteRelative(p), 1.0).
#ifndef COSMOS_RTE_GLSL
#define COSMOS_RTE_GLSL
uniform vec3 uCamHigh;
uniform vec3 uCamLow;
// Single-float positions: (p - camHigh) - camLow keeps the large cancellation exact.
vec3 rteRelative(vec3 p) { return (p - uCamHigh) - uCamLow; }
// Double-single positions (high/low attribute pairs), Cesium style.
vec3 rteRelative2(vec3 pHigh, vec3 pLow) { return (pHigh - uCamHigh) + (pLow - uCamLow); }
#endif
