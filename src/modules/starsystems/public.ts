/**
 * Cross-module API of the starsystems module (P4-C). The exoplanets module promotes host stars through
 * `starSystems()`; orbit helpers are shared pure functions.
 */
import type { Vec3d } from '../../core/contracts';
import type { CustomStar } from './promotion';

export type { CustomStar, PromotedStar } from './promotion';
export { PROMOTE_PC, RELEASE_PC, SPHERE_MIN_PX, starFrameId } from './promotion';
export {
  deg,
  estimateRadiusRsun,
  hashPhase,
  luminosityLsun,
  meanAnomalyJ2000,
  orbitNormal,
  orbitOffset,
  skyBasis,
  solveKepler,
  type Elements,
  type SkyBasis,
} from './orbit';
export const STARSYSTEMS_MODULE_ID = 'starsystems';
export const CONSTELLATIONS_SETTING = 'starsystems.constellations';

export interface StarSystemsApi {
  /** Promotes the system containing HYG star `index` (held until `release(owner)`); returns the star's frame id. */
  promoteStar(index: number, owner: string): string | null;
  /** Promotes a star that is not in HYG; returns its frame id. */
  promoteCustom(star: CustomStar, owner: string): string;
  /** Releases every promotion held by `owner`. */
  release(owner: string): void;
  /** Position of a HYG star (pc, Sun-centred ICRS) honouring the system rows (distance overrides). */
  starPositionPc(index: number, years: number, out: Vec3d): Vec3d;
}

let resolve: (api: StarSystemsApi) => void = () => {};
const apiPromise = new Promise<StarSystemsApi>((r) => (resolve = r));

/** Resolves once the starsystems module has initialised. */
export const starSystems = (): Promise<StarSystemsApi> => apiPromise;

/** @internal */
export const resolveStarSystems = (api: StarSystemsApi): void => resolve(api);
