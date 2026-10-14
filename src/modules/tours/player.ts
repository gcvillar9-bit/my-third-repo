/**
 * Tour player (P5-B). A TourDef compiles into a fixed timeline of instant events plus orbit
 * spans, so the schedule depends only on the definition and on which targets exist, never on
 * frame timing: ticking with dt = 1/60 or dt = 0.5 fires the same events at the same scheduled
 * times. Side effects go through `TourActions`, which makes the player testable with a fake clock.
 *
 * Step semantics (durations are real seconds, divided by `speed`):
 * - goto: starts a flight of `duration` (default 7 s) and blocks for it.
 * - orbit: rotates the camera about the target by `degrees` over `duration` (blocking).
 * - wait: blocks for `seconds`.
 * - caption: shows the text now (non-blocking); it stays until the next caption, the end of the
 *   tour, or `seconds` later when given.
 * - timeRate / setTime / setting: instant. speak: ignored (narration was cut).
 *
 * A goto whose target does not exist is skipped together with the steps that follow it up to
 * the next goto (its captions and waits belong to that stop).
 */
import type { Bookmark, JD, SettingValue, TourDef, TourStep } from '../../core/contracts';

export const DEFAULT_GOTO_S = 7;

export interface TourActions {
  /** Whether a goto target (body id, bookmark id or Bookmark) can be flown to. */
  has(target: string | Bookmark): boolean;
  goto(target: string | Bookmark, durationS: number): void;
  /** Incremental orbit: rotate the camera about `target` by `radians` now. */
  orbit(target: string, radians: number): void;
  setRate(rate: number): void;
  setTime(jd: JD | 'now'): void;
  caption(text: string | null): void;
  setting(id: string, value: SettingValue): void;
}

/** One instant event of the compiled timeline. */
export interface TourEvent {
  /** Scheduled tour time, s (at speed 1). */
  time: number;
  /** Stop index (0 before the first goto; goto k starts stop k + 1 when there is an intro). */
  stop: number;
  step: TourStep | { type: 'clearCaption' };
}

export interface OrbitSpan {
  start: number;
  end: number;
  target: string;
  radians: number;
}

export interface CompiledTour {
  id: string;
  title: string;
  events: TourEvent[];
  orbits: OrbitSpan[];
  /** Total length, s. */
  total: number;
  /** Start time of each stop (one per kept goto). */
  stops: { time: number; target: string | Bookmark }[];
  /** Goto targets that were skipped because they do not exist. */
  skipped: (string | Bookmark)[];
}

const targetId = (t: string | Bookmark): string => (typeof t === 'string' ? t : t.id);

/** Compiles a tour into its timeline. Deterministic: same def and `has` give the same result. */
export function compileTour(def: TourDef, has: (t: string | Bookmark) => boolean): CompiledTour {
  const events: TourEvent[] = [];
  const orbits: OrbitSpan[] = [];
  const stops: CompiledTour['stops'] = [];
  const skipped: (string | Bookmark)[] = [];
  let t = 0;
  let skipping = false;
  let stop = 0;
  // Pending auto-clear of the last caption: [time, index into events].
  let clearAt: number | null = null;
  const flushClear = (before: number) => {
    if (clearAt !== null && clearAt <= before) {
      events.push({ time: clearAt, stop, step: { type: 'clearCaption' } });
      clearAt = null;
    }
  };
  for (const step of def.steps) {
    if (step.type === 'goto') {
      skipping = !has(step.target);
      if (skipping) {
        skipped.push(step.target);
        continue;
      }
    }
    if (skipping) continue;
    flushClear(t);
    switch (step.type) {
      case 'goto': {
        stop = stops.length + 1;
        stops.push({ time: t, target: step.target });
        events.push({ time: t, stop, step });
        t += Math.max(0, step.duration ?? DEFAULT_GOTO_S);
        break;
      }
      case 'orbit':
        orbits.push({
          start: t,
          end: t + Math.max(1e-6, step.duration),
          target: step.target,
          radians: (step.degrees * Math.PI) / 180,
        });
        t += Math.max(0, step.duration);
        break;
      case 'wait':
        t += Math.max(0, step.seconds);
        break;
      case 'caption':
        clearAt = null;
        events.push({ time: t, stop, step });
        if (step.seconds !== undefined) clearAt = t + Math.max(0, step.seconds);
        break;
      case 'speak':
        break;
      default:
        events.push({ time: t, stop, step });
    }
  }
  flushClear(t);
  return { id: def.id, title: def.title, events, orbits, total: t, stops, skipped };
}

export interface TourStatus {
  id: string;
  title: string;
  /** Tour time, s (speed 1 units). */
  time: number;
  total: number;
  /** 1-based current stop (0 before the first goto). */
  stop: number;
  stops: number;
  target: string | null;
  caption: string | null;
  paused: boolean;
  done: boolean;
}

/** Plays a compiled tour. Call `tick(dtReal)` every frame. */
export class TourPlayer {
  readonly tour: CompiledTour;
  private t = 0;
  private cursor = 0;
  private stopIdx = 0;
  private target: string | null = null;
  private captionText: string | null = null;
  paused = false;
  done = false;

  constructor(
    def: TourDef,
    private readonly actions: TourActions,
    /** Time scale: 2 plays twice as fast (e2e uses ?tourspeed=). */
    readonly speed = 1,
  ) {
    this.tour = compileTour(def, (x) => actions.has(x));
    if (this.tour.events.length === 0 && this.tour.orbits.length === 0) this.done = true;
  }

  status(): TourStatus {
    return {
      id: this.tour.id,
      title: this.tour.title,
      time: this.t,
      total: this.tour.total,
      stop: this.stopIdx,
      stops: this.tour.stops.length,
      target: this.target,
      caption: this.captionText,
      paused: this.paused,
      done: this.done,
    };
  }

  /** Advances by `dtReal` real seconds. */
  tick(dtReal: number): void {
    if (this.done || this.paused || !(dtReal > 0)) return;
    this.advanceTo(Math.min(this.tour.total, this.t + dtReal * this.speed));
  }

  /** Jumps to the start of the next stop (skipping the rest of the current one). */
  next(): void {
    if (this.done) return;
    const nxt = this.tour.stops.find((s) => s.time > this.t);
    if (!nxt) {
      this.finish();
      return;
    }
    // Skip events strictly before the next stop; orbits in between are not applied.
    while (this.cursor < this.tour.events.length && this.tour.events[this.cursor].time < nxt.time)
      this.cursor++;
    this.t = nxt.time;
    this.advanceTo(nxt.time);
  }

  /** Ends the tour early (clears the caption). */
  stop(): void {
    this.finish();
  }

  private advanceTo(t1: number): void {
    const { events, orbits, total } = this.tour;
    const t0 = this.t;
    while (this.cursor < events.length && events[this.cursor].time <= t1) {
      const ev = events[this.cursor++];
      this.fire(ev);
    }
    for (const o of orbits) {
      const overlap = Math.min(t1, o.end) - Math.max(t0, o.start);
      if (overlap > 0) this.actions.orbit(o.target, (o.radians * overlap) / (o.end - o.start));
    }
    this.t = t1;
    if (t1 >= total && this.cursor >= events.length) this.finish();
  }

  private fire(ev: TourEvent): void {
    const s = ev.step;
    const a = this.actions;
    switch (s.type) {
      case 'goto':
        this.stopIdx = ev.stop;
        this.target = targetId(s.target);
        a.goto(s.target, (s.duration ?? DEFAULT_GOTO_S) / this.speed);
        break;
      case 'caption':
        this.captionText = s.text;
        a.caption(s.text);
        break;
      case 'clearCaption':
        this.captionText = null;
        a.caption(null);
        break;
      case 'timeRate':
        a.setRate(s.rate);
        break;
      case 'setTime':
        a.setTime(s.jd);
        break;
      case 'setting':
        a.setting(s.id, s.value);
        break;
    }
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    if (this.captionText !== null) {
      this.captionText = null;
      this.actions.caption(null);
    }
  }
}
