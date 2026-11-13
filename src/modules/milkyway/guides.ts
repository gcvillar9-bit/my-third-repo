/**
 * Guide switches of the Milky Way atlas, shared by the settings (registered at startup) and the
 * atlas renderers (loaded later). Guides are the names, outlines and markers of structures that
 * are invisible to the eye or are concepts (arms, bubbles, pulsars, gas clouds, stream tracks).
 *
 * Mode 'auto' (default): guides fade in between 2.0 and 2.5 kpc from the Sun, where the outside
 * view of the galaxy takes over, so every view near the Sun stays as it was; and they are off
 * while the camera is anchored to an object (a black hole, a star system: a close-up of that
 * object, not a view of the Galaxy). 'on': everywhere. In both modes guides fade out between
 * 1.0 and 1.5 Mpc from the Galactic centre.
 */
import { MW_FRAME, ROOT_FRAME, type FrameId } from '../../core/contracts';
import { KPC } from '../../core/units';

export type GuideMode = 'auto' | 'on' | 'off';

export interface AtlasState {
  mode: GuideMode;
  /** Settings groups (looks.json `groups`) switched on. */
  groups: Record<string, boolean>;
  /** Real light of the atlas (cluster stars, Cepheids, satellites, centre populations). */
  light: boolean;
}

export const createAtlasState = (): AtlasState => ({ mode: 'auto', groups: {}, light: true });

export const GUIDE_AUTO_START = 2.0 * KPC;
export const GUIDE_AUTO_END = 2.5 * KPC;
export const GUIDE_FAR_START = 1000 * KPC;
export const GUIDE_FAR_END = 1500 * KPC;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Guide opacity 0..1 for a camera `dSun` metres from the Sun and `dCentre` from Sgr A*, anchored
 * in `frame` (ViewState.frame). In 'auto' the camera must be in open space (the `mw` or
 * `universe` frame).
 */
export function guideAlpha(
  state: AtlasState,
  dSun: number,
  dCentre: number,
  frame: FrameId = MW_FRAME,
): number {
  if (state.mode === 'off') return 0;
  const far = 1 - smooth(GUIDE_FAR_START, GUIDE_FAR_END, dCentre);
  if (state.mode === 'on') return far;
  if (frame !== MW_FRAME && frame !== ROOT_FRAME) return 0;
  return far * smooth(GUIDE_AUTO_START, GUIDE_AUTO_END, dSun);
}
