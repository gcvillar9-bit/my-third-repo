import { describe, expect, it } from 'vitest';
import {
  BLOCK,
  blockAt,
  insideMiddle,
  levelFor,
  tileDeg,
  tileUrl,
} from '../../../src/modules/earth/hd-imagery';
import shading from '../../../src/modules/earth/glsl/shading-earth.glsl?raw';

describe('HD imagery tiles (GIBS EPSG:4326 500m)', () => {
  it('uses the GIBS tile matrix: 2.25 degree tiles of 512 px at level 7', () => {
    expect(tileDeg(7)).toBeCloseTo(2.25, 9);
    expect((tileDeg(7) / 512) * 111_195).toBeLessThan(500); // about 490 m per pixel
    expect(levelFor(2)).toBe(7);
    expect(levelFor(9e5)).toBe(6);
    expect(tileUrl(7, 21, 85)).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/500m/7/21/85.jpeg',
    );
  });

  it('centres a 4x4 block on the camera and re-centres outside its middle', () => {
    const b = blockAt(41.89, 12.49, 7); // Rome
    expect(b.dLon).toBeCloseTo(BLOCK * 2.25, 9);
    expect(41.89).toBeGreaterThan(b.lat0);
    expect(41.89).toBeLessThan(b.lat0 + b.dLat);
    expect(12.49).toBeGreaterThan(b.lon0);
    expect(12.49).toBeLessThan(b.lon0 + b.dLon);
    expect(insideMiddle(b, 41.89, 12.49)).toBe(true);
    expect(insideMiddle(b, 41.89, 12.49 + 0.6 * b.dLon)).toBe(false);
  });

  it('wraps at the antimeridian and clamps at the poles', () => {
    const b = blockAt(-17.7, 179.5, 7); // Fiji
    const cols = 160;
    expect(b.col0).toBeGreaterThanOrEqual(0);
    expect(b.col0).toBeLessThan(cols);
    expect(insideMiddle(b, -17.7, 179.5)).toBe(true);
    expect(insideMiddle(b, -17.7, -179.8)).toBe(true); // across the seam
    const p = blockAt(89.5, 0, 7);
    expect(p.row0).toBe(0);
  });

  it('re-centres after a jump one or more block widths away (no longitude aliasing)', () => {
    const rome = blockAt(41.89, 12.49, 7);
    expect(insideMiddle(rome, 40.42, -3.7)).toBe(false); // Madrid: 2 block widths west
    for (let k = 1; k < 40; k++) expect(insideMiddle(rome, 41.89, 12.49 + k * rome.dLon)).toBe(false);
    expect(insideMiddle(rome, 41.89, 12.49 + 360)).toBe(true);
    const l6 = blockAt(41.89, 12.49, 6);
    expect(insideMiddle(l6, 41.89, 12.49 - l6.dLon)).toBe(false);
  });

  it('bounds a pole block on its equator side only', () => {
    const north = blockAt(88, 1, 7);
    expect(north.lat0 + north.dLat).toBeCloseTo(90, 9);
    expect(insideMiddle(north, 89.99, 1)).toBe(true);
    expect(insideMiddle(north, 84, 1)).toBe(true);
    expect(insideMiddle(north, 70, 1)).toBe(false);
    expect(insideMiddle(north, 0, 1)).toBe(false);
    expect(insideMiddle(north, 70, 30)).toBe(false);
    const south = blockAt(-88, 1, 7);
    expect(south.lat0).toBeCloseTo(-90, 9);
    expect(insideMiddle(south, -89.99, 1)).toBe(true);
    expect(insideMiddle(south, -84, 1)).toBe(true);
    expect(insideMiddle(south, -70, 1)).toBe(false);
  });

  it('keeps a point on a tile edge inside the block just centred on it', () => {
    for (const level of [6, 7])
      for (const [lat, lon] of [
        [45, 0],
        [0, -180],
        [-45, 90],
        [88, 0],
        [-88, 179.99],
      ]) {
        const b = blockAt(lat, lon, level);
        expect(insideMiddle(b, lat, lon), `${level} ${lat} ${lon}`).toBe(true);
      }
  });

  it('blends inside the block only, with gradients taken outside the branch', () => {
    const i = shading.indexOf('vec2 hdx = dFdx(hu);');
    const j = shading.indexOf('if (uEarthHdMix > 0.0');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(shading).toContain('textureGrad(uEarthHd, hu, hdx, hdy)');
  });
});
