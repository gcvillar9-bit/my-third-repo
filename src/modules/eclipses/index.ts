/**
 * eclipses (P3-B): eclipse finder on astronomy-engine. Search entries and info cards "Next solar
 * eclipse" / "Next lunar eclipse" relative to the current sim time (their bookmark targets are
 * computed when selected), the 'eclipse-2027-luxor' totality bookmark, and the sky-dimming passes
 * that darken the atmosphere under the Moon's shadow. See docs/modules/eclipses.md.
 */
import type { Bookmark, InfoCard, ModuleContext, SearchEntry, UniverseModule } from '../../core/contracts';
import { jdToIso } from '../../core/time';
import {
  LUXOR,
  LUXOR_BOOKMARK_ID,
  TOTALITY_EV,
  buildGroundBookmark,
  buildLuxorBookmark,
  subPoint,
} from './bookmarks';
import {
  localSolarEclipse,
  nextLunarEclipse,
  nextSolarEclipse,
  type LunarEclipse,
  type SolarEclipse,
} from './search';
import { createEclipseSkyPasses } from './sky';

export const ECLIPSES_MODULE_ID = 'eclipses';
export const NEXT_SOLAR_ID = 'eclipse:next-solar';
export const NEXT_LUNAR_ID = 'eclipse:next-lunar';
const DEG = Math.PI / 180;
const SOURCE = 'astronomy-engine eclipse search';

const fmtDate = (jd: number): string => (jdToIso(jd) ?? '').replace(/:\d\d\.\d+Z$/, ' UTC').replace('T', ' ');
const fmtLat = (d: number) => `${Math.abs(d).toFixed(1)}°${d >= 0 ? 'N' : 'S'}`;
const fmtLon = (d: number) => `${Math.abs(d).toFixed(1)}°${d >= 0 ? 'E' : 'W'}`;

const eclipses: UniverseModule = {
  id: ECLIPSES_MODULE_ID,
  dependsOn: ['solar-system'],
  init(ctx: ModuleContext) {
    const { registry, frames, clock } = ctx;
    const earth = registry.body('earth');
    const moon = registry.body('moon');
    const sun = registry.body('sun');
    if (!earth || !moon || !sun) return;

    const luxor = buildLuxorBookmark(frames, earth);
    if (luxor) registry.addBookmarks([luxor]);

    // Eclipse searches need real planet positions: they only run inside the ephemeris window, and a
    // result is only offered when its peak is inside it too (beyond it the scene shows folded time).
    const planetsValid = (jd: number) =>
      clock.validity(jd).find((v) => v.range.id === 'core.planets')?.inside ?? true;
    // Searches are cached per sim day (a few ms each).
    let solar: { day: number; e: SolarEclipse } | null = null;
    let lunar: { day: number; e: LunarEclipse } | null = null;
    const nextSolar = () => {
      const day = Math.floor(clock.jd);
      if (solar?.day !== day) solar = { day, e: nextSolarEclipse(clock.jd) };
      return solar.e;
    };
    const nextLunar = () => {
      const day = Math.floor(clock.jd);
      if (lunar?.day !== day) lunar = { day, e: nextLunarEclipse(clock.jd) };
      return lunar.e;
    };
    const solarOk = () => planetsValid(clock.jd) && planetsValid(nextSolar().peakJd);
    const lunarOk = () => planetsValid(clock.jd) && planetsValid(nextLunar().peakJd);
    const solarBookmark = (): Bookmark | string => {
      if (!solarOk()) return 'sun';
      const e = nextSolar();
      const [lat, lon] =
        e.latDeg !== undefined && e.lonDeg !== undefined
          ? [e.latDeg, e.lonDeg]
          : subPoint(frames, earth, 'moon', e.peakJd);
      return (
        buildGroundBookmark(frames, earth, {
          id: 'eclipse-next-solar',
          title: `Solar eclipse (${e.kind}), ${fmtDate(e.peakJd)}`,
          latDeg: lat,
          lonDeg: lon,
          jd: e.peakJd,
          target: 'sun',
          ev: e.kind === 'total' ? TOTALITY_EV : 15,
          fovY: 6 * DEG,
          lookTarget: `Greatest ${e.kind} solar eclipse seen from the ground at ${fmtLat(lat)} ${fmtLon(lon)}.`,
        }) ?? 'sun'
      );
    };
    const lunarBookmark = (): Bookmark | string => {
      if (!lunarOk()) return 'moon';
      const e = nextLunar();
      const [lat, lon] = subPoint(frames, earth, 'moon', e.peakJd);
      return (
        buildGroundBookmark(frames, earth, {
          id: 'eclipse-next-lunar',
          title: `Lunar eclipse (${e.kind}), ${fmtDate(e.peakJd)}`,
          latDeg: lat,
          lonDeg: lon,
          jd: e.peakJd,
          target: 'moon',
          ev: 2,
          fovY: 3 * DEG,
          lookTarget: `The ${e.kind}ly eclipsed Moon at the zenith from ${fmtLat(lat)} ${fmtLon(lon)}.`,
        }) ?? 'moon'
      );
    };

    const entries: SearchEntry[] = [
      {
        id: NEXT_SOLAR_ID,
        name: 'Next solar eclipse',
        aliases: ['solar eclipse', 'eclipse', 'totality'],
        subtitle: 'From the current sim time',
        kind: 'other',
        priority: 5,
        get target() {
          return solarBookmark();
        },
      },
      {
        id: NEXT_LUNAR_ID,
        name: 'Next lunar eclipse',
        aliases: ['lunar eclipse', 'blood moon', 'eclipse'],
        subtitle: 'From the current sim time',
        kind: 'other',
        priority: 5,
        get target() {
          return lunarBookmark();
        },
      },
    ];
    if (luxor)
      entries.push({
        id: LUXOR_BOOKMARK_ID,
        name: 'Total solar eclipse, Luxor 2027',
        aliases: ['Luxor eclipse', '2027 eclipse', 'Egypt eclipse'],
        subtitle: '2 August 2027',
        kind: 'bookmark',
        target: luxor,
      });
    registry.addSearch({ id: ECLIPSES_MODULE_ID, entries: () => entries });

    registry.addInfo({
      id: ECLIPSES_MODULE_ID,
      info(id: string): InfoCard | null {
        if ((id === NEXT_SOLAR_ID && !solarOk()) || (id === NEXT_LUNAR_ID && !lunarOk()))
          return {
            title: id === NEXT_SOLAR_ID ? 'Next solar eclipse' : 'Next lunar eclipse',
            subtitle: 'After the current sim time',
            facts: [{ label: 'Search', value: 'only within 10,000 years of 2000', source: SOURCE }],
          };
        if (id === NEXT_SOLAR_ID) {
          const e = nextSolar();
          const facts: InfoCard['facts'] = [
            { label: 'Greatest eclipse', value: fmtDate(e.peakJd), source: SOURCE },
            { label: 'Type', value: e.kind },
          ];
          if (e.latDeg !== undefined && e.lonDeg !== undefined)
            facts.push({
              label: 'Location',
              value: `${fmtLat(e.latDeg)} ${fmtLon(e.lonDeg)}`,
              source: SOURCE,
            });
          if (e.obscuration !== undefined)
            facts.push({ label: 'Obscuration', value: (100 * e.obscuration).toFixed(1), unit: '%' });
          return { title: 'Next solar eclipse', subtitle: 'After the current sim time', facts };
        }
        if (id === NEXT_LUNAR_ID) {
          const e = nextLunar();
          const facts: InfoCard['facts'] = [
            { label: 'Peak', value: fmtDate(e.peakJd), source: SOURCE },
            { label: 'Type', value: e.kind },
            { label: 'Obscuration', value: (100 * e.obscuration).toFixed(1), unit: '%' },
          ];
          if (e.totalMin > 0) facts.push({ label: 'Totality', value: e.totalMin.toFixed(0), unit: 'min' });
          if (e.partialMin > 0)
            facts.push({ label: 'Partial phase', value: e.partialMin.toFixed(0), unit: 'min' });
          return { title: 'Next lunar eclipse', subtitle: 'After the current sim time', facts };
        }
        if (id === LUXOR_BOOKMARK_ID && luxor) {
          const e = localSolarEclipse((luxor.jd as number) - 1, LUXOR.latDeg, LUXOR.lonDeg, LUXOR.heightM);
          const dur = e.totalBeginJd && e.totalEndJd ? (e.totalEndJd - e.totalBeginJd) * 1440 : 0;
          return {
            title: 'Total solar eclipse, Luxor',
            subtitle: '2 August 2027',
            facts: [
              { label: 'Local maximum', value: fmtDate(e.peakJd), source: SOURCE },
              { label: 'Totality', value: dur.toFixed(1), unit: 'min', source: SOURCE },
              { label: 'Sun altitude', value: e.sunAltitudeDeg.toFixed(0), unit: '°' },
              { label: 'Sky in totality', value: 'dimmed to 1e-4 of daylight', approximate: true },
            ],
          };
        }
        return null;
      },
    });

    const bodies = { earthRadius: earth.radius, moonRadius: moon.radius, sunRadius: sun.radius };
    for (const p of createEclipseSkyPasses(bodies)) registry.addScreenPass(p);
  },
};

export default eclipses;
