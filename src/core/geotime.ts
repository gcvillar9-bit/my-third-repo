/**
 * Deep time for people: years before present (BP, present = 1950.0 as in radiocarbon and PALEOMAP
 * ages), geologic unit labels from the ICS chart (geotime.json), era presets for the time bar, and a
 * forgiving parser for typed instants ('66 Ma', '21 ka', '500 BC', '1066', 'JD 2451545', ISO dates).
 * Deep-time ages convert straight to JD TT; they never go through UTC, whose ΔT extrapolation is
 * meaningless there (~0.44 Myr at 66 Ma).
 */
import type { JD } from './contracts';
import geotime from './geotime.json';
import { dateToJdUtc, foldJd, insidePlanetsWindow, jdToIso, parseInstant, utcToTt } from './time';
import { DAY, JD_J2000, JULIAN_YEAR } from './units';

const YEAR_DAYS = JULIAN_YEAR / DAY;
/** JD TT of the BP "present", 1950.0 (Julian epoch). */
export const JD_PRESENT_BP = JD_J2000 - 50 * YEAR_DAYS;
/**
 * Typed deep-time ages snap to the current instant's phase in steps of 4 Julian years (a whole
 * number of days), so jumping to '66 Ma' keeps the time of day and the season of the view.
 */
export const PHASE_PERIOD_DAYS = 4 * YEAR_DAYS;
/**
 * Deep time: before J2000 − 10 kyr, where the planet ephemerides fold (core time.ts foldJd). The time
 * bar shows an age there ('≈ 21.0 ka · Pleistocene'), and typed instants snap onto the view's phase.
 */
export const isDeepPast = (jd: JD): boolean => jd < JD_J2000 && !insidePlanetsWindow(jd);

export const yearsBeforePresent = (jd: JD): number => (JD_PRESENT_BP - jd) / YEAR_DAYS;
export const jdFromYearsBP = (yearsBP: number): JD => JD_PRESENT_BP - yearsBP * YEAR_DAYS;

export type GeoRank = 'eon' | 'era' | 'period' | 'epoch';

export interface GeoUnit {
  name: string;
  rank: GeoRank;
  /** Base (older bound) of the unit, Ma; the top is the base of the next younger unit of the same rank. */
  baseMa: number;
  /** The chart gives the base age as '~'. */
  approximate?: boolean;
  source: string;
}

const UNITS = geotime.units as GeoUnit[];
const byRank = (rank: GeoRank) => UNITS.filter((u) => u.rank === rank).sort((a, b) => a.baseMa - b.baseMa);
const RANKS: Record<GeoRank, GeoUnit[]> = {
  epoch: byRank('epoch'),
  period: byRank('period'),
  era: byRank('era'),
  eon: byRank('eon'),
};

/** Unit of `rank` containing an age (top ≤ age < base, so a boundary age belongs to the older unit). */
function unitAt(rank: GeoRank, ageMa: number): GeoUnit | undefined {
  return RANKS[rank].find((u) => ageMa < u.baseMa);
}

export interface GeoPlace {
  epoch?: GeoUnit;
  period?: GeoUnit;
  era?: GeoUnit;
  eon?: GeoUnit;
  /** Short label: the epoch where it is self-explanatory, else the period, era or eon. */
  label: string;
  approximate: boolean;
}

/** Geologic units at an age in years BP (null in the future or beyond the table). */
export function geologicPlace(yearsBP: number): GeoPlace | null {
  if (!(yearsBP >= 0)) return null;
  const ageMa = yearsBP / 1e6;
  const epoch = unitAt('epoch', ageMa);
  const period = unitAt('period', ageMa);
  const era = unitAt('era', ageMa);
  const eon = unitAt('eon', ageMa);
  // Epochs such as 'Late Cretaceous' or 'Pleistocene' read well alone; 'Lopingian' reads better as 'Permian'.
  const shown =
    epoch && period && (epoch.name.includes(period.name) || era?.name === 'Cenozoic')
      ? epoch
      : (period ?? era ?? eon);
  if (!shown) return null;
  return { epoch, period, era, eon, label: shown.name, approximate: !!shown.approximate };
}

/** Age text: '21.0 ka', '66.0 Ma', '1.00 Ga'. */
export function formatAge(yearsBP: number): string {
  const a = Math.abs(yearsBP);
  // Units chosen after rounding, so 999,960 years reads '1.0 Ma', not '1000.0 ka'.
  if (a < 999_950) return `${(yearsBP / 1e3).toFixed(1)} ka`;
  if (a < 999_950_000) return `${(yearsBP / 1e6).toFixed(1)} Ma`;
  return `${(yearsBP / 1e9).toFixed(2)} Ga`;
}

export interface EraPreset {
  /** Text the time bar parses (parseUserInstant). */
  value: string;
  label: string;
}

/** Suggestions in the time bar's date field. */
export const ERA_PRESETS: readonly EraPreset[] = [
  { value: 'now', label: 'Today' },
  { value: '1000 years ago', label: '1,000 years ago' },
  { value: '21 ka', label: 'Last Glacial Maximum' },
  { value: '3.2 Ma', label: '"Lucy", Australopithecus afarensis' },
  { value: '66 Ma', label: 'End of the dinosaurs' },
  { value: '90 Ma', label: 'Western Interior Seaway' },
  { value: '150 Ma', label: 'Late Jurassic' },
  { value: '250 Ma', label: 'Pangaea' },
  { value: '300 Ma', label: 'Coal forests' },
  { value: '530 Ma', label: 'Cambrian explosion' },
];

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** `targetJd` moved back (at most 4 years) onto the time of day and season of `nowJd`. */
export function snapToPhase(targetJd: JD, nowJd: JD): JD {
  return targetJd - mod(targetJd - nowJd, PHASE_PERIOD_DAYS);
}

/** A typed target: as given inside the planet window, snapped onto the view's phase beyond it. */
const settle = (jd: JD, nowJd: JD): JD => (insidePlanetsWindow(jd) ? jd : snapToPhase(jd, nowJd));

/**
 * JD TT of an astronomical year (0 = 1 BC) at the month, day and time the view shows (the fold of
 * `nowJd` in deep time). Years whose instant falls beyond the planet window snap onto the view's
 * phase instead: there the scene shows folded time, and UTC (ΔT, Gregorian dates) has no meaning.
 */
function atYear(year: number, nowJd: JD): JD {
  const iso = Math.abs(year) <= 270_000 ? jdToIso(foldJd(nowJd)) : null;
  if (iso) {
    const d = new Date(iso);
    d.setUTCFullYear(year);
    const jd = utcToTt(dateToJdUtc(d));
    if (insidePlanetsWindow(jd)) return jd;
  }
  return snapToPhase(jdFromYearsBP(1950 - year), nowJd);
}

const UNIT_YEARS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  g: 1e9,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
};

/** Larger magnitudes than any reachable year (the clock stops at ±1e9 yr) are JDs, as share links write them. */
const MAX_TYPED_YEAR = 1.1e9;

/**
 * Parses what a person types into the time bar, relative to the current instant `nowJd`:
 * '66 Ma', '66Ma', '66 mya', '21 ka', '1.2 Ga', '3 million years ago', '500 years ago', '500 BC',
 * 'AD 1066', '1066', '-2999' and '-150000' (astronomical years), 'JD 2451545', a bare JD (positive
 * above 1e5, or a decimal above 1e5 in magnitude), ISO dates with 'T' or a space ('2026-01-01 12:00',
 * always UTC), 'now'. Other text (including bare small decimals such as '3.2') is not understood.
 * Returns a finite JD TT, 'now', or null.
 */
export function parseUserInstant(text: string, nowJd: JD): JD | 'now' | null {
  const r = parseTyped(text, nowJd);
  return r === 'now' || r === null || Number.isFinite(r) ? r : null;
}

function parseTyped(text: string, nowJd: JD): JD | 'now' | null {
  const s = text.trim().replace(/(\d)[,_](?=\d{3}(\D|$))/g, '$1');
  if (/^now$/i.test(s)) return 'now';
  let m = /^jd\s*([-+]?\d+(?:\.\d*)?(?:e[-+]?\d+)?)$/i.exec(s);
  if (m) return Number(m[1]);
  m =
    /^(\d+(?:\.\d+)?)\s*(?:(k|m|g)(?:a|yr|ya)|(thousand|million|billion)\s+years?)(?:\s*(?:ago|bp))?$/i.exec(
      s,
    );
  if (m) {
    const bp = Number(m[1]) * UNIT_YEARS[(m[2] ?? m[3]).toLowerCase()];
    const jd = jdFromYearsBP(bp);
    if (!insidePlanetsWindow(jd)) return snapToPhase(jd, nowJd);
    return Number.isInteger(bp) ? atYear(1950 - bp, nowJd) : jd;
  }
  m = /^(\d+(?:\.\d+)?)\s*years?\s+ago$/i.exec(s);
  if (m) {
    const years = Number(m[1]);
    const target = nowJd - years * YEAR_DAYS;
    if (!insidePlanetsWindow(target)) return snapToPhase(target, nowJd);
    const iso = jdToIso(nowJd);
    return iso && Number.isInteger(years) ? atYear(new Date(iso).getUTCFullYear() - years, nowJd) : target;
  }
  m = /^(\d+)\s*(?:bc|bce|b\.c\.)$/i.exec(s);
  if (m) return atYear(1 - Number(m[1]), nowJd);
  m = /^(?:(?:ad|ce)\s*(\d+)|(\d+)\s*(?:ad|ce))$/i.exec(s);
  if (m) return atYear(Number(m[1] ?? m[2]), nowJd);
  if (/^-\d+$/.test(s)) return Number(s) >= -MAX_TYPED_YEAR ? atYear(Number(s), nowJd) : Number(s);
  if (/^\+?\d+$/.test(s)) return Number(s) < 1e5 ? atYear(Number(s), nowJd) : Number(s);
  if (/^[-+]?\d*\.\d+$/.test(s)) return Math.abs(Number(s)) > 1e5 ? Number(s) : null;
  m = /^((?:[-+]\d{6}|\d{4})-\d{2}-\d{2})(?:[ t](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?\s*(?:z|utc)?$/i.exec(s);
  if (m) return settle(parseInstant(m[2] ? `${m[1]}T${m[2]}Z` : m[1]) ?? NaN, nowJd);
  return null;
}
