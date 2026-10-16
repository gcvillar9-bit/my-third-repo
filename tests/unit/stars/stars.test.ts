import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { vec3 } from '../../../src/core/math64';
import { AU, PC } from '../../../src/core/units';
import {
  appMagAt,
  raDec,
  spectralClass,
  StarCatalog,
  type StarNames,
} from '../../../src/modules/stars/catalog';
import { decodeStarsBin, fromHalf } from '../../../src/modules/stars/format';
import { galacticUv, milkyWayFade } from '../../../src/modules/stars/milkyway';
import { pixelScale, yearsSinceJ2000 } from '../../../src/modules/stars/points';
import {
  createInfoProvider,
  createSearchProvider,
  starBookmarks,
  starInfo,
} from '../../../src/modules/stars/providers';

const ROOT = new URL('../../../', import.meta.url).pathname;
const file = (p: string) => readFileSync(`${ROOT}public/${p}`);
const DEG = Math.PI / 180;
const dirOf = (raDeg: number, decDeg: number) =>
  vec3(
    Math.cos(decDeg * DEG) * Math.cos(raDeg * DEG),
    Math.cos(decDeg * DEG) * Math.sin(raDeg * DEG),
    Math.sin(decDeg * DEG),
  );

let cat: StarCatalog;
beforeAll(() => {
  const b = file('data/stars/stars.bin');
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const names = JSON.parse(file('data/stars/names.json').toString('utf8')) as StarNames;
  cat = new StarCatalog(decodeStarsBin(buf), names);
});

describe('stars.bin decoder', () => {
  it('decodes the header and sections', () => {
    expect(cat.count).toBeGreaterThan(100_000);
    expect(cat.data.epochYear).toBe(2000);
    expect(cat.data.namesCount).toBe(cat.names.rows.length);
    expect(cat.displayName(0)).toBe('Sirius');
    expect(fromHalf(0x3c00)).toBe(1);
    expect(fromHalf(0xc000)).toBe(-2);
  });

  it('rejects bad data', () => {
    expect(() => decodeStarsBin(new ArrayBuffer(10))).toThrow(/truncated/);
    expect(() => decodeStarsBin(new ArrayBuffer(64))).toThrow(/magic/);
  });
});

describe('photometry from any viewpoint', () => {
  it('Sirius is m = -1.46 ± 0.05 from Earth', () => {
    const earth = vec3(AU / PC, 0, 0);
    expect(cat.appMag(0, earth)).toBeCloseTo(-1.46, 1);
    expect(Math.abs(cat.appMag(0, earth) + 1.46)).toBeLessThan(0.05);
  });

  it('from α Cen the Sun is m ≈ 0.47 at RA ≈ 2h39m, Dec ≈ +60.8°', () => {
    const a = cat.findByName('Rigil Kentaurus');
    expect(a).toBeGreaterThanOrEqual(0);
    const p = cat.positionPc(a, 0, vec3());
    const toSun = vec3(-p.x, -p.y, -p.z);
    const m = appMagAt(4.83, Math.hypot(p.x, p.y, p.z));
    expect(Math.abs(m - 0.47)).toBeLessThan(0.1);
    const { ra, dec } = raDec(toSun);
    const raMin = (ra / (2 * Math.PI)) * 24 * 60;
    expect(Math.abs(raMin - (2 * 60 + 39))).toBeLessThan(4);
    expect(Math.abs(dec / DEG - 60.8)).toBeLessThan(0.3);
  });

  it('flying away changes magnitudes; proper motion is linear and clamped', () => {
    const sirius = cat.positionPc(0, 0, vec3());
    const near = vec3(sirius.x * 0.5, sirius.y * 0.5, sirius.z * 0.5);
    expect(cat.appMag(0, near)).toBeCloseTo(cat.appMag(0, vec3()) - 5 * Math.log10(2), 3);
    const later = cat.positionPc(0, 1e5, vec3());
    expect(Math.hypot(later.x - sirius.x, later.y - sirius.y, later.z - sirius.z)).toBeGreaterThan(0.1);
    expect(yearsSinceJ2000(2451545 + 365.25e9)).toBe(1e6);
  });

  it('Betelgeuse is redder (cooler) than Rigel', () => {
    const betelgeuse = cat.findByName('Betelgeuse');
    const rigel = cat.findByName('Rigel');
    expect(cat.teff(betelgeuse)).toBeLessThan(3800);
    expect(cat.teff(rigel)).toBeGreaterThan(9000);
    expect(spectralClass(cat.teff(betelgeuse))[0]).toBe('M');
    expect(spectralClass(cat.teff(rigel))[0]).toBe('B');
    expect(spectralClass(5772)).toBe('G3');
  });

  it('pre-exposed pixel scale follows E · exposure / pixel solid angle', () => {
    expect(pixelScale(2, 1e-3)).toBeCloseTo((2.54e-6 * 2) / 1e-6, 9);
  });
});

describe('Milky Way panorama orientation', () => {
  it('maps the galactic centre to the image centre and the north galactic pole to the top row', () => {
    const gc = galacticUv(dirOf(266.405, -28.936));
    expect(gc.u).toBeCloseTo(0.5, 2);
    expect(gc.v).toBeCloseTo(0.5, 2);
    expect(galacticUv(dirOf(192.859, 27.128)).v).toBeCloseTo(1, 3);
    // l = 90° (Cygnus direction) lies left of centre: u = 0.25.
    const l90 = galacticUv(dirOf(318.004, 48.33));
    expect(l90.l / DEG).toBeCloseTo(90, 0);
    expect(l90.u).toBeCloseTo(0.25, 2);
  });

  it('the band in the texture lines up with bright HYG stars of the Milky Way', async () => {
    const img = await sharp(`${ROOT}public/textures/stars/milkyway_diffuse_2k.webp`)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = img.info;
    // The tiers are sRGB-encoded linear values (tools/build-stars.mjs): decode to the linear 0-255 scale.
    const lin = (c: number) => 255 * (c <= 10.31475 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    const grey = new Float32Array(width * height);
    for (let i = 0; i < grey.length; i++)
      grey[i] =
        0.2126 * lin(img.data[i * channels]) +
        0.7152 * lin(img.data[i * channels + 1]) +
        0.0722 * lin(img.data[i * channels + 2]);
    const at = (u: number, v: number) => {
      const x = Math.min(width - 1, Math.floor(u * width));
      const y = Math.min(height - 1, Math.floor((1 - v) * height));
      let s = 0;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const yy = Math.max(0, Math.min(height - 1, y + dy));
          s += grey[yy * width + ((x + dx + width) % width)];
        }
      return s / 49;
    };
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    // 1. The band: mean brightness along b = 0 far exceeds b = ±60°.
    const ring = (b: number) => mean(Array.from({ length: 72 }, (_, k) => at(k / 72, 0.5 + b / 180)));
    expect(ring(0)).toBeGreaterThan(4 * ring(60));
    expect(ring(0)).toBeGreaterThan(4 * ring(-60));
    // 2. The brightest HYG stars leave faint residual halos in the star-removed panorama: each
    //    should sit on a local maximum compared with points 2.5° away (fails if mis-oriented).
    const S = 2.5 / 360;
    const contrasts = Array.from({ length: 30 }, (_, i) => {
      const { u, v } = galacticUv(cat.positionPc(i, 0, vec3()));
      const ring4 = mean([at(u + S, v), at(u - S, v), at(u, v + 2 * S), at(u, v - 2 * S)]);
      return at(u, v) - ring4;
    });
    const positive = contrasts.filter((c) => c > 0.5).length;
    expect(positive).toBeGreaterThanOrEqual(24);
    // 3. The galactic-centre region is brighter than both galactic poles.
    expect(at(0.5, 0.5)).toBeGreaterThan(at(0.5, 0.98));
    expect(at(0.5, 0.5)).toBeGreaterThan(at(0.5, 0.02));
  });

  it('fades out between 200 and 400 pc from the Sun', () => {
    expect(milkyWayFade(0)).toBe(1);
    expect(milkyWayFade(300 * PC)).toBeCloseTo(0.5, 5);
    expect(milkyWayFade(500 * PC)).toBe(0);
  });
});

describe('providers', () => {
  it('search entries carry designations, HIP aliases and a fly-to bookmark', () => {
    const entries = createSearchProvider(cat).entries();
    expect(entries.length).toBe(cat.names.rows.length);
    const sirius = entries.find((e) => e.name === 'Sirius')!;
    expect(sirius.id).toBe('hip:32349');
    expect(sirius.aliases).toEqual(expect.arrayContaining(['α CMa', 'Alpha CMa', '9 CMa', 'HIP 32349']));
    expect(typeof sirius.target).toBe('object');
    const rk = entries.find((e) => e.name === 'Rigil Kentaurus')!;
    expect(rk.aliases).toEqual(expect.arrayContaining(['Alpha Cen', 'Alpha Centauri']));
  });

  it('info cards report distance, spectral class, luminosity and colour temperature', async () => {
    const info = createInfoProvider(cat, { viewerPc: () => vec3(), years: () => 0 });
    const card = await info.info('hip:27989');
    expect(card?.title).toBe('Betelgeuse');
    const labels = card!.facts.map((f) => f.label);
    for (const l of [
      'Distance from the Sun',
      'Spectral class (est.)',
      'Luminosity (V band)',
      'Colour temperature',
    ])
      expect(labels).toContain(l);
    expect(await info.info('earth')).toBeNull();
    const sirius = starInfo(cat, 0, null, 0);
    const ly = sirius.facts.find((f) => f.unit === 'ly')!;
    expect(Number(ly.value)).toBeCloseTo(8.6, 0);
  });

  it('bookmarks: Orion from Earth, and the Sun from α Cen looking back home', () => {
    const bms = starBookmarks(cat);
    expect(bms.map((b) => b.id)).toEqual(['orion-from-earth', 'sun-from-alpha-cen']);
    const a = bms[1];
    expect(Math.hypot(a.pos.x, a.pos.y, a.pos.z) / PC).toBeCloseTo(1.35, 1);
  });
});
