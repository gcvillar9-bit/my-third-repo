/**
 * Per-body HeightSourceSpecs of the surfaces module (worker module 'surface'). Numbers are hand-set
 * and approximate; see docs/modules/surfaces.md for their sources and rationale.
 */
import type { Body, HeightSourceSpec } from '../../core/contracts';
import type { CraterParams } from './craters';
import { heightBound, type SurfaceHeightParams } from './heightfield';
import { stringSeed } from './noise';
import rasters from './rasters.json';

export const SURFACE_HEIGHT_MODULE = '/src/modules/surfaces/height/surface.ts';
/** Above terrain's default (0) and any P1 spec. */
export const SURFACE_HEIGHT_PRIORITY = 5;

const G_MOON = 1.62;
/** Lunar simple-to-complex transition diameter, m (Pike 1977). */
export const MOON_TRANSITION_D = 15000;

/** Generic icy bodies: craters with relaxation plus soft fBm. */
export const ICY_BODIES: readonly string[] = [
  'ganymede',
  'mimas',
  'enceladus',
  'tethys',
  'dione',
  'rhea',
  'iapetus',
  'miranda',
  'ariel',
  'umbriel',
  'titania',
  'oberon',
  'triton',
  'charon',
  'pluto',
  'eris',
  'haumea',
  'makemake',
];

export const SURFACE_BODIES: readonly string[] = [
  'moon',
  'mars',
  'earth',
  'mercury',
  'callisto',
  'ceres',
  'europa',
  'io',
  ...ICY_BODIES,
];

export const surfaceGravity = (b: Body): number =>
  b.gm && b.radius > 0 ? b.gm / (b.radius * b.radius) : G_MOON;

/** Simple-to-complex transition: 15 km scaled by g_moon / g. */
export const transitionDiameter = (g: number): number => MOON_TRANSITION_D * (G_MOON / Math.max(g, 1e-3));

type Partial = Omit<SurfaceHeightParams, 'maxAbs' | 'bodyId' | 'radius' | 'seed'>;

function craters(seed: number, g: number, c: Omit<CraterParams, 'seed' | 'transitionD'>): CraterParams {
  return { seed: (seed ^ 0x7f4a7c15) | 0, transitionD: transitionDiameter(g), ...c };
}

/** Layer set for one body, or undefined when the surfaces module has nothing for it. */
export function surfaceLayers(b: Body, seed: number): Partial | undefined {
  const R = b.radius;
  const g = surfaceGravity(b);
  switch (b.id) {
    case 'moon':
      return {
        raster: rasters.moon,
        craters: craters(seed, g, { density: 0.06, dMax: 16000, dMin: 1, degrade: 0.75 }),
        fbm: { lambda0: 8000, a0: 60, hurst: 0.85 },
      };
    case 'mars':
      return {
        raster: rasters.mars,
        craters: craters(seed, g, { density: 0.02, dMax: 20000, dMin: 2, degrade: 0.85 }),
        fbm: { lambda0: 10000, a0: 60, hurst: 0.8 },
        dunes: { lambda: 250, amp: 8, maskLambda: 150000, threshold: 0.15 },
      };
    case 'earth':
      return {
        raster: rasters.earth,
        ocean: { path: rasters.earth.oceanPath, floor: false },
        ridged: { lambda0: 15000, a0: 60, hurst: 0.8, perMetre: 0.16 },
      };
    case 'mercury':
      return {
        craters: craters(seed, g, { density: 0.08, dMax: 160000, dMin: 1, degrade: 0.7 }),
        fbm: { lambda0: 100000, a0: 600, hurst: 0.9 },
      };
    case 'callisto':
      return {
        craters: craters(seed, g, { density: 0.12, dMax: 160000, dMin: 1, degrade: 0.85, relaxD: 60000 }),
        fbm: { lambda0: 100000, a0: 400, hurst: 0.9 },
      };
    case 'ceres':
      return {
        craters: craters(seed, g, { density: 0.08, dMax: 60000, dMin: 1, degrade: 0.6, relaxD: 100000 }),
        fbm: { lambda0: 50000, a0: 400, hurst: 0.9 },
      };
    case 'europa':
      return {
        craters: craters(seed, g, { density: 0.002, dMax: 30000, dMin: 50, degrade: 0.5 }),
        ridges: [
          { cell: 40000, amp: 200, width: 1200 },
          { cell: 10000, amp: 80, width: 400 },
          { cell: 2500, amp: 25, width: 100 },
        ],
        fbm: { lambda0: 20000, a0: 60, hurst: 0.8 },
      };
    case 'io':
      return {
        craters: craters(seed, g, {
          density: 0.004,
          dMax: 100000,
          dMin: 5000,
          degrade: 0.5,
          kind: 'caldera',
          calderaDepth: 1200,
        }),
        fbm: { lambda0: 200000, a0: 800, hurst: 0.9 },
      };
    default:
      if (!ICY_BODIES.includes(b.id)) return undefined;
      return {
        craters: craters(seed, g, {
          density: 0.04,
          dMax: Math.min(R / 10, 100000),
          dMin: 1,
          degrade: 0.6,
          relaxD: 40000,
        }),
        fbm: { lambda0: Math.min(R / 4, 50000), a0: Math.min(R / 4, 50000) * 0.006, hurst: 0.85 },
      };
  }
}

/** The HeightSourceSpec for a body, or undefined. */
export function surfaceHeightSpec(b: Body): HeightSourceSpec | undefined {
  const seed = stringSeed(b.id, 0x5eed);
  const layers = surfaceLayers(b, seed);
  if (!layers) return undefined;
  const base = { bodyId: b.id, radius: b.radius, seed, ...layers };
  const params: SurfaceHeightParams = { ...base, maxAbs: heightBound(base) };
  return {
    bodyId: b.id,
    workerModule: SURFACE_HEIGHT_MODULE,
    params,
    maxAbsHeight: params.maxAbs,
    priority: SURFACE_HEIGHT_PRIORITY,
  };
}
