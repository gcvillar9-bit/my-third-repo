/**
 * Module-level state behind public.ts: shading uniforms and LUT requests can be taken before or
 * after the GPU side exists; parameter edits go to the live pass (its LUT cache rebuilds on the
 * next frame when the physics hash changes).
 */
import type { AtmosphereGpu, ShadingAtmosphereUniforms } from './pass';
import { createShadingUniforms } from './pass';
import type { AtmosphereParams } from './params';

export const shading = new Map<string, ShadingAtmosphereUniforms>();
export const requested = new Set<string>();
let gpu: AtmosphereGpu | null = null;

export function attach(g: AtmosphereGpu | null): void {
  gpu = g;
}

export function shadingUniformsFor(id: string): ShadingAtmosphereUniforms {
  let u = shading.get(id);
  if (!u) {
    u = createShadingUniforms();
    shading.set(id, u);
  }
  return u;
}

export function paramsFor(id: string): AtmosphereParams | undefined {
  return gpu?.params.get(id);
}

/** Merges a partial edit into a body's parameters. Returns false if the body has no atmosphere. */
export function updateParams(id: string, patch: Partial<Omit<AtmosphereParams, 'id'>>): boolean {
  const cur = gpu?.params.get(id);
  if (!gpu || !cur) return false;
  gpu.setParams({ ...cur, ...patch, id });
  return true;
}
