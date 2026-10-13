/**
 * Pure root finder for bookmarks: the first instant after jd0 when the Sun's elevation at a site
 * crosses a target value in the given direction (setting = decreasing).
 */
export interface SunCrossingOptions {
  /** Target elevation, radians. */
  target: number;
  /** true: find the crossing while the Sun is setting; false: rising. */
  setting: boolean;
  /** Coarse scan step, days (default 10 minutes). */
  stepDays?: number;
  /** Search window, days (default 3). */
  maxDays?: number;
}

/** Returns the JD of the crossing, or null if none is found in the window. */
export function findSunCrossing(
  elevationAt: (jd: number) => number,
  jd0: number,
  opts: SunCrossingOptions,
): number | null {
  const step = opts.stepDays ?? 10 / 1440;
  const maxDays = opts.maxDays ?? 3;
  const f = (jd: number) => elevationAt(jd) - opts.target;
  let a = jd0;
  let fa = f(a);
  for (let t = step; t <= maxDays + 1e-12; t += step) {
    const b = jd0 + t;
    const fb = f(b);
    const crosses = opts.setting ? fa > 0 && fb <= 0 : fa < 0 && fb >= 0;
    if (crosses) {
      let lo = a;
      let hi = b;
      let flo = fa;
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        const fm = f(mid);
        if (fm > 0 === flo > 0) {
          lo = mid;
          flo = fm;
        } else hi = mid;
      }
      return 0.5 * (lo + hi);
    }
    a = b;
    fa = fb;
  }
  return null;
}
