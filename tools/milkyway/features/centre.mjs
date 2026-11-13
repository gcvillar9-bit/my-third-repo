/**
 * The Galactic centre within about 300 pc of Sgr A* (atlas group 'centre'): nuclear star cluster,
 * nuclear stellar disc, Central Molecular Zone and its clouds, the Arches and Quintuplet clusters,
 * Sgr A East, the circumnuclear disc and the Radio Arc.
 *
 * Positions: SIMBAD (ICRS, one TAP query) or the (l, b) of Kauffmann et al. 2017 Table 1, all at
 * the distance of Sgr A* (GRAVITY Collaboration 2019) because the line-of-sight depth inside the
 * centre region is not measured for most of them. Hand-entered facts are in centre.json with
 * evidence quotes checked against the fetched papers (helpers in structure.mjs).
 */
import { readFileSync } from 'node:fs';
import { icrsFromLb, icrsFromRaDec, lbFromIcrs, round, sig, source } from '../lib.mjs';
import {
  SIMBAD_IDS,
  SOURCES,
  base,
  evidence,
  facts,
  finish,
  galacticCentre,
  radius,
  readInput,
  xyz,
} from './structure.mjs';

/** ICRS RA/Dec (deg) per SIMBAD identifier, parsed from the fetched TAP CSV. */
function simbadPositions() {
  const text = readFileSync(source(SOURCES.simbad_gc), 'utf8');
  const rows = text.trim().split('\n').slice(1);
  const out = new Map();
  for (const line of rows) {
    const m = line.match(/^"([^"]+)","([^"]+)",([-\d.eE]+),([-\d.eE]+)$/);
    if (!m) throw new Error(`simbad_gc: cannot parse "${line}"`);
    out.set(m[1], { ra: Number(m[3]), dec: Number(m[4]) });
  }
  for (const id of SIMBAD_IDS) if (!out.has(id)) throw new Error(`simbad_gc: no answer for ${id}`);
  return out;
}

/** Angular separation (deg) between two Galactic directions. */
function separationDeg(a, b) {
  const D = Math.PI / 180;
  const c =
    Math.sin(a.b * D) * Math.sin(b.b * D) + Math.cos(a.b * D) * Math.cos(b.b * D) * Math.cos((a.l - b.l) * D);
  return Math.acos(Math.min(1, c)) / D;
}

export default function build() {
  const gc = galacticCentre(readInput('structure'));
  const input = readInput('centre');
  const simbad = simbadPositions();
  const features = [];
  for (const f of input.features) {
    const where = `centre/${f.id}`;
    const p = f.position;
    let pos;
    if (p.kind === 'centre') pos = { ...xyz(icrsFromLb(gc.l, gc.b, gc.distPc)), positionSource: gc.source };
    else if (p.kind === 'simbad') {
      const s = simbad.get(p.ident);
      if (!s) throw new Error(`${where}: ${p.ident} not in SIMBAD_IDS`);
      pos = { ...xyz(icrsFromRaDec(s.ra, s.dec, gc.distPc)), positionSource: 'simbad_gc' };
    } else if (p.kind === 'lb') {
      const src = evidence(p.evidence, `${where} position`, [p.lQuoted ?? p.l, Math.abs(p.b)]);
      pos = { ...xyz(icrsFromLb(p.l, p.b, gc.distPc)), positionSource: src };
    } else throw new Error(`${where}: unknown position kind ${p.kind}`);
    const out = { ...base(f), ...pos };
    const r = radius(f.r, where);
    if (r !== undefined) out.r = r;
    out.facts = facts(f.facts, where);
    if (p.kind !== 'centre') {
      // Cross-check for the quoted projected distances (printed, not written).
      const sep = separationDeg(lbFromIcrs(out.x, out.y, out.z), gc);
      console.log(
        `  ${f.id}: ${round(gc.distPc * Math.tan((sep * Math.PI) / 180), 0)} pc from Sgr A* in projection`,
      );
    }
    for (const d of f.derived ?? []) {
      // Values computed from quoted inputs (see `formula`), marked approximate.
      evidence(d.evidence, `${where} "${d.label}"`, d.inputs);
      const v = d.formula === 'exp-half-mass' ? 1.6783 * d.inputs[0] : d.inputs[1] / d.inputs[0];
      out.facts.push({
        label: d.label,
        value: sig(v, 2),
        unit: d.unit,
        source: d.evidence.source,
        approximate: true,
      });
    }
    out.description = f.description;
    features.push(out);
  }
  return finish('centre', features);
}
