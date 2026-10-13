/**
 * CPU view of the HYG catalogue: positions with linear proper motion, apparent magnitudes
 * from any viewpoint, names, designations and derived facts. Pure (unit-tested in Node).
 */
import type { Vec3d } from '../../core/contracts';
import { bvToTeff, SUN_ABS_MAG_V } from '../../core/photometry';
import { BV_UNKNOWN, FLAG_DIST_UNKNOWN, fromHalf, NO_NAME, PM_PC_PER_KMS_YR, type StarData } from './format';

/** names.json row: [star index, hip, proper, bayer, flamsteed, con]. */
export type NameRow = [number, number | null, string | null, string | null, number | null, string | null];

export interface StarNames {
  version: number;
  source?: string;
  columns: string[];
  rows: NameRow[];
  constellations: Record<string, string>;
  overrides?: { hip: number; name: string; bv: number; source: string }[];
}

/** B-V assumed when the catalogue has none (a solar-type colour). */
export const DEFAULT_BV = 0.65;
/** Proper motion is frozen beyond ±1 Myr from the epoch (validity core.stars.proper-motion). */
export const PM_MAX_YEARS = 1e6;

const GREEK: Record<string, string> = {
  α: 'Alpha',
  β: 'Beta',
  γ: 'Gamma',
  δ: 'Delta',
  ε: 'Epsilon',
  ζ: 'Zeta',
  η: 'Eta',
  θ: 'Theta',
  ι: 'Iota',
  κ: 'Kappa',
  λ: 'Lambda',
  μ: 'Mu',
  ν: 'Nu',
  ξ: 'Xi',
  ο: 'Omicron',
  π: 'Pi',
  ρ: 'Rho',
  σ: 'Sigma',
  τ: 'Tau',
  υ: 'Upsilon',
  φ: 'Phi',
  χ: 'Chi',
  ψ: 'Psi',
  ω: 'Omega',
};
const SUPERSCRIPT: Record<string, string> = { '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6' };

/** Well-known names not in HYG's `proper` column, keyed by HIP. */
const EXTRA_ALIASES: Record<number, string[]> = {
  71683: ['Alpha Centauri', 'Alpha Centauri A'],
  71681: ['Alpha Centauri B'],
  70890: ['Alpha Centauri C', 'Proxima'],
  32349: ['Dog Star'],
  11767: ['North Star', 'Pole Star'],
};

/** "α¹" → "Alpha1"; Latin letters are kept. */
export function latinBayer(bayer: string): string {
  let out = '';
  for (const ch of bayer) out += GREEK[ch] ?? SUPERSCRIPT[ch] ?? ch;
  return out;
}

/** Spectral class estimated from Teff (main-sequence scale; approximate). */
export function spectralClass(teff: number): string {
  const classes: [string, number, number][] = [
    ['O', 50000, 31500],
    ['B', 31500, 10000],
    ['A', 10000, 7300],
    ['F', 7300, 6000],
    ['G', 6000, 5300],
    ['K', 5300, 3900],
    ['M', 3900, 2300],
  ];
  for (const [letter, hot, cool] of classes) {
    if (teff >= cool || letter === 'M') {
      const f = Math.log(hot / Math.max(teff, 1)) / Math.log(hot / cool);
      return `${letter}${Math.min(9, Math.max(0, Math.floor(10 * f)))}`;
    }
  }
  return 'M9';
}

/** V-band luminosity in solar units from M_V (no bolometric correction). */
export const luminositySun = (absMag: number): number => 10 ** (-0.4 * (absMag - SUN_ABS_MAG_V));

/** Apparent magnitude at distance d (pc). */
export const appMagAt = (absMag: number, dPc: number): number =>
  absMag + 5 * Math.log10(Math.max(dPc, 1e-12) / 10);

/** Right ascension [0, 2π) and declination of an ICRS direction, radians. */
export function raDec(v: Vec3d): { ra: number; dec: number } {
  const r = Math.hypot(v.x, v.y, v.z) || 1;
  let ra = Math.atan2(v.y, v.x);
  if (ra < 0) ra += 2 * Math.PI;
  return { ra, dec: Math.asin(Math.max(-1, Math.min(1, v.z / r))) };
}

/** "2h 39m 45s" */
export function formatRa(ra: number): string {
  let s = Math.round((ra * 12 * 3600) / Math.PI);
  s = ((s % 86400) + 86400) % 86400;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

/** "+60° 50′" */
export function formatDec(dec: number): string {
  const m = Math.round((Math.abs(dec) * 180 * 60) / Math.PI);
  return `${dec < 0 ? '−' : '+'}${Math.floor(m / 60)}° ${m % 60}′`;
}

export class StarCatalog {
  readonly count: number;
  private readonly hipToIndex = new Map<number, number>();
  private readonly nameToIndex = new Map<string, number>();

  constructor(
    readonly data: StarData,
    readonly names: StarNames,
  ) {
    this.count = data.count;
    for (const row of names.rows) {
      if (row[1] !== null) this.hipToIndex.set(row[1], row[0]);
      if (row[2]) this.nameToIndex.set(row[2].toLowerCase(), row[0]);
    }
  }

  nameRow(i: number): NameRow | null {
    const k = this.data.nameIndex[i];
    return k === NO_NAME ? null : (this.names.rows[k] ?? null);
  }

  /** Star index by proper name (case-insensitive) or -1. */
  findByName(name: string): number {
    return this.nameToIndex.get(name.toLowerCase()) ?? -1;
  }

  findByHip(hip: number): number {
    return this.hipToIndex.get(hip) ?? -1;
  }

  /** Search/info id: 'hip:<n>' when the star has a (named) HIP id, else 'star:<index>'. */
  idOf(i: number): string {
    const hip = this.nameRow(i)?.[1];
    return hip != null ? `hip:${hip}` : `star:${i}`;
  }

  /** Inverse of idOf, or -1. */
  indexOfId(id: string): number {
    const m = /^(hip|star):(\d+)$/.exec(id);
    if (!m) return -1;
    const n = Number(m[2]);
    if (m[1] === 'hip') return this.findByHip(n);
    return n < this.count ? n : -1;
  }

  /** "α CMa" (or "9 CMa"), or null. */
  designation(i: number): string | null {
    const row = this.nameRow(i);
    if (!row || !row[5]) return null;
    if (row[3]) return `${row[3]} ${row[5]}`;
    if (row[4] !== null) return `${row[4]} ${row[5]}`;
    return null;
  }

  displayName(i: number): string {
    return this.nameRow(i)?.[2] ?? this.designation(i) ?? `HYG star ${i}`;
  }

  /** Search aliases: designations (Greek and Latin spelling), Flamsteed, HIP and common names. */
  aliases(i: number): string[] {
    const row = this.nameRow(i);
    if (!row) return [];
    const [, hip, proper, bayer, flam, con] = row;
    const out: string[] = [];
    if (con && bayer) {
      out.push(`${bayer} ${con}`);
      const latin = latinBayer(bayer);
      out.push(`${latin} ${con}`);
      const bare = latin.replace(/\d+$/, '');
      if (bare !== latin) out.push(`${bare} ${con}`);
    }
    if (con && flam !== null) out.push(`${flam} ${con}`);
    if (hip !== null) out.push(`HIP ${hip}`, ...(EXTRA_ALIASES[hip] ?? []));
    return out.filter((a) => a !== proper);
  }

  constellation(i: number): string | null {
    const con = this.nameRow(i)?.[5];
    return con ? (this.names.constellations[con] ?? con) : null;
  }

  distanceUnknown(i: number): boolean {
    return (this.data.flags[i] & FLAG_DIST_UNKNOWN) !== 0;
  }

  /** Position in pc (ICRS, Sun-centred) `years` after the epoch, linear proper motion. */
  positionPc(i: number, years: number, out: Vec3d): Vec3d {
    const p = this.data.position;
    const t = Math.max(-PM_MAX_YEARS, Math.min(PM_MAX_YEARS, years)) * PM_PC_PER_KMS_YR;
    const v = this.data.velocityHalf;
    out.x = p[3 * i] + (t && fromHalf(v[3 * i]) * t);
    out.y = p[3 * i + 1] + (t && fromHalf(v[3 * i + 1]) * t);
    out.z = p[3 * i + 2] + (t && fromHalf(v[3 * i + 2]) * t);
    return out;
  }

  /** Apparent magnitude seen from `viewerPc` (pc, ICRS, Sun-centred). */
  appMag(i: number, viewerPc: Vec3d, years = 0): number {
    const p = this.positionPc(i, years, { x: 0, y: 0, z: 0 });
    return appMagAt(this.data.absMag[i], Math.hypot(p.x - viewerPc.x, p.y - viewerPc.y, p.z - viewerPc.z));
  }

  bv(i: number): number | null {
    const c = this.data.bv[i];
    return c === BV_UNKNOWN ? null : this.data.bvMin + c * this.data.bvStep;
  }

  /** Colour temperature from B-V (Ballesteros 2012), K. */
  teff(i: number): number {
    return bvToTeff(this.bv(i) ?? DEFAULT_BV);
  }
}
