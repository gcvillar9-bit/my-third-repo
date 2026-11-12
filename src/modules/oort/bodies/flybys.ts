/**
 * Stars passing through the Oort Cloud (three-free): straight-line motion from Gaia-era astrometry,
 * r(t) = r0 + v (t − t0), Sun-centred, ICRF axes, metres. Published closest approaches integrate the
 * Galactic potential and the measurement errors; this model only reproduces them roughly, and says so.
 */
import { SSB_FRAME, type FrameDef, type InfoCard, type InfoFact, type Vec3d } from '../../../core/contracts';
import { v3len, v3set, vec3 } from '../../../core/math64';
import { AU, DAY, JD_J2000, JULIAN_YEAR, LY, PC } from '../../../core/units';
import type { FlybyStarRow, StarAstrometry } from './data';

const DEG = Math.PI / 180;
/** km/s per (arcsec/yr × pc). */
const K_PM = 4.740470446;

export interface StarMotion {
  /** Position at the astrometric epoch, m (Sun-centred, ICRF). */
  r0: Vec3d;
  /** Velocity, m/s. */
  v: Vec3d;
  /** Astrometric epoch, JD TT. */
  jd0: number;
  /** Time of closest approach, JD TT. */
  closestJd: number;
  /** Distance at closest approach, m. */
  closestDist: number;
  /** Position at closest approach, m. */
  closestPoint: Vec3d;
  /** Speed relative to the Sun, m/s. */
  speed: number;
}

/** Position and velocity from the astrometry, then the closest approach of the straight-line motion. */
export function starMotion(a: StarAstrometry): StarMotion {
  const ra = a.raDeg * DEG;
  const dec = a.decDeg * DEG;
  const dPc = 1000 / a.parallaxMas;
  const [ca, sa, cd, sd] = [Math.cos(ra), Math.sin(ra), Math.cos(dec), Math.sin(dec)];
  const u = vec3(cd * ca, cd * sa, sd);
  const eRa = vec3(-sa, ca, 0);
  const eDec = vec3(-sd * ca, -sd * sa, cd);
  const vRa = K_PM * (a.pmRaMasYr / 1000) * dPc * 1e3;
  const vDec = K_PM * (a.pmDecMasYr / 1000) * dPc * 1e3;
  const vr = a.rvKms * 1e3;
  const d = dPc * PC;
  const r0 = vec3(u.x * d, u.y * d, u.z * d);
  const v = vec3(
    vr * u.x + vRa * eRa.x + vDec * eDec.x,
    vr * u.y + vRa * eRa.y + vDec * eDec.y,
    vr * u.z + vRa * eRa.z + vDec * eDec.z,
  );
  const v2 = v.x * v.x + v.y * v.y + v.z * v.z;
  const tStar = -(r0.x * v.x + r0.y * v.y + r0.z * v.z) / v2;
  const jd0 = JD_J2000 + (a.epochYear - 2000) * 365.25;
  const closestPoint = vec3(r0.x + v.x * tStar, r0.y + v.y * tStar, r0.z + v.z * tStar);
  return {
    r0,
    v,
    jd0,
    closestJd: jd0 + tStar / DAY,
    closestDist: v3len(closestPoint),
    closestPoint,
    speed: Math.sqrt(v2),
  };
}

/** Star position at `jd` (straight line), m. */
export function starPositionAt(m: StarMotion, jd: number, out: Vec3d): Vec3d {
  const t = (jd - m.jd0) * DAY;
  return v3set(out, m.r0.x + m.v.x * t, m.r0.y + m.v.y * t, m.r0.z + m.v.z * t);
}

export const flybyFrameId = (id: string): string => `flyby:${id}`;

/** Frame of a passing star (parent: the barycentre; the Sun's offset from it is negligible here). */
export function flybyFrame(row: FlybyStarRow, m: StarMotion): FrameDef {
  return {
    id: flybyFrameId(row.id),
    parent: SSB_FRAME,
    influenceRadius: 0,
    positionAt: (jd, out) => starPositionAt(m, jd, out),
  };
}

/** '1.29 million years', '80,000 years', '350 years'. */
export function formatYears(years: number): string {
  const y = Math.abs(years);
  if (y >= 1e6) return `${Number((y / 1e6).toPrecision(3))} million years`;
  if (y >= 100) return `${Number(y.toPrecision(2)).toLocaleString('en-US')} years`;
  return `${Math.max(1, Math.round(y))} years`;
}

/** 'closest in 1.29 million years' / 'passed 80,000 years ago' / 'closest now', relative to `jd`. */
export function approachPhrase(m: StarMotion, jd: number): string {
  const years = (m.closestJd - jd) / 365.25;
  if (Math.abs(years) < 1) return 'closest now';
  return years > 0 ? `closest in ${formatYears(years)}` : `passed ${formatYears(years)} ago`;
}

export const flybyLabel = (row: FlybyStarRow, m: StarMotion, jd: number): string =>
  `${row.name} · ${approachPhrase(m, jd)}`;

const sig = (x: number, n = 3): number => Number(x.toPrecision(n));

export function flybyFacts(row: FlybyStarRow, m: StarMotion, jd: number): InfoFact[] {
  const a = row.astrometry;
  const today = v3len(m.r0);
  const facts: InfoFact[] = [
    { label: 'Spectral type', value: row.spectral },
    {
      label: 'Distance today',
      value: sig(today / LY),
      unit: 'light-years',
      approximate: !!a.approximate,
      source: a.source,
    },
    {
      label: 'Speed relative to the Sun',
      value: sig(m.speed / 1e3),
      unit: 'km/s',
      approximate: !!a.approximate,
      source: a.source,
    },
    {
      label: 'Closest approach (this model, straight-line motion)',
      value: `${sig(m.closestDist / AU).toLocaleString('en-US')} AU, ${formatYears(yearsToClosest(m))} ${
        m.closestJd >= m.jd0 ? 'after' : 'before'
      } ${a.epochYear}`,
      approximate: true,
      source: `Straight line from the astrometry (${a.source}); ignores the Galaxy's pull and the errors`,
    },
  ];
  for (const p of row.published) {
    const when =
      p.timeMyr >= 0 ? `in ${formatYears(p.timeMyr * 1e6)}` : `${formatYears(p.timeMyr * 1e6)} ago`;
    const range = p.distanceRangePc
      ? ` (${Math.round((p.distanceRangePc[0] * PC) / AU).toLocaleString('en-US')}-${Math.round(
          (p.distanceRangePc[1] * PC) / AU,
        ).toLocaleString('en-US')} AU)`
      : '';
    facts.push({
      label: 'Closest approach (published)',
      value: `${Math.round((p.distancePc * PC) / AU).toLocaleString('en-US')} AU${range}, ${when}`,
      approximate: true,
      source: p.source,
    });
  }
  const now = v3len(starPositionAt(m, jd, vec3()));
  facts.push({
    label: 'Distance from the Sun (at the simulation time)',
    value: now < 0.2 * LY ? Math.round(now / AU).toLocaleString('en-US') : sig(now / LY),
    unit: now < 0.2 * LY ? 'AU' : 'light-years',
    approximate: true,
    source: 'Straight-line motion from the astrometry',
  });
  facts.push({ label: 'Mass', value: row.massSun, unit: 'solar masses', approximate: true });
  return facts;
}

export function flybyCard(row: FlybyStarRow, m: StarMotion, jd: number): InfoCard {
  return {
    title: `${row.name} (stellar flyby)`,
    subtitle: 'Star passing through the Oort Cloud',
    facts: flybyFacts(row, m, jd),
    description:
      `${row.description} The track drawn here is straight-line motion from today's position and velocity; ` +
      'the published values above also model the Galaxy and the measurement errors.',
    credit: row.astrometry.source,
  };
}

/** Julian years from the astrometric epoch to closest approach (handy for tests). */
export const yearsToClosest = (m: StarMotion): number => ((m.closestJd - m.jd0) * DAY) / JULIAN_YEAR;
