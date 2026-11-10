import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { writeWebp } from '../../../tools/lib/image.mjs';

const pub = (p: string) => fileURLToPath(new URL(`../../../public/${p}`, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cosmos-image-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const meanRgb = async (file: string): Promise<number> => {
  const st = await sharp(file).stats();
  return (st.channels[0].mean + st.channels[1].mean + st.channels[2].mean) / 3;
};

describe('texture helper', () => {
  it('keeps the colour of a map whose alpha channel is an (almost empty) mask', async () => {
    // Celestia's io.png and titan.png carry such a mask; resizing used to multiply the colour by it.
    const w = 64;
    const h = 32;
    const data = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[4 * i] = 200;
      data[4 * i + 1] = 180;
      data[4 * i + 2] = 150;
      data[4 * i + 3] = i % 97 === 0 ? 255 : 0;
    }
    const out = join(dir, 'mask.webp');
    await writeWebp({ data, info: { width: w, height: h, channels: 4 } }, out, { width: 32, lossless: true });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(16);
    expect(meta.hasAlpha).toBeFalsy();
    expect(await meanRgb(out)).toBeGreaterThan(170);
  });

  it('keeps alpha when asked to', async () => {
    const data = Buffer.alloc(8 * 4 * 4, 128);
    const out = join(dir, 'alpha.webp');
    await writeWebp({ data, info: { width: 8, height: 4, channels: 4 } }, out, {
      alpha: true,
      lossless: true,
    });
    expect((await sharp(out).metadata()).hasAlpha).toBe(true);
  });
});

describe('shipped body colour maps', () => {
  interface Row {
    id: string;
    textures?: { diffuse?: Record<string, string> };
  }
  const bodies = (JSON.parse(readFileSync(pub('data/solar-system/bodies.json'), 'utf8')) as { bodies: Row[] })
    .bodies;

  it('are not black (every diffuse map has a visible average)', async () => {
    const dark: string[] = [];
    let checked = 0;
    for (const b of bodies) {
      const file = b.textures?.diffuse?.['2k'];
      if (!file) continue;
      expect(existsSync(pub(file)), file).toBe(true);
      checked++;
      // Phobos, the darkest real surface here, averages about 33 of 255.
      if ((await meanRgb(pub(file))) < 20) dark.push(`${b.id}: ${file}`);
    }
    expect(checked).toBeGreaterThan(25);
    expect(dark).toEqual([]);
  });
});
