/**
 * Young stellar associations within 150 pc: the 27 BANYAN Sigma models of Gagné et al. 2018 (ApJ 856,
 * 23). Values are parsed from the paper's HTML tables (ar5iv): Table 1 (members, distance, spatial
 * scale, age with its reference) and Table 7 (central Galactic position). Table 7 uses heliocentric
 * Galactic axes with X towards the Galactic centre (checked below on Corona Australis and the Hyades).
 */
import { readFileSync } from 'node:fs';
import { icrsFromGalacticXyz, lbFromIcrs, round, slug, source, writeLayer } from '../lib.mjs';

export const GAGNE = {
  group: 'local',
  id: 'gagne_2018',
  cite: 'Gagné et al. 2018, ApJ 856, 23 (BANYAN Σ)',
  url: 'https://arxiv.org/abs/1801.09051',
  license: 'cited (no explicit licence)',
  fetch: { kind: 'file', url: 'https://ar5iv.labs.arxiv.org/html/1801.09051', file: 'gagne_2018.html' },
  outputs: ['data/milkyway/atlas/associations.json', 'data/milkyway/atlas/features-local.json'],
};

const cellText = (s) =>
  s
    .replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[  ​⁡-⁤ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Rows (arrays of cell text) of the ar5iv table with figure id `id`. */
function tableRows(html, id) {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) throw new Error(`Gagné: no table ${id}`);
  const t = html.slice(i, html.indexOf('</figure>', i));
  return t
    .split(/<tr[^>]*>/)
    .slice(1)
    .map((r) =>
      r
        .split(/<t[dh][^>]*>/)
        .slice(1)
        .map(cellText),
    );
}

/** '30 − 10 + 20' -> '30 (−10 / +20)', '∼ 10' -> '~10', '24 ± 3' stays. */
function valueText(s) {
  const t = s.replace(/∼\s*/g, '~').trim();
  const m = /^([\d.]+) − ([\d.]+) \+ ([\d.]+)$/.exec(t);
  return m ? `${m[1]} (−${m[2]} / +${m[3]})` : t;
}
const abbr = (s) => s.replace(/\s+/g, '');

/** Parsed Gagné et al. 2018 Tables 1 and 7, keyed by the association abbreviation (no spaces). */
export function gagneTables() {
  const html = readFileSync(source(GAGNE), 'utf8');
  const t1 = tableRows(html, 'S3.T1');
  const t7 = tableRows(html, 'S5.T7');
  const centres = {};
  for (const r of t7) {
    if (r.length < 13 || !/^-?[\d.]+$/.test(r[1])) continue;
    const [X, Y, Z] = r.slice(1, 4).map(Number);
    const sig = r.slice(7, 10).map((v) => Number(v.split(' ')[0]));
    centres[abbr(r[0])] = { X, Y, Z, sig };
  }
  const props = {};
  let note = '';
  for (const r of t1) {
    if (r.length < 12 || !/^\d+$/.test(r[1])) continue;
    const [refNo, ...rest] = r[11].split(' ');
    if (rest.length) note = rest.join(' ');
    props[abbr(r[0])] = {
      label: r[0],
      members: Number(r[1]),
      dist: valueText(r[6]),
      sSpa: Number(r[8]),
      age: valueText(r[10]),
      ref: refNo,
    };
  }
  // Full names and age references from the table notes.
  const namesText = /full names of young associations are: (.*?)\. References/.exec(note)?.[1];
  const refsText = /References\. — (.*)$/.exec(note)?.[1];
  if (!namesText || !refsText) throw new Error('Gagné Table 1: notes not found');
  const names = {};
  for (const m of namesText.matchAll(/(?:,\s*|^|\s+and\s+)(?:the\s+)?([^,(]+?)\s*\(\s*([^)]+?)\s*\)/g))
    names[abbr(m[2])] = m[1].trim();
  const refs = {};
  for (const m of refsText.matchAll(/\((\d+)\)\s*([^;]+?)\s*(?:;|\.?$)/g))
    refs[m[1]] = m[2].replace(/\s+/g, ' ').trim();
  return { centres, props, names, refs };
}

const GREEK = { β: 'beta', ϵ: 'epsilon', η: 'eta', ρ: 'rho', χ: 'chi' };
/** Display names spelled out from the paper's short forms (the paper's form stays as an alias). */
const RENAME = {
  TWA: 'TW Hydrae association',
  UMA: 'Ursa Major cluster (core)',
  UCRA: 'Upper Corona Australis',
  XFOR: 'chi1 Fornacis',
};
const RANK2 = new Set(['βPMG', 'TWA', 'ABDMG', 'THA', 'HYA', 'UMA', 'PLE']);

export default function build() {
  const { centres, props, names, refs } = gagneTables();
  const keys = Object.keys(props);
  if (keys.length !== 27) throw new Error(`Gagné Table 1: expected 27 associations, found ${keys.length}`);
  const rows = [];
  for (const k of keys) {
    const p = props[k];
    const c = centres[k];
    // IC 2391 and IC 2602 are not in the note: their abbreviation is their name.
    const paperName = names[k] ?? (/^IC\d+$/.test(k) ? `IC ${k.slice(2)}` : undefined);
    if (!c || !paperName) throw new Error(`Gagné: ${k} has no centre or name`);
    let name = paperName.replace(/^([βϵηρχ])\s*/, (_, g) => `${GREEK[g]} `);
    if (/MG$/.test(k)) name += ' moving group';
    name = RENAME[k] ?? name;
    const aliases = [...new Set([p.label, k, paperName].filter((a) => a !== name))];
    const [x, y, z] = icrsFromGalacticXyz(c.X, c.Y, c.Z);
    const d = Math.hypot(c.X, c.Y, c.Z);
    if (!(d < 200) || !(p.sSpa > 0 && p.sSpa < 100) || !(p.members > 0))
      throw new Error(`Gagné: implausible row ${k}`);
    const ref = refs[p.ref];
    rows.push([
      slug(name),
      name,
      aliases,
      round(x, 1),
      round(y, 1),
      round(z, 1),
      p.sSpa,
      RANK2.has(k) ? 2 : 1,
      ref
        ? `Age from ${ref === 'this paper' ? 'Gagné et al. 2018' : `${ref}, as compiled by Gagné et al. 2018`}`
        : null,
      p.age,
      p.dist,
      round(d, 1),
      p.members,
    ]);
  }
  for (const k of ['CRA', 'HYA', 'PLE']) {
    const c = centres[k];
    const q = lbFromIcrs(...icrsFromGalacticXyz(c.X, c.Y, c.Z));
    console.log(`  check ${k}: l = ${q.l.toFixed(1)}, b = ${q.b.toFixed(1)}, d = ${q.dist.toFixed(1)} pc`);
  }
  return writeLayer({
    layer: 'associations',
    title: 'Young stellar associations',
    noun: 'Young stellar association (moving group)',
    radius:
      'Characteristic spatial scale S_spa = |Σ_spa|^(1/3) of the BANYAN Σ model (Gagné et al. 2018, Table 1)',
    sources: { gagne: { cite: GAGNE.cite, url: GAGNE.url, license: GAGNE.license } },
    columns: [
      { key: 'id' },
      { key: 'name' },
      { key: 'aliases' },
      { key: 'x', source: 'gagne' },
      { key: 'y' },
      { key: 'z' },
      { key: 'r' },
      { key: 'rank' },
      { key: 'note' },
      { key: 'age', label: 'Age', unit: 'Myr', source: 'gagne' },
      {
        key: 'distTypical',
        label: 'Distance of most members (peak and ±1σ range)',
        unit: 'pc',
        source: 'gagne',
      },
      { key: 'distCentre', label: 'Distance of the model centre', unit: 'pc', source: 'gagne', digits: 1 },
      { key: 'members', label: 'Bona fide members in the model', source: 'gagne' },
    ],
    rows,
  });
}
