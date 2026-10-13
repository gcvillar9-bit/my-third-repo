/**
 * Named-star search entries, info cards, labels and the stars bookmarks. Stars are not Bodies
 * in P1 (promotion is P4), so a search entry flies to a computed Bookmark: 0.05 pc from the star
 * on the Sun side, looking at it (or, for stars without a parallax, a view from the Sun).
 */
import {
  SSB_FRAME,
  type Bookmark,
  type InfoCard,
  type InfoFact,
  type LabelItem,
  type LabelSource,
  type SearchEntry,
  type SearchProvider,
  type Vec3d,
  type ViewState,
} from '../../core/contracts';
import { qlookRotation, quat, vec3 } from '../../core/math64';
import { AU, LY, PC } from '../../core/units';
import {
  appMagAt,
  formatDec,
  formatRa,
  luminositySun,
  raDec,
  spectralClass,
  type StarCatalog,
} from './catalog';
import { FLAG_MULTIPLE, FLAG_VARIABLE } from './format';
import { yearsSinceJ2000 } from './points';

export const HYG_CREDIT = 'HYG Database v4.1 (CC BY-SA 4.0), astronexus.com';
/** Distance of the "fly to a star" viewpoint from the star, pc. */
export const STAR_STANDOFF_PC = 0.05;
/** Labels: named stars brighter than this apparent magnitude (from the camera). */
export const LABEL_MAG_LIMIT = 2.5;
const NORTH = vec3(0, 0, 1);

const dirRaDec = (raHours: number, decDeg: number): Vec3d => {
  const ra = (raHours * Math.PI) / 12;
  const dec = (decDeg * Math.PI) / 180;
  return vec3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
};

/** Bookmark that flies next to star i (or looks at it from the Sun when its distance is unknown). */
export function starBookmark(cat: StarCatalog, i: number): Bookmark {
  const p = cat.positionPc(i, 0, vec3());
  const d = Math.hypot(p.x, p.y, p.z);
  const dir = vec3(p.x / d, p.y / d, p.z / d);
  const far = cat.distanceUnknown(i) || d > 5000;
  const dist = far ? AU / PC : Math.max(d - STAR_STANDOFF_PC, d * 0.5);
  const s = dist * PC;
  return {
    id: `star-${cat.idOf(i).replace(':', '-')}`,
    title: cat.displayName(i),
    frame: SSB_FRAME,
    pos: vec3(dir.x * s, dir.y * s, dir.z * s),
    quat: qlookRotation(quat(), dir, NORTH),
  };
}

export function createSearchProvider(cat: StarCatalog): SearchProvider {
  let cache: SearchEntry[] | null = null;
  return {
    id: 'stars',
    entries() {
      if (cache) return cache;
      cache = cat.names.rows.map((row) => {
        const i = row[0];
        const p = cat.positionPc(i, 0, vec3());
        const mag = appMagAt(cat.data.absMag[i], Math.hypot(p.x, p.y, p.z));
        const con = cat.constellation(i);
        return {
          id: cat.idOf(i),
          name: cat.displayName(i),
          aliases: cat.aliases(i),
          subtitle: `Star${con ? ` in ${con}` : ''} · mag ${mag.toFixed(1)}`,
          kind: 'star' as const,
          target: starBookmark(cat, i),
          priority: (row[2] ? 3 : 0) - mag * 0.1,
        };
      });
      return cache;
    },
  };
}

/** Camera position in pc relative to the Sun (ICRS axes). */
export function cameraPc(view: Pick<ViewState, 'toCamera'>, out: Vec3d): Vec3d {
  view.toCamera(SSB_FRAME, vec3(), out);
  out.x /= -PC;
  out.y /= -PC;
  out.z /= -PC;
  return out;
}

const fmt = (x: number, digits = 3) =>
  Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-2 && x !== 0) ? x.toExponential(2) : Number(x.toPrecision(digits));

export function starInfo(cat: StarCatalog, i: number, viewerPc: Vec3d | null, years: number): InfoCard {
  const p = cat.positionPc(i, years, vec3());
  const dSun = Math.hypot(p.x, p.y, p.z);
  const M = cat.data.absMag[i];
  const teff = cat.teff(i);
  const bv = cat.bv(i);
  const unknown = cat.distanceUnknown(i);
  const { ra, dec } = raDec(p);
  const facts: InfoFact[] = [];
  if (unknown) facts.push({ label: 'Distance from the Sun', value: 'unknown (no usable parallax)' });
  else {
    facts.push({ label: 'Distance from the Sun', value: fmt(dSun * (PC / LY)), unit: 'ly', source: 'HYG' });
    facts.push({ label: 'Distance from the Sun', value: fmt(dSun), unit: 'pc' });
  }
  facts.push({ label: 'Apparent magnitude (from the Sun)', value: appMagAt(M, dSun).toFixed(2) });
  if (viewerPc && !unknown) {
    const d = Math.hypot(p.x - viewerPc.x, p.y - viewerPc.y, p.z - viewerPc.z);
    facts.push({ label: 'Apparent magnitude (here)', value: appMagAt(M, d).toFixed(2) });
    facts.push({ label: 'Distance from you', value: fmt(d * (PC / LY)), unit: 'ly' });
  }
  if (!unknown) facts.push({ label: 'Absolute magnitude', value: M.toFixed(2) });
  facts.push({
    label: 'Spectral class (est.)',
    value: spectralClass(teff),
    approximate: true,
    source: 'from B-V',
  });
  if (!unknown)
    facts.push({
      label: 'Luminosity (V band)',
      value: fmt(luminositySun(M)),
      unit: 'L☉',
      approximate: true,
      source: 'from M_V, no bolometric correction',
    });
  facts.push({
    label: 'Colour temperature',
    value: Math.round(teff / 10) * 10,
    unit: 'K',
    approximate: true,
    source: 'B-V → Teff, Ballesteros 2012',
  });
  if (bv !== null) facts.push({ label: 'B-V colour index', value: bv.toFixed(2) });
  facts.push({ label: 'RA / Dec (J2000)', value: `${formatRa(ra)} / ${formatDec(dec)}` });
  const row = cat.nameRow(i);
  const des = cat.designation(i);
  if (des) facts.push({ label: 'Designation', value: des });
  if (row?.[1] != null) facts.push({ label: 'Hipparcos', value: `HIP ${row[1]}` });
  const flags = cat.data.flags[i];
  const notes = [flags & FLAG_VARIABLE ? 'variable' : '', flags & FLAG_MULTIPLE ? 'multiple system' : '']
    .filter(Boolean)
    .join(', ');
  if (notes) facts.push({ label: 'Notes', value: notes });
  const con = cat.constellation(i);
  return {
    title: cat.displayName(i),
    subtitle: `${spectralClass(teff)} star${con ? ` in ${con}` : ''}`,
    facts,
    credit: HYG_CREDIT,
  };
}

export interface StarsUiHooks {
  /** Camera position in pc relative to the Sun, or null when unknown. */
  viewerPc(): Vec3d | null;
  years(): number;
}

export function createInfoProvider(cat: StarCatalog, hooks: StarsUiHooks) {
  return {
    id: 'stars',
    info(id: string): InfoCard | null {
      const i = cat.indexOfId(id);
      return i < 0 ? null : starInfo(cat, i, hooks.viewerPc(), hooks.years());
    },
  };
}

/** Labels for proper-named stars brighter than LABEL_MAG_LIMIT from the current viewpoint. */
export function createLabelSource(cat: StarCatalog, enabled: () => boolean): LabelSource {
  const candidates = cat.names.rows.filter((r) => r[2] && !cat.distanceUnknown(r[0])).map((r) => r[0]);
  const ids = candidates.map((i) => cat.idOf(i));
  const names = candidates.map((i) => cat.displayName(i));
  const cam = vec3();
  const p = vec3();
  return {
    id: 'stars.labels',
    labels(view, out: LabelItem[]) {
      if (!enabled()) return;
      cameraPc(view, cam);
      const years = yearsSinceJ2000(view.jd);
      for (let k = 0; k < candidates.length; k++) {
        const i = candidates[k];
        cat.positionPc(i, years, p);
        const m = appMagAt(cat.data.absMag[i], Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z));
        if (m > LABEL_MAG_LIMIT) continue;
        out.push({
          id: ids[k],
          text: names[k],
          frame: SSB_FRAME,
          local: vec3(p.x * PC, p.y * PC, p.z * PC),
          priority: 30 - 4 * m,
          color: '#9fb4d8',
          target: ids[k],
        });
      }
    },
  };
}

/** 'orion-from-earth' and 'sun-from-alpha-cen' (the latter positioned from the catalogue). */
export function starBookmarks(cat: StarCatalog): Bookmark[] {
  const orion = dirRaDec(5.58, -1.2);
  const out: Bookmark[] = [
    {
      id: 'orion-from-earth',
      title: 'Orion from Earth',
      frame: SSB_FRAME,
      pos: vec3(orion.x * AU, orion.y * AU, orion.z * AU),
      quat: qlookRotation(quat(), orion, NORTH),
      fovY: (40 * Math.PI) / 180,
      ev: -4,
      lookTarget:
        'Orion at the centre, north up: orange Betelgeuse upper left, blue-white Rigel lower right, the three belt stars in a diagonal between them; black sky with a faint diffuse Milky Way glow towards the left.',
    },
  ];
  const a = cat.findByHip(71683);
  if (a >= 0) {
    const p = cat.positionPc(a, 0, vec3());
    const d = Math.hypot(p.x, p.y, p.z);
    const s = (d - 0.01) * PC; // 0.01 pc (~2000 AU) Sun-wards of α Cen A, which stays behind the camera
    const toSun = vec3(-p.x / d, -p.y / d, -p.z / d);
    out.push({
      id: 'sun-from-alpha-cen',
      title: 'The Sun from Alpha Centauri',
      frame: SSB_FRAME,
      pos: vec3((p.x / d) * s, (p.y / d) * s, (p.z / d) * s),
      quat: qlookRotation(quat(), toSun, NORTH),
      lookAt: 'sun',
      fovY: (40 * Math.PI) / 180,
      ev: -4,
      lookTarget:
        "Cassiopeia's W just right of centre; the Sun (m 0.5, drawn by solar-system, not by the stars module) at the centre, at RA 2h39m, Dec +60.8°.",
    });
  }
  return out;
}
