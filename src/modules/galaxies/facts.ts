/**
 * Measured facts of the gallery galaxies (gallery-facts.json, with sources), loaded lazily after the
 * catalogue: info-card rows and the measured inputs of the 3D portraits (PortraitMeasured), with
 * sanity checks. HyperLEDA's `inclinationDeg` is shown on the card but never shapes the model (it is an
 * axis-ratio estimate, wrong for bulge-dominated and edge-on galaxies).
 */
import type { InfoFact } from '../../core/contracts';
import factsJson from './gallery-facts.json';
import type { NamedGalaxy } from './named';
import type { PortraitMeasured } from './portrait-params';

export interface FactRow {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  source: string;
  approximate?: boolean;
}
const FACTS = factsJson as unknown as {
  sources: Record<string, { citation: string; url: string; retrieved: string }>;
  galaxies: Record<string, FactRow[]>;
};
/** Raw measured rows of a gallery galaxy (all keys, including those the card does not show). */
export const factRows = (id: string): readonly FactRow[] => FACTS.galaxies[id] ?? [];
/** Numeric measured value by key, if the sources have one. */
export const factNumber = (id: string, key: string): number | undefined => {
  const v = factRows(id).find((r) => r.key === key)?.value;
  return typeof v === 'number' ? v : undefined;
};
const factString = (id: string, key: string): string | undefined => {
  const v = factRows(id).find((r) => r.key === key)?.value;
  return typeof v === 'string' ? v : undefined;
};

/** Rows shown on the info card, in this order (the rest only shape the simulated model). */
const CARD_KEYS = [
  'rc3Type',
  'morphType',
  'inclinationDeg',
  'colorBV',
  'pitchDeg',
  'barRadiusArcsec',
  'bulgeToTotal',
  'ringRadiusKpc',
  'jetLengthKpc',
  'outflowExtentKpc',
  'tailLengthKpc',
  'bhMassMsun',
];
const ARCSEC = Math.PI / 648000;

export function measuredFacts(g: NamedGalaxy): InfoFact[] {
  const rows = factRows(g.id);
  const out: InfoFact[] = [];
  for (const key of CARD_KEYS) {
    const r = rows.find((x) => x.key === key);
    if (!r || (key === 'morphType' && rows.some((x) => x.key === 'rc3Type'))) continue;
    const fact: InfoFact = {
      label: r.label,
      value: r.value,
      ...(r.unit !== undefined ? { unit: r.unit } : {}),
      ...(r.approximate ? { approximate: true } : {}),
      source: FACTS.sources[r.source]?.citation ?? r.source,
    };
    if (key === 'barRadiusArcsec' && typeof r.value === 'number') {
      // Angular size on the sky to kpc at the catalogue distance (projected, hence approximate).
      fact.value = Number((r.value * ARCSEC * g.distSunMpc * 1e3).toPrecision(2));
      fact.unit = 'kpc';
      fact.approximate = true;
    } else if (key === 'bhMassMsun' && typeof r.value === 'number') {
      fact.value = Number((r.value / 1e6).toPrecision(3));
      fact.unit = 'million solar masses';
    }
    out.push(fact);
  }
  return out;
}

/** RC3 bar family from a type string: SB/IB strong, SAB/IAB weak, SA/IA none; undefined if absent. */
export function barFamily(rc3: string): 'A' | 'AB' | 'B' | undefined {
  const m = /(?:^|[^A-Za-z])(?:\([^)]*\))?([SI])(AB|A|B)(?![a-z])/.exec(rc3);
  if (!m) return undefined;
  return m[2] as 'A' | 'AB' | 'B';
}

export interface MeasuredResult {
  measured: PortraitMeasured;
  /** Values rejected or clamped by the sanity checks (key: reason). */
  notes: string[];
}

/**
 * Measured portrait inputs of gallery galaxy g from its fact rows. Sanity checks: B-V outside
 * 0.1..1.3 and bulge-to-total above 0.5 for stage T >= 4 are rejected; bar radius fractions are
 * clamped to 0.5 and ring fractions above 1.2 rejected.
 */
export function measuredForPortrait(g: NamedGalaxy): MeasuredResult {
  const id = g.id;
  const out: PortraitMeasured = {};
  const notes: string[] = [];
  const t = factNumber(id, 'tStage');
  if (t !== undefined) out.tStage = Math.min(10, Math.max(-5, t));
  const bv = factNumber(id, 'colorBV');
  if (bv !== undefined) {
    if (bv >= 0.1 && bv <= 1.3) out.colorBV = bv;
    else notes.push(`colorBV ${bv}: outside 0.1..1.3, rejected`);
  }
  const rc3 = factString(id, 'rc3Type');
  const fam = rc3 ? barFamily(rc3) : undefined;
  if (fam) out.barClass = fam;
  else if (factString(id, 'barFlag') === 'B') out.barClass = 'B';
  const bt = factNumber(id, 'bulgeToTotal');
  if (bt !== undefined) {
    if (bt < 0 || bt > 0.95) notes.push(`bulgeToTotal ${bt}: outside 0..0.95, rejected`);
    else if ((out.tStage ?? -5) >= 4 && bt > 0.5)
      notes.push(`bulgeToTotal ${bt}: implausible for stage T ${out.tStage}, rejected`);
    else out.bulgeToTotal = bt;
  }
  const barR = factNumber(id, 'barRadiusArcsec');
  const d25 = factNumber(id, 'd25Arcmin');
  if (barR !== undefined && d25 !== undefined && d25 > 0) {
    const f = barR / (30 * d25);
    if (f > 0.5) notes.push(`barRadiusFrac ${f.toFixed(2)} (${barR}" / D25 ${d25}'): clamped to 0.5`);
    out.barRadiusFrac = Math.min(0.5, f);
  }
  const pitch = factNumber(id, 'pitchDeg');
  if (pitch !== undefined) {
    if (pitch >= 3 && pitch <= 50) out.pitchDeg = pitch;
    else notes.push(`pitchDeg ${pitch}: outside 3..50, rejected`);
  }
  const ring = factNumber(id, 'ringRadiusKpc');
  if (ring !== undefined && g.radiusKpc > 0) {
    const f = ring / g.radiusKpc;
    if (f > 0 && f <= 1.2) out.ringRadiusFrac = f;
    else notes.push(`ringRadiusKpc ${ring}: ${f.toFixed(2)} of the radius, rejected`);
  }
  for (const key of ['jetLengthKpc', 'outflowExtentKpc', 'tailLengthKpc'] as const) {
    const v = factNumber(id, key);
    if (v === undefined) continue;
    if (v > 0 && v < 20 * g.radiusKpc) out[key] = v;
    else notes.push(`${key} ${v}: rejected`);
  }
  return { measured: out, notes };
}
