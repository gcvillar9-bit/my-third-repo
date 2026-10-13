/**
 * SurfaceShading overrides (priority 5) for airless bodies and Mars. They wrap the solar-system
 * default shading of the same body: its uniforms (albedo map, map scale, geometric albedo, tint) are
 * the same IUniform objects, and its update() keeps driving the lazy texture load, so the maps load
 * once and appear on both the sphere and the terrain.
 */
import { Vector3, type IUniform, type Texture } from 'three';
import type { SurfaceShading, ViewState } from '../../core/contracts';
import { PHASE_GLSL } from '../../render/chunks';
import { ATMOSPHERE_TRANSMITTANCE_GLSL, atmosphereShadingUniforms } from '../atmosphere/public';
import surfaceGlsl from './glsl/surface.glsl?raw';

export const SURFACE_SHADING_PRIORITY = 5;

export interface MaterialParams {
  /** Opposition surge amplitude B0 and width h (Hapke); airless only. */
  b0: number;
  h: number;
  /** Oren-Nayar roughness sigma (rad); Mars only. */
  roughness: number;
  /** Albedo factor of steep rock relative to flat regolith (linear RGB). */
  rock: [number, number, number];
  /** Contrast of the triplanar detail bands. */
  detailAmp: number;
}

/** Per-body material parameters (approximate; Hapke fits: Moon B0 ~ 1, h ~ 0.06, softened here). */
export function materialFor(bodyId: string): MaterialParams {
  switch (bodyId) {
    case 'mars':
      return { b0: 0, h: 0.1, roughness: 0.45, rock: [0.72, 0.74, 0.8], detailAmp: 0.3 };
    case 'moon':
      return { b0: 0.4, h: 0.06, roughness: 0, rock: [1.25, 1.25, 1.25], detailAmp: 0.35 };
    case 'mercury':
      return { b0: 0.4, h: 0.07, roughness: 0, rock: [1.2, 1.2, 1.2], detailAmp: 0.3 };
    case 'io':
      return { b0: 0.25, h: 0.06, roughness: 0, rock: [0.8, 0.78, 0.75], detailAmp: 0.25 };
    default:
      return { b0: 0.3, h: 0.05, roughness: 0, rock: [1.1, 1.1, 1.12], detailAmp: 0.25 };
  }
}

export interface SurfaceShadingDeps {
  bodyId: string;
  /** The default (priority 0) shading of the body; its uniforms are shared. */
  base: SurfaceShading;
  detail: Texture;
  /** Equatorial radius, m (Mars atmosphere lookup). */
  radius: number;
  mars: boolean;
}

export function createSurfaceShading(d: SurfaceShadingDeps): SurfaceShading {
  const m = materialFor(d.bodyId);
  const uniforms: Record<string, IUniform> = {
    ...d.base.uniforms,
    uSurfDetail: { value: d.detail },
    uSurfB0: { value: m.b0 },
    uSurfH: { value: m.h },
    uSurfRoughness: { value: m.roughness },
    uSurfRock: { value: new Vector3(...m.rock) },
    uSurfDetailAmp: { value: m.detailAmp },
    uSurfRadiusKm: { value: d.radius / 1000 },
  };
  const defines: Record<string, string | number | boolean> = {};
  let prelude = `${PHASE_GLSL}\n`;
  if (d.mars) {
    Object.assign(uniforms, atmosphereShadingUniforms(d.bodyId));
    prelude += `${ATMOSPHERE_TRANSMITTANCE_GLSL}\n`;
    defines.SURF_MARS = 1;
  }
  return {
    bodyId: d.bodyId,
    priority: SURFACE_SHADING_PRIORITY,
    glsl: prelude + surfaceGlsl,
    uniforms,
    defines,
    update(view: ViewState) {
      d.base.update?.(view);
    },
  };
}
