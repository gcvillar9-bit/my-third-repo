/**
 * Measured inputs of the galaxy volume model, loaded with the atlas (after startup):
 * - the 3D dust near the Sun (Edenhofer et al. 2024; dust-cube.png, dust-column.png, dust.json,
 *   built by tools/milkyway/volumes/dust.mjs), which replaces the model's smooth dust inside
 *   about 1.2 kpc of the Sun;
 * - the measured star-forming regions (atlas layers hii-regions and masers), which replace the
 *   hashed HII clumps of the arm field where the Galaxy is mapped.
 * Until they arrive (and with the setting off) the model renders as before.
 */
import {
  ClampToEdgeWrapping,
  Data3DTexture,
  DataTexture,
  LinearFilter,
  RedFormat,
  UnsignedByteType,
  type Texture,
} from 'three';
import type { AssetLoader } from '../../../core/contracts';
import type { GalaxyGpu } from '../galaxy';
import { MODEL, SUN_MODEL, WORLD_TO_MODEL } from '../model';
import type { Atlas } from './catalog';

export interface DustMeta {
  source: { cite: string; url: string; license: string };
  voxelPc: number;
  size: [number, number, number];
  halfPc: [number, number, number];
  tileCols: number;
  kappaMax: number;
  tauMax: number;
  radiusPc: number;
  innerPc: number;
  /** A_V per unit of the source map (the paper's factor). */
  avPerMapUnit: number;
  mwToModel: number[];
  stats: { localAvPerKpc: number; meanTau: number; clipped: number; cloudsAvPerKpc: Record<string, number> };
}

/** The measured dust takes over inside the first radius and has faded into the model by the second (pc). */
export const dustFadePc = (meta: DustMeta): [number, number] => [0.7 * meta.radiusPc, 0.99 * meta.radiusPc];

/** Side of the regions texture (it covers the arm-field square, |x|, |y| < bounds.rMax). */
export const REGIONS_SIZE = 512;
/**
 * HII amplitude of a measured region. The hashed clumps of the model have 0.4 to 1 on an arm and
 * stand for giant star-forming complexes, so a region gets REGION_AMPLITUDE when its radio
 * luminosity (flux density x distance squared, a measure of its ionising light) equals
 * REGION_GIANT (Jy kpc^2; W51 has about 3000, the Orion Nebula 73), and proportionally less
 * below. Regions without a measured flux get REGION_FAINT. The scale is simulated; the ranking
 * of the regions is measured.
 */
export const REGION_AMPLITUDE = 0.7;
export const REGION_GIANT = 3000;
export const REGION_FAINT = 0.02;
/** Edge of a voxel of the coarse dust cube, in voxels of the fine cube. */
export const COARSE_FACTOR = 4;
/** Atlas layers whose rows are star-forming regions. */
export const REGION_LAYERS = ['hii-regions', 'masers'];

/** Sun-centred ICRS parsecs -> model kpc (origin Sgr A*). */
export function icrsPcToModel(x: number, y: number, z: number): [number, number, number] {
  const m = WORLD_TO_MODEL;
  return [
    SUN_MODEL.x + (m[0] * x + m[1] * y + m[2] * z) / 1000,
    SUN_MODEL.y + (m[3] * x + m[4] * y + m[5] * z) / 1000,
    SUN_MODEL.z + (m[6] * x + m[7] * y + m[8] * z) / 1000,
  ];
}

/**
 * HII amplitude of the measured star-forming regions over the arm-field square: one Gaussian of
 * the model's clump size per region, row-major from (-rMax, -rMax), values 0..255.
 */
export function splatRegions(atlas: Atlas, size = REGIONS_SIZE): { data: Uint8Array; count: number } {
  const acc = new Float32Array(size * size);
  const rMax = MODEL.bounds.rMax;
  const sigma = (MODEL.hii.sigma / (2 * rMax)) * size; // px
  const reach = Math.max(2, Math.ceil(3 * sigma));
  let count = 0;
  for (const o of atlas.objects) {
    if (!REGION_LAYERS.includes(o.cls)) continue;
    const [mx, my] = icrsPcToModel(o.x, o.y, o.z);
    const px = (mx / (2 * rMax) + 0.5) * size - 0.5;
    const py = (my / (2 * rMax) + 0.5) * size - 0.5;
    if (!(px > reach && py > reach && px < size - reach && py < size - reach)) continue;
    count++;
    const flux = atlas.value(o, 'flux');
    const dKpc = Math.hypot(o.x, o.y, o.z) / 1000;
    const amp =
      flux === null
        ? REGION_FAINT
        : Math.max(REGION_FAINT / 2, Math.min(1, (REGION_AMPLITUDE * flux * dKpc * dKpc) / REGION_GIANT));
    const cx = Math.round(px);
    const cy = Math.round(py);
    for (let j = cy - reach; j <= cy + reach; j++)
      for (let i = cx - reach; i <= cx + reach; i++) {
        const d2 = (i - px) ** 2 + (j - py) ** 2;
        // A region smaller than a texel still deposits its light: floor the width at half a texel.
        acc[j * size + i] += amp * Math.exp((-0.5 * d2) / Math.max(sigma, 0.5) ** 2);
      }
  }
  const data = new Uint8Array(size * size);
  for (let k = 0; k < acc.length; k++) data[k] = Math.round(255 * Math.min(1, acc[k]));
  return { data, count };
}

/** Rearranges the tiles of dust-cube.png (grey values, row-major) into the cube, slice by slice. */
export function untile(
  grey: Uint8Array | Uint8ClampedArray,
  width: number,
  meta: Pick<DustMeta, 'size' | 'tileCols'>,
  stride = 1,
): Uint8Array {
  const [nx, ny, nz] = meta.size;
  const out = new Uint8Array(nx * ny * nz);
  for (let iz = 0; iz < nz; iz++) {
    const ox = (iz % meta.tileCols) * nx;
    const oy = Math.floor(iz / meta.tileCols) * ny;
    for (let iy = 0; iy < ny; iy++) {
      const row = ((oy + iy) * width + ox) * stride;
      const dst = (iz * ny + iy) * nx;
      if (stride === 1) out.set(grey.subarray(row, row + nx), dst);
      else for (let ix = 0; ix < nx; ix++) out[dst + ix] = grey[row + ix * stride];
    }
  }
  return out;
}

/**
 * The cube averaged over blocks of `factor` voxels per axis. Values are sqrt-encoded opacities, so
 * the average is taken of the squares (the opacity) and encoded again.
 */
export function coarsen(
  cube: Uint8Array,
  size: readonly [number, number, number],
  factor = COARSE_FACTOR,
): { data: Uint8Array; size: [number, number, number] } {
  const [nx, ny, nz] = size;
  const m: [number, number, number] = [
    Math.ceil(nx / factor),
    Math.ceil(ny / factor),
    Math.ceil(nz / factor),
  ];
  const sum = new Float32Array(m[0] * m[1] * m[2]);
  const cnt = new Uint16Array(sum.length);
  for (let iz = 0; iz < nz; iz++) {
    const cz = Math.floor(iz / factor);
    for (let iy = 0; iy < ny; iy++) {
      const cy = Math.floor(iy / factor);
      const row = (iz * ny + iy) * nx;
      const crow = (cz * m[1] + cy) * m[0];
      for (let ix = 0; ix < nx; ix++) {
        const v = cube[row + ix];
        const c = crow + Math.floor(ix / factor);
        sum[c] += v * v;
        cnt[c]++;
      }
    }
  }
  const data = new Uint8Array(sum.length);
  for (let k = 0; k < sum.length; k++) data[k] = Math.round(Math.sqrt(sum[k] / Math.max(1, cnt[k])));
  return { data, size: m };
}

/** Decodes an 8-bit grey PNG into its red channel (browser only). */
async function decodeGrey(url: string): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bmp.width, bmp.height)
      : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const g = canvas.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!g) throw new Error('no 2D canvas to decode the dust map');
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return {
    rgba: g.getImageData(0, 0, canvas.width, canvas.height).data,
    width: canvas.width,
    height: canvas.height,
  };
}

const linear = <T extends Texture>(t: T): T => {
  t.format = RedFormat;
  t.type = UnsignedByteType;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
};

export interface Measured {
  dust: DustMeta | null;
  regions: number;
  /** Switches both measured inputs on or off. */
  setEnabled(on: boolean): void;
}

/** Loads the measured inputs and hands them to the galaxy renderer. Failures leave the model as it is. */
export async function loadMeasured(
  atlas: Atlas,
  assets: AssetLoader,
  gpu: GalaxyGpu,
  enabled: boolean,
): Promise<Measured> {
  const base = 'data/milkyway/atlas/';
  let dust: DustMeta | null = null;
  try {
    const meta = await assets.json<DustMeta>(`${base}dust.json`);
    const [cube, column] = await Promise.all([
      decodeGrey(assets.url(`${base}dust-cube.png`)),
      decodeGrey(assets.url(`${base}dust-column.png`)),
    ]);
    const [nx, ny, nz] = meta.size;
    const fine = untile(cube.rgba, cube.width, meta, 4);
    const cubeTex = new Data3DTexture(fine, nx, ny, nz);
    cubeTex.wrapR = ClampToEdgeWrapping;
    const low = coarsen(fine, meta.size);
    const coarseTex = new Data3DTexture(low.data, low.size[0], low.size[1], low.size[2]);
    coarseTex.wrapR = ClampToEdgeWrapping;
    const col = new Uint8Array(nx * ny);
    for (let k = 0; k < col.length; k++) col[k] = column.rgba[4 * k];
    const fade = dustFadePc(meta);
    gpu.setMeasuredDust(
      linear(cubeTex),
      linear(coarseTex),
      linear(new DataTexture(col, nx, ny)),
      [meta.halfPc[0] / 1000, meta.halfPc[1] / 1000, meta.halfPc[2] / 1000],
      meta.kappaMax,
      meta.tauMax,
      [fade[0] / 1000, fade[1] / 1000],
    );
    dust = meta;
  } catch (e) {
    console.warn('[milkyway] measured dust is not available', e);
  }
  const { data, count } = splatRegions(atlas);
  if (count) gpu.setMeasuredRegions(linear(new DataTexture(data, REGIONS_SIZE, REGIONS_SIZE)));
  const self: Measured = {
    dust,
    regions: count,
    setEnabled(on) {
      gpu.setDustEnabled(on);
      gpu.setRegionsEnabled(on);
    },
  };
  self.setEnabled(enabled);
  return self;
}
