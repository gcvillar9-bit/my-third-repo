import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vec3 } from '../../../src/core/math64';
import { StarCatalog, type StarNames } from '../../../src/modules/stars/catalog';
import { decodeStarsBin } from '../../../src/modules/stars/format';
import { applyVelocityOverrides } from '../../../src/modules/stars/overrides';

const ROOT = new URL('../../../', import.meta.url).pathname;

describe('proper motion from stars.bin velocities', () => {
  it("moves Barnard's Star by 10.3 arcsec per year", () => {
    const buf = readFileSync(`${ROOT}public/data/stars/stars.bin`);
    const names = JSON.parse(readFileSync(`${ROOT}public/data/stars/names.json`, 'utf8')) as StarNames;
    const data = decodeStarsBin(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const rate = (cat: StarCatalog) => {
      const i = cat.findByHip(87937); // Barnard's Star
      expect(i).toBeGreaterThanOrEqual(0);
      // Over 100 years to stay clear of float16 rounding in the per-year step.
      const a = cat.positionPc(i, 0, vec3());
      const b = cat.positionPc(i, 100, vec3());
      const cos =
        (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
      return ((Math.acos(Math.min(1, cos)) * 180) / Math.PI) * 36;
    };
    // Raw HYG velocities: pmdec is clipped at 9999.99 mas/yr upstream, so about 10.1"/yr.
    const raw = rate(new StarCatalog(data, names));
    expect(raw).toBeGreaterThan(9.9);
    expect(raw).toBeLessThan(10.2);
    // The stars module applies the Gaia DR3 override (overrides.json) at load: 10.3-10.4"/yr.
    expect(applyVelocityOverrides(data, names)).toBe(1);
    const fixed = rate(new StarCatalog(data, names));
    expect(fixed).toBeGreaterThan(10.3);
    expect(fixed).toBeLessThan(10.5);
  });
});
