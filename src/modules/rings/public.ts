/**
 * Cross-module API of rings (P3-A). The giants' globe shading reads the ring shadow from here:
 * splice RING_SHADOW_GLSL into the SurfaceShading GLSL, spread ringShadowUniforms(bodyId) into its
 * uniforms (shared objects, updated every frame by the rings module) and call
 * `ringSunTransmission(s.viewPos, s.sunDir)`.
 */
import ringShadowGlsl from './glsl/ring-shadow.glsl?raw';
import { ringState, type RingShadowUniforms } from './state';

export const RINGS_MODULE_ID = 'rings';
/** Planets whose rings this module draws (true radii from rings.json). */
export const RING_BODIES: readonly string[] = ['saturn', 'uranus'];
export const RING_SHADOW_GLSL: string = ringShadowGlsl;
export type { RingShadowUniforms };

/** Shared ring-shadow uniforms of `bodyId`, or undefined when it has no ring system here. */
export function ringShadowUniforms(bodyId: string): RingShadowUniforms | undefined {
  return ringState(bodyId)?.uniforms;
}

export {
  RING_SYSTEMS,
  hgPhase,
  opticalDepth,
  regionAt,
  ringPhase,
  ringSunTransmission,
  type RingRegion,
  type RingSystemSpec,
} from './model';
