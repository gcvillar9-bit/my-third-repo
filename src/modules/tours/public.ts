/**
 * Cross-module API of the tours module (P5-B). The UI shell and onboarding start tours through
 * `tours`; the module provides the implementation during init (calls before that are no-ops).
 */
import type { TourStatus } from './player';

export { COSMIC_ZOOM_ID } from './cosmic-zoom';
export type { TourStatus } from './player';
export const TOURS_MODULE_ID = 'tours';
/** Search entry ids are `tour:<tour id>`. */
export const TOUR_ENTRY_PREFIX = 'tour:';

export interface TourControl {
  /** Starts a registered tour (stopping any running one). False when unknown. */
  start(id: string): boolean;
  stop(): void;
  togglePause(): void;
  next(): void;
  status(): TourStatus | null;
}

let impl: TourControl | null = null;

/** Called by the tours module in init. */
export function provideTours(c: TourControl | null): void {
  impl = c;
}

export const tours: TourControl = {
  start: (id) => impl?.start(id) ?? false,
  stop: () => impl?.stop(),
  togglePause: () => impl?.togglePause(),
  next: () => impl?.next(),
  status: () => impl?.status() ?? null,
};
