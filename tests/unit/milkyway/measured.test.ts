import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Atlas } from '../../../src/modules/milkyway/atlas/catalog';
import {
  coarsen,
  dustFadePc,
  icrsPcToModel,
  REGION_AMPLITUDE,
  REGION_FAINT,
  REGION_GIANT,
  REGIONS_SIZE,
  splatRegions,
  untile,
  type DustMeta,
} from '../../../src/modules/milkyway/atlas/measured';
import type { LayerFile } from '../../../src/modules/milkyway/atlas/types';
import { REGIONS_FADE } from '../../../src/modules/milkyway/galaxy';
import { MODEL, modelGlslDefines, MW_TO_MODEL, SUN_MODEL } from '../../../src/modules/milkyway/model';

const root = (p: string) => new URL(`../../../${p}`, import.meta.url);
const DATA = 'public/data/milkyway/atlas/';
const meta = JSON.parse(readFileSync(root(`${DATA}dust.json`), 'utf8')) as DustMeta;
/** Width and height of a PNG from its IHDR chunk. */
const pngSize = (name: string): [number, number, number] => {
  const b = readFileSync(root(`${DATA}${name}`));
  return [b.readUInt32BE(16), b.readUInt32BE(20), b[25]];
};

describe('measured dust near the Sun', () => {
  it('ships the cube of Edenhofer et al. 2024 with its source, licence and grid', () => {
    expect(meta.source.cite).toMatch(/Edenhofer et al\. 2024/);
    expect(meta.source.license).toBe('CC-BY-4.0');
    expect(meta.source.url).toMatch(/zenodo/);
    const [nx, ny, nz] = meta.size;
    expect([nx * meta.voxelPc, ny * meta.voxelPc, nz * meta.voxelPc]).toEqual(meta.halfPc.map((h) => 2 * h));
    // The slices are tiles of one grey image; the column map has one texel per (x, y).
    const rows = Math.ceil(nz / meta.tileCols);
    expect(pngSize('dust-cube.png')).toEqual([meta.tileCols * nx, rows * ny, 0]);
    expect(pngSize('dust-column.png')).toEqual([nx, ny, 0]);
    expect(meta.radiusPc).toBeGreaterThan(1200);
    expect(meta.radiusPc).toBeLessThan(1260);
    expect(meta.halfPc[0]).toBeGreaterThanOrEqual(meta.radiusPc);
    expect(meta.avPerMapUnit).toBe(2.8);
  });

  it('agrees with the model calibration on average and has the known clouds', () => {
    // The model is calibrated to about 1.3 mag/kpc in the local mid-plane.
    expect(meta.stats.localAvPerKpc).toBeGreaterThan(0.8);
    expect(meta.stats.localAvPerKpc).toBeLessThan(1.8);
    for (const cloud of ['Taurus', 'Ophiuchus', 'Orion A', 'Perseus'])
      expect(meta.stats.cloudsAvPerKpc[cloud], cloud).toBeGreaterThan(5);
    expect(meta.stats.cloudsAvPerKpc['void towards the north Galactic pole']).toBeLessThan(0.3);
    expect(meta.stats.clipped).toBeLessThan(0.002);
    expect(meta.kappaMax).toBeGreaterThan(5);
    expect(meta.tauMax).toBeGreaterThan(0.5);
  });

  it('was resampled in the axes of the galaxy model', () => {
    meta.mwToModel.forEach((v, i) => expect(v).toBeCloseTo(MW_TO_MODEL[i], 8));
    // The Sun of the shader constants is the centre of the cube.
    expect(modelGlslDefines()).toContain('#define MW_SUN vec3(');
    expect(icrsPcToModel(0, 0, 0)).toEqual([SUN_MODEL.x, SUN_MODEL.y, SUN_MODEL.z]);
    const fade = dustFadePc(meta);
    expect(fade[1]).toBeLessThanOrEqual(meta.radiusPc);
    expect(fade[0]).toBeLessThan(fade[1]);
  });

  it('rearranges the tiles into slices and averages them to the coarse cube', () => {
    const m = { size: [3, 2, 5] as [number, number, number], tileCols: 2 };
    const width = m.tileCols * 3;
    const rows = Math.ceil(5 / 2);
    const img = new Uint8Array(width * rows * 2);
    // Tile of slice iz holds the value 10 iz + ix + 3 iy.
    for (let iz = 0; iz < 5; iz++)
      for (let iy = 0; iy < 2; iy++)
        for (let ix = 0; ix < 3; ix++)
          img[(Math.floor(iz / 2) * 2 + iy) * width + (iz % 2) * 3 + ix] = 10 * iz + ix + 3 * iy;
    const cube = untile(img, width, m);
    expect(cube[(4 * 2 + 1) * 3 + 2]).toBe(45);
    expect(cube[(1 * 2 + 0) * 3 + 0]).toBe(10);
    // RGBA input (stride 4) reads the red channel.
    const rgba = new Uint8Array(img.length * 4);
    img.forEach((v, i) => (rgba[4 * i] = v));
    expect(Array.from(untile(rgba, width, m, 4))).toEqual(Array.from(cube));
    // Coarse voxels average the opacity (the square of the stored value), not the stored value.
    const two = coarsen(new Uint8Array([0, 200, 0, 200, 0, 200, 0, 200]), [2, 2, 2], 2);
    expect(two.size).toEqual([1, 1, 1]);
    expect(two.data[0]).toBe(Math.round(Math.sqrt((4 * 200 * 200) / 8)));
  });
});

describe('measured star-forming regions in the arm field', () => {
  const atlas = new Atlas();
  for (const n of ['hii-regions', 'masers'])
    atlas.addLayer(JSON.parse(readFileSync(root(`${DATA}${n}.json`), 'utf8')) as LayerFile);

  it('puts each region at its place, as bright as its measured radio luminosity', () => {
    const { data, count } = splatRegions(atlas);
    expect(count).toBeGreaterThan(1900);
    expect(data.length).toBe(REGIONS_SIZE * REGIONS_SIZE);
    const at = (o: { x: number; y: number; z: number }) => {
      const [mx, my] = icrsPcToModel(o.x, o.y, o.z);
      const px = Math.round((mx / (2 * MODEL.bounds.rMax) + 0.5) * REGIONS_SIZE - 0.5);
      const py = Math.round((my / (2 * MODEL.bounds.rMax) + 0.5) * REGIONS_SIZE - 0.5);
      return data[py * REGIONS_SIZE + px] / 255;
    };
    // W51 is a giant complex: near the full amplitude. The Orion Nebula is forty times fainter.
    const w51 = atlas.objects.find((o) => o.name.startsWith('W 51'))!;
    const orion = atlas.objects.find((o) => o.name === 'Orion A')!;
    expect(at(w51)).toBeGreaterThan(0.5);
    expect(at(orion)).toBeLessThan(0.15);
    const flux = atlas.value(orion, 'flux')!;
    const d = Math.hypot(orion.x, orion.y, orion.z) / 1000;
    expect((REGION_AMPLITUDE * flux * d * d) / REGION_GIANT).toBeLessThan(0.03);
    expect(REGION_FAINT).toBeLessThan(0.05);
    // Most of the square is empty, and the far side has few measured regions.
    const lit = data.reduce((n, v) => n + (v > 25 ? 1 : 0), 0);
    expect(lit).toBeGreaterThan(50);
    expect(lit).toBeLessThan(0.02 * data.length);
    expect(REGIONS_FADE[0]).toBeLessThan(REGIONS_FADE[1]);
  });
});
