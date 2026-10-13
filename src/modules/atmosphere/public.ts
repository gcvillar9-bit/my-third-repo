/**
 * Cross-module API of the atmosphere module (import only this file from other modules).
 *
 * - ATMOSPHERE_TRANSMITTANCE_GLSL defines `vec3 atmoSunTransmittance(float rKm, float mu)` for
 *   surface shaders; splice `atmosphereShadingUniforms(bodyId)` into the material uniforms (shared
 *   by reference) and call `requestAtmosphereLuts(bodyId)` so the LUT exists before the scene renders.
 *   rKm is the radius in atmosphere space (equatorial radius + height), mu the Sun zenith cosine.
 * - The composite applies aerial perspective to every surface; shadings must not add their own haze.
 */
import transmittanceLookup from './glsl/transmittance-lookup.glsl?raw';
import { ATMOSPHERE_ROWS, type AtmosphereParams } from './params';
import { paramsFor, requested, shadingUniformsFor, updateParams } from './service';

export const ATMOSPHERE_MODULE_ID = 'atmosphere';
export const ATMOSPHERE_TRANSMITTANCE_GLSL: string = transmittanceLookup;
/** Bodies with a parameter set (planets.json). */
export const ATMOSPHERE_BODY_IDS: readonly string[] = ATMOSPHERE_ROWS.map((r) => r.id);
export const MARS_GALE_SUNSET_ID = 'mars-gale-sunset';

export type { AtmosphereParams } from './params';
export type { ShadingAtmosphereUniforms } from './pass';

/** Uniforms (uAtmoTransmittance, uAtmoRadii, uAtmoReady) for ATMOSPHERE_TRANSMITTANCE_GLSL. */
export const atmosphereShadingUniforms = shadingUniformsFor;

/** Keeps a body's static LUTs built every frame (before the main scene). */
export function requestAtmosphereLuts(bodyId: string): void {
  requested.add(bodyId);
}

export function getAtmosphereParams(bodyId: string): Readonly<AtmosphereParams> | undefined {
  return paramsFor(bodyId);
}

/** Edits a body's parameters at runtime; the static LUTs rebuild only if the physics changed. */
export const updateAtmosphereParams = updateParams;
