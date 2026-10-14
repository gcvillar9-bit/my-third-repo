/**
 * Runtime space-velocity corrections (overrides.json rows, each with a source) applied to decoded star
 * data before it reaches the GPU and the catalogue. Pure; also used by the unit tests.
 */
import { DataUtils } from 'three';
import overrides from './overrides.json';
import type { StarNames } from './catalog';
import type { StarData } from './format';

const KMS_PER_AU_YR = 4.740470446;

/** Patches `data.velocityHalf` in place; returns the number of stars corrected. */
export function applyVelocityOverrides(data: StarData, names: StarNames): number {
  let n = 0;
  for (const o of overrides.velocity) {
    const row = names.rows.find((r) => r[1] === o.hip);
    if (!row) continue;
    const i = row[0];
    const x = data.position[3 * i];
    const y = data.position[3 * i + 1];
    const z = data.position[3 * i + 2];
    const d = Math.hypot(x, y, z);
    const r = [x / d, y / d, z / d];
    const ra = Math.atan2(r[1], r[0]);
    const dec = Math.asin(r[2]);
    const east = [-Math.sin(ra), Math.cos(ra), 0];
    const north = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
    const ve = (KMS_PER_AU_YR * d * o.pmRaMasYr) / 1000;
    const vn = (KMS_PER_AU_YR * d * o.pmDecMasYr) / 1000;
    for (let c = 0; c < 3; c++)
      data.velocityHalf[3 * i + c] = DataUtils.toHalfFloat(o.rvKms * r[c] + ve * east[c] + vn * north[c]);
    n++;
  }
  return n;
}
