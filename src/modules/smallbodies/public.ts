/**
 * Cross-module API of smallbodies (import only this file from other modules).
 *
 * - `generateBelts(count, seed)`: deterministic heliocentric ecliptic J2000 elements of the main
 *   belt (Kirkwood gaps), Hildas, Jupiter Trojans, classical Kuiper belt and plutinos.
 * - `positionAt(belts, k, jd)`: float64 twin of the GPU propagation (AU, ecliptic axes).
 * - `solveKepler4(M, e)`: the shader's Kepler solver (Mikkola starter + 4 Newton iterations).
 */
export {
  KIND,
  EPOCH_JD,
  generateBelts,
  mainBeltDensity,
  planetMeanLongitude,
  populationCounts,
  positionAt,
  rebase,
  type BeltElements,
  type PopulationName,
} from './generate';
export { solveKepler4, keplerStart, wrapPi } from './kepler4';
export { BELT_ID } from './belt';
export { BELT_BOOKMARK_ID } from './bookmarks';
export const SMALLBODIES_MODULE_ID = 'smallbodies';
