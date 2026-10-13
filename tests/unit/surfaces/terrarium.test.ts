import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decode } from 'fast-png';
import { describe, expect, it } from 'vitest';
import { hdSample, type HdBlock } from '../../../src/modules/surfaces/heightfield';
import { hdZoom } from '../../../src/modules/surfaces/hd';
import {
  decodeTerrarium,
  encodeTerrarium,
  lonLatToTile,
  terrariumHeight,
  terrariumTileUrl,
} from '../../../src/modules/surfaces/terrarium';

/** Same formula as tools/build-surfaces.mjs fixtureHeight. */
const fixtureHeight = (x: number, y: number) =>
  Math.round(
    4500 +
      1800 * Math.exp(-((x - 128) ** 2 + (y - 128) ** 2) / (2 * 50 ** 2)) +
      300 * Math.sin(x / 9) * Math.cos(y / 13),
  );

describe('Terrarium tiles', () => {
  it('decodes R*256 + G + B/256 - 32768 and round-trips the encoder', () => {
    expect(terrariumHeight(128, 0, 0)).toBe(0);
    expect(terrariumHeight(0, 0, 0)).toBe(-32768);
    expect(terrariumHeight(162, 145, 128)).toBeCloseTo(8849.5, 6);
    for (const h of [-10994, -0.5, 0, 1.25, 4500, 8848.86]) {
      const [r, g, b] = encodeTerrarium(h);
      expect(terrariumHeight(r, g, b)).toBeCloseTo(h, 2);
    }
  });

  it('decodes the committed fixture tile to the generating heights', () => {
    const img = decode(readFileSync(resolve('tests/fixtures/surfaces/terrarium-fixture.png')));
    expect([img.width, img.height]).toEqual([256, 256]);
    const h = decodeTerrarium(img.data as ArrayLike<number>, 256 * 256, img.channels);
    for (const [x, y] of [
      [0, 0],
      [128, 128],
      [37, 200],
      [255, 255],
    ])
      expect(h[y * 256 + x]).toBe(fixtureHeight(x, y));
    expect(Math.max(...h)).toBeGreaterThan(6000);
  });

  it('maps lon/lat to Web Mercator tiles and URLs', () => {
    expect(lonLatToTile(0, 0, 0)).toEqual({ x: 0.5, y: 0.5 });
    const t = lonLatToTile(86.925, 27.988, 12);
    expect(Math.floor(t.x)).toBe(3037);
    expect(Math.floor(t.y)).toBe(1716);
    expect(terrariumTileUrl(9, 371, 207)).toBe(
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/9/371/207.png',
    );
    expect(hdZoom(7500)).toBe(9);
    expect(hdZoom(10)).toBe(12);
    expect(hdZoom(3e5)).toBe(5);
  });

  it('samples an HD block bilinearly, fades at its border and skips missing tiles', () => {
    const tile = (v: number) => new Float32Array(256 * 256).fill(v);
    const block: HdBlock = { z: 2, x0: 1, y0: 1, n: 2, urls: ['a', 'b', 'c', null] };
    const tiles = [tile(100), tile(200), tile(300), null];
    const out = new Float64Array(2);
    // Centre of tile (1, 1) at z = 2: lon -67.5, lat ~ +41: u = lon/360 + 0.5, v = 0.5 - lat/180.
    const uvOf = (tx: number, ty: number) => {
      const lon = (tx / 4) * 360 - 180;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / 4))) * 180) / Math.PI;
      return [lon / 360 + 0.5, 0.5 - lat / 180];
    };
    let [u, v] = uvOf(1.5, 1.5);
    expect(hdSample(block, tiles, u, v, out)).toBe(1);
    expect(out[0]).toBeCloseTo(100, 4);
    [u, v] = uvOf(2.5, 1.5);
    hdSample(block, tiles, u, v, out);
    expect(out[0]).toBeCloseTo(200, 4);
    // Across the shared edge of tiles 0 and 1 the value is continuous (bilinear between 100 and 200).
    [u, v] = uvOf(2, 1.5);
    hdSample(block, tiles, u, v, out);
    expect(out[0]).toBeGreaterThan(100);
    expect(out[0]).toBeLessThan(200);
    // Missing tile: weight 0. Outside the block: weight 0. Near the border: partial weight.
    [u, v] = uvOf(2.5, 2.5);
    expect(hdSample(block, tiles, u, v, out)).toBe(0);
    [u, v] = uvOf(0.5, 0.5);
    expect(hdSample(block, tiles, u, v, out)).toBe(0);
    [u, v] = uvOf(1.05, 1.5);
    const w = hdSample(block, tiles, u, v, out);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
  });
});
