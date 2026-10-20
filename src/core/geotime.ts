/**
 * Deep time for people: years before present (BP, present = 1950.0 as in radiocarbon and PALEOMAP
 * ages), geologic unit labels from the ICS chart (geotime.json), era presets for the time bar, and a
 * forgiving parser for typed instants ('66 Ma', '21 ka', '500 BC', '1066', 'JD 2451545', ISO dates).
 * Deep-time ages convert straight to JD TT; they never go through UTC, whose ΔT extrapolation is
 * meaningless there (~0.44 Myr at 66 Ma).
 */
import type { JD } from './contracts';
import geotime from './geotime.json';
import { dateToJdUtc, jdToIso, parseInstant, utcToTt } from './time';
import { DAY, JD_J2000, JULIAN_YEAR } from './units';

const YEAR_DAYS = JULIAN_YEAR / DAY;
/** JD TT of the BP "present", 1950.0 (Julian epoch). */
export const JD_PRESENT_BP = JD_J2000 - 50 * YEAR_DAYS;
/**
 * Typed deep-time ages snap to the current instant's phase in steps of 4 Julian years (a whole
 * number of days), so jumping to '66 Ma' keeps the time of day and the season of the view.
 */
export const PHASE_PERIOD_DAYS = 4 * YEAR_DAYS;
/** Ages at least this many years BP are shown and typed as deep time ('≈ 21.0 ka · Pleistocene'). */
export const DEEP_TIME_YEARS = 10_000;

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
  if (a < 1e6) return `${(yearsBP / 1e3).toFixed(1)} ka`;
  if (a < 1e9) return `${(yearsBP / 1e6).toFixed(1)} Ma`;
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
  { value: '1 ka', label: '1,000 years ago' },
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

/** JD TT of an astronomical year (0 = 1 BC) at the month, day and time of `nowJd` (Jan 1 noon in deep time). */
function atYear(year: number, nowJd: JD): JD {
  if (Math.abs(year) > 270_000) return snapToPhase(jdFromYearsBP(1950 - year), nowJd);
  const iso = jdToIso(nowJd);
  const d = iso ? new Date(iso) : new Date(Date.UTC(2000, 0, 1, 12));
  d.setUTCFullYear(year);
  return utcToTt(dateToJdUtc(d));
}

const UNIT_YEARS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  g: 1e9,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
};

/**
 * Parses what a person types into the time bar, relative to the current instant `nowJd`:
 * '66 Ma', '66Ma', '66 mya', '21 ka', '1.2 Ga', '3 million years ago', '500 years ago', '500 BC',
 * 'AD 1066', '1066', '-2999' (astronomical year), 'JD 2451545', ISO-8601, a bare JD above 1e5, 'now'.
 * Returns JD TT, 'now', or null when the text is not understood.
 */
export function parseUserInstant(text: string, nowJd: JD): JD | 'now' | null {
  const s = text.trim().replace(/(\d)[,_](?=\d{3}(\D|$))/g, '$1');
  if (/^now$/i.test(s)) return 'now';
  let m = /^jd\s*([-+]?\d+(?:\.\d*)?(?:e[-+]?\d+)?)$/i.exec(s);
  if (m) return Number(m[1]);
  m =
    /^(\d+(?:\.\d+)?)\s*(?:(k|m|g)(?:a|yr|ya)|(thousand|million|billion)\s+years?)(?:\s*(?:ago|bp))?$/i.exec(
      s,
    );
  if (m) return snapToPhase(jdFromYearsBP(Number(m[1]) * UNIT_YEARS[(m[2] ?? m[3]).toLowerCase()]), nowJd);
  m = /^(\d+(?:\.\d+)?)\s*years?\s+ago$/i.exec(s);
  if (m) {
    const years = Number(m[1]);
    const iso = years < DEEP_TIME_YEARS ? jdToIso(nowJd) : null;
    if (iso && Number.isInteger(years)) return atYear(new Date(iso).getUTCFullYear() - years, nowJd);
    return snapToPhase(nowJd - years * YEAR_DAYS, nowJd);
  }
  m = /^(\d+)\s*(?:bc|bce|b\.c\.)$/i.exec(s);
  if (m) return atYear(1 - Number(m[1]), nowJd);
  m = /^(?:(?:ad|ce)\s*(\d+)|(\d+)\s*(?:ad|ce))$/i.exec(s);
  if (m) return atYear(Number(m[1] ?? m[2]), nowJd);
  if (/^[-+]?\d+$/.test(s) && Math.abs(Number(s)) < 1e5) return atYear(Number(s), nowJd);
  return parseInstant(s);
}
