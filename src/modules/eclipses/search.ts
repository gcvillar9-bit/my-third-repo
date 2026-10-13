/**
 * Eclipse searches (three-free) on astronomy-engine: global and local solar eclipses and lunar
 * eclipses. Times are JD TT in and out (the app's clock), converted through UTC for the library.
 */
import {
  MakeTime,
  Observer,
  SearchGlobalSolarEclipse,
  SearchLocalSolarEclipse,
  SearchLunarEclipse,
  type AstroTime,
} from 'astronomy-engine';
import { jdUtcToMs, ttToUtc } from '../../core/time';
import { JD_J2000 } from '../../core/units';

/** JD TT of an astronomy-engine time. */
export const jdOf = (t: AstroTime): number => JD_J2000 + t.tt;
/** astronomy-engine time of a JD TT. */
export const astroTimeOf = (jdTt: number): AstroTime => MakeTime(new Date(jdUtcToMs(ttToUtc(jdTt))));

export interface SolarEclipse {
  kind: string;
  /** Greatest eclipse, JD TT. */
  peakJd: number;
  /** Geographic point of greatest eclipse (undefined when the shadow axis misses the Earth). */
  latDeg?: number;
  lonDeg?: number;
  obscuration?: number;
}

export interface LunarEclipse {
  kind: string;
  peakJd: number;
  obscuration: number;
  /** Durations, minutes. */
  totalMin: number;
  partialMin: number;
  penumbralMin: number;
}

export interface LocalSolarEclipse {
  kind: string;
  peakJd: number;
  obscuration: number;
  /** Sun altitude at the local peak, degrees. */
  sunAltitudeDeg: number;
  totalBeginJd?: number;
  totalEndJd?: number;
}

/** First solar eclipse (anywhere on Earth) after `jdTt`. */
export function nextSolarEclipse(jdTt: number): SolarEclipse {
  const e = SearchGlobalSolarEclipse(astroTimeOf(jdTt));
  return {
    kind: e.kind,
    peakJd: jdOf(e.peak),
    latDeg: e.latitude,
    lonDeg: e.longitude,
    obscuration: e.obscuration,
  };
}

/** First lunar eclipse after `jdTt`. */
export function nextLunarEclipse(jdTt: number): LunarEclipse {
  const e = SearchLunarEclipse(astroTimeOf(jdTt));
  return {
    kind: e.kind,
    peakJd: jdOf(e.peak),
    obscuration: e.obscuration,
    totalMin: 2 * e.sd_total,
    partialMin: 2 * e.sd_partial,
    penumbralMin: 2 * e.sd_penum,
  };
}

/** First solar eclipse visible from a site after `jdTt`. */
export function localSolarEclipse(
  jdTt: number,
  latDeg: number,
  lonDeg: number,
  heightM = 0,
): LocalSolarEclipse {
  const e = SearchLocalSolarEclipse(astroTimeOf(jdTt), new Observer(latDeg, lonDeg, heightM));
  return {
    kind: e.kind,
    peakJd: jdOf(e.peak.time),
    obscuration: e.obscuration,
    sunAltitudeDeg: e.peak.altitude,
    totalBeginJd: e.total_begin ? jdOf(e.total_begin.time) : undefined,
    totalEndJd: e.total_end ? jdOf(e.total_end.time) : undefined,
  };
}

/**
 * Fraction of a uniform solar disk (angular radius rs) left visible by an occulting disk (rm)
 * whose centre is `d` away (all radians; small-angle circle overlap).
 */
export function diskVisibleFraction(rs: number, rm: number, d: number): number {
  if (d >= rs + rm) return 1;
  if (d <= Math.abs(rm - rs)) return rm >= rs ? 0 : 1 - (rm * rm) / (rs * rs);
  const a1 = rs * rs * Math.acos(Math.min(1, (d * d + rs * rs - rm * rm) / (2 * d * rs)));
  const a2 = rm * rm * Math.acos(Math.min(1, (d * d + rm * rm - rs * rs) / (2 * d * rm)));
  const a3 = 0.5 * Math.sqrt(Math.max(0, (-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm)));
  return Math.max(0, 1 - (a1 + a2 - a3) / (Math.PI * rs * rs));
}

/** Sky brightness left in totality, relative to the uneclipsed sky (light scattered in from outside the umbra). */
export const TOTALITY_SKY_FLOOR = 1e-4;

/** Scale applied to the atmosphere's contribution for a visible solar-disk fraction. */
export const skyFactor = (visible: number): number => TOTALITY_SKY_FLOOR + (1 - TOTALITY_SKY_FLOOR) * visible;
