/**
 * Cross-module API of the exoplanets module (P4-C): ids, bookmarks and the pure classification helpers.
 */
import { utcToTt } from '../../core/time';

export const EXOPLANETS_MODULE_ID = 'exoplanets';
export { CLASS_STYLE, classify, habitableZone, radiusFromMass, type PlanetClass } from './classify';
export { SYSTEMS_PATH } from './data';

/** Exoplanet bookmarks are computed at 2026-01-01T00:00:00 UTC (TT) and set that time on arrival. */
export const BOOKMARK_JD = utcToTt(2461041.5);

export const EXOPLANET_BOOKMARKS: readonly {
  id: string;
  system: string;
  planet?: string;
  title: string;
  /** Camera distance as a multiple of the target planet's (or the outermost) semi-major axis. */
  scale: number;
  fovDeg: number;
  lookTarget: string;
}[] = [
  {
    id: 'trappist-1',
    system: 'trappist-1',
    title: "TRAPPIST-1's seven worlds",
    scale: 1.5,
    fovDeg: 50,
    lookTarget:
      "The small red dwarf TRAPPIST-1 at the centre with seven coloured planet markers on faint orbit ellipses and a green habitable-zone band; planets are artist's impressions.",
  },
  {
    id: 'proxima-b',
    system: 'proxima-centauri',
    planet: 'b',
    title: 'Proxima Centauri b',
    scale: 2.5,
    fovDeg: 50,
    lookTarget: "Proxima Centauri (red dwarf) with Proxima b's orbit inside the green habitable zone.",
  },
  {
    id: 'kepler-186f',
    system: 'kepler-186',
    planet: 'f',
    title: 'Kepler-186f',
    scale: 1.6,
    fovDeg: 50,
    lookTarget: 'Kepler-186 with five orbits; f (outermost) near the outer edge of the habitable zone.',
  },
  {
    id: '51-peg-b',
    system: '51-peg',
    planet: 'b',
    title: '51 Pegasi b, the first hot Jupiter',
    scale: 3,
    fovDeg: 50,
    lookTarget:
      '51 Pegasi (Sun-like) with the tight orbit of its hot Jupiter, far inside the habitable zone.',
  },
];
