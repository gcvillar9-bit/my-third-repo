/**
 * Photo mode state (P5-B), free of DOM and three.js so it can be unit-tested: entering hides the
 * UI (UiApi.setHudVisible + the <html data-photo> flag) and remembers FOV and exposure
 * compensation; exiting restores them. FOV is clamped to 5-120°, compensation to ±6 stops.
 */
export const FOV_MIN_DEG = 5;
export const FOV_MAX_DEG = 120;
export const EV_COMP_LIMIT = 6;
export const EV_STEP = 0.5;

const DEG = Math.PI / 180;

export interface PhotoDeps {
  setHudVisible(visible: boolean): void;
  /** Sets or clears the document-level photo flag (CSS hides UI, labels, overlays). */
  setFlag(on: boolean): void;
  getFovY(): number;
  setFovY(rad: number): void;
  exposure: { compensation: number };
  /** Called after every state change (panel refresh). */
  changed?(): void;
}

export class PhotoState {
  active = false;
  private savedFov = 0;
  private savedComp = 0;

  constructor(private readonly d: PhotoDeps) {}

  get fovDeg(): number {
    return this.d.getFovY() / DEG;
  }

  get compensation(): number {
    return this.d.exposure.compensation;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    this.savedFov = this.d.getFovY();
    this.savedComp = this.d.exposure.compensation;
    this.d.setHudVisible(false);
    this.d.setFlag(true);
    this.d.changed?.();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.d.setFovY(this.savedFov);
    this.d.exposure.compensation = this.savedComp;
    this.d.setHudVisible(true);
    this.d.setFlag(false);
    this.d.changed?.();
  }

  toggle(): void {
    if (this.active) this.exit();
    else this.enter();
  }

  setFovDeg(deg: number): void {
    if (!Number.isFinite(deg)) return;
    this.d.setFovY(Math.min(FOV_MAX_DEG, Math.max(FOV_MIN_DEG, deg)) * DEG);
    this.d.changed?.();
  }

  /** Adds `stops` of exposure compensation (positive = brighter image). */
  nudgeExposure(stops: number): void {
    // Compensation is added to the metered EV100, so a brighter image needs a lower EV.
    const c = this.d.exposure.compensation - stops;
    this.d.exposure.compensation = Math.min(EV_COMP_LIMIT, Math.max(-EV_COMP_LIMIT, c));
    this.d.changed?.();
  }
}

/** Credits line drawn into the exported image. */
export function creditsLine(date: Date | null): string {
  const when = date ? ` · ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
  return `Cosmos${when} · data: NASA/JPL, USGS, Solar System Scope, HYG and others (see CREDITS.md)`;
}

/** File name for an export, e.g. cosmos-2026-10-14-1530.png. */
export function photoFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `cosmos-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.png`;
}
