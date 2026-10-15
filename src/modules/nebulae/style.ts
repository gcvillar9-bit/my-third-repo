/**
 * The "Nebula style" auto-on / auto-off rule, the same pattern as the Sun's H-alpha filter (src/modules/sun/index.ts):
 * - arriving at a style bookmark (palette, tour, URL) switches Astrophoto on; only the arrival does, so the user
 *   can switch it off again while staying there;
 * - a style switched on by arrival goes back to Realistic when the camera leaves the nebula (beyond
 *   AUTO_OFF_PC from θ¹ Ori C) or arrives at another bookmark, unless the user has changed it since;
 * - an explicit ?nebulae.style= wins over the initial bookmark and is never undone.
 * Pure state machine; index.ts wires it to the settings store, the camera and the frame loop.
 */
import type { NebulaStyle } from './display';

export const STYLE_SETTING = 'nebulae.style';
export const ENABLED_SETTING = 'nebulae.enabled';
/** A style switched on by arrival goes back off beyond this distance from θ¹ Ori C, pc. */
export const AUTO_OFF_PC = 60;

export class StyleAuto {
  /** True while the current Astrophoto setting was made by an arrival (and may be undone). */
  autoOn = false;
  private ours = false;
  private atStyleBookmark = false;

  constructor(private readonly write: (v: NebulaStyle) => void) {}

  /** Boot: an explicit URL override wins; otherwise a style bookmark as the initial view switches it on. */
  start(override: string | null, initialAtStyleBookmark: boolean): void {
    if (override === 'realistic' || override === 'astrophoto') {
      this.write(override);
      this.autoOn = false;
    } else if (initialAtStyleBookmark) this.set('astrophoto');
    this.atStyleBookmark = initialAtStyleBookmark;
  }

  /** Settings store notification (any change of the style setting). */
  changed(): void {
    if (!this.ours) this.autoOn = false; // the user took over
  }

  /** The camera came to rest: at a style bookmark, and/or at some other bookmark. */
  arrived(atStyleBookmark: boolean, atOtherBookmark: boolean): void {
    if (atStyleBookmark && !this.atStyleBookmark) this.set('astrophoto');
    else if (!atStyleBookmark && this.autoOn && atOtherBookmark) this.set('realistic');
    this.atStyleBookmark = atStyleBookmark;
  }

  /** Per frame: the camera's distance from θ¹ Ori C, pc. */
  distance(pc: number): void {
    if (this.autoOn && pc > AUTO_OFF_PC) this.set('realistic');
  }

  private set(v: NebulaStyle): void {
    this.ours = true;
    try {
      this.write(v);
    } finally {
      this.ours = false;
    }
    this.autoOn = v === 'astrophoto';
  }
}
