/**
 * Star populations of the Galactic centre as clouds of simulated points: the nuclear star
 * cluster, the nuclear stellar disc and the Arches and Quintuplet clusters. Size and mass come
 * from the measured facts (features-centre.json); the light per unit mass, the colours and a
 * stand-in radius where none is measured are simulated (looks.json `populations`).
 */
import { ICRS_TO_GALACTIC } from '../../../core/frames';
import { SUN_ABS_MAG_V } from '../../../core/photometry';
import type { Atlas } from './catalog';
import raw from './looks.json';
import { populationPoints, skyBasis, type Population } from './points';

interface PopulationLook {
  /** V-band solar luminosities per solar mass (simulated). */
  lightPerMass: number;
  teff: number;
  /** Flattening 1 - b/a on the sky. */
  ellipticity: number;
  /** Half-light radius (pc) used when the facts give none; 0 = draw nothing without a radius. */
  standInRadiusPc: number;
}

const LOOKS = (raw as unknown as { populations: Record<string, PopulationLook> }).populations;

/** The stellar mass (solar masses) among the facts of a feature, or null. */
export function massFact(
  facts: readonly { label: string; value: string | number; unit?: string }[],
): number | null {
  for (const f of facts) {
    if (!/stellar mass/i.test(f.label) || typeof f.value !== 'number') continue;
    if (f.unit && /M(sun|☉|⊙)/i.test(f.unit)) return f.value;
  }
  return null;
}

/** Position angle (degrees east of north) of the Galactic plane at a Sun-centred ICRS position. */
export function galacticPlanePa(x: number, y: number, z: number): number {
  const g = ICRS_TO_GALACTIC;
  // Direction of increasing Galactic longitude: pole x position (the pole is the third row).
  const t = [g[7] * z - g[8] * y, g[8] * x - g[6] * z, g[6] * y - g[7] * x];
  const { e, n } = skyBasis(x, y, z);
  const te = t[0] * e.x + t[1] * e.y + t[2] * e.z;
  const tn = t[0] * n.x + t[1] * n.y + t[2] * n.z;
  return (Math.atan2(te, tn) * 180) / Math.PI;
}

export function centrePopulations(atlas: Atlas, scale: number): Population[] {
  const out: Population[] = [];
  for (const o of atlas.objects) {
    if (o.file !== 'features-centre') continue;
    const look = LOOKS[o.cls];
    const f = atlas.feature(o);
    if (!look || !f) continue;
    const rHalf = o.r > 0 ? o.r : look.standInRadiusPc;
    const mass = massFact(f.facts ?? []);
    if (mass === null || !(rHalf > 0)) continue;
    const lum = mass * look.lightPerMass;
    out.push({
      x: o.x,
      y: o.y,
      z: o.z,
      rHalf,
      absMag: SUN_ABS_MAG_V - 2.5 * Math.log10(lum),
      ellipticity: look.ellipticity,
      // Flattened along the Galactic plane.
      paDeg: galacticPlanePa(o.x, o.y, o.z),
      teff: look.teff,
      points: populationPoints(lum, scale),
      ext: 1,
    });
  }
  return out;
}
