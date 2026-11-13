import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICRS_TO_GALACTIC } from '../../../src/core/frames';
import { decodeGalaxies } from '../../../src/modules/galaxies/format';
import { Atlas, FEATURE_FILES, LAYER_FILES } from '../../../src/modules/milkyway/atlas/catalog';
import { centrePopulations, galacticPlanePa } from '../../../src/modules/milkyway/atlas/centre';
import { modelToIcrsPc, spiralPoints } from '../../../src/modules/milkyway/atlas/geometry';
import { createAtlasLabels, labelAnchor } from '../../../src/modules/milkyway/atlas/labels';
import raw from '../../../src/modules/milkyway/atlas/looks.json';
import {
  addCepheids,
  addClusterStars,
  addPopulation,
  decodeClusterStars,
  PointBuilder,
  satellitePopulations,
  skyBasis,
} from '../../../src/modules/milkyway/atlas/points';
import {
  createAtlasInfo,
  createAtlasSearch,
  objectBookmark,
} from '../../../src/modules/milkyway/atlas/providers';
import { icrsPcToUniverseMpc, satelliteMatcher } from '../../../src/modules/milkyway/atlas/satellites';
import { GROUPS, styleOf } from '../../../src/modules/milkyway/atlas/style';
import type { FeatureFile, LayerFile } from '../../../src/modules/milkyway/atlas/types';
import { atlasBookmarks, GUIDE_BOOKMARKS } from '../../../src/modules/milkyway/atlas-bookmarks';
import { createAtlasState, guideAlpha } from '../../../src/modules/milkyway/guides';
import {
  ARMS,
  armRadius,
  MODEL,
  thickFlare,
  thinFlare,
  warpHeight,
} from '../../../src/modules/milkyway/model';
import { KPC, PC } from '../../../src/core/units';

const root = (p: string) => new URL(`../../../${p}`, import.meta.url);
const json = <T>(p: string) => JSON.parse(readFileSync(root(p), 'utf8')) as T;
const DATA = 'public/data/milkyway/atlas/';

const layers = LAYER_FILES.map((n) => json<LayerFile>(`${DATA}${n}.json`));
const features = FEATURE_FILES.map((n) => json<FeatureFile>(`${DATA}features-${n}.json`));
const atlas = new Atlas();
for (const f of layers) atlas.addLayer(f);
for (const f of features) atlas.addFeatures(f);

const byName = (cls: string, name: string) => {
  const o = atlas.objects.find((x) => x.cls === cls && (x.name === name || x.aliases.includes(name)));
  if (!o) throw new Error(`no ${cls} named ${name}`);
  return o;
};
const dist = (o: { x: number; y: number; z: number }) => Math.hypot(o.x, o.y, o.z);
const sep = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** RA, Dec in degrees of a Sun-centred ICRS position. */
const raDec = (o: { x: number; y: number; z: number }) => {
  const d = dist(o);
  return [((Math.atan2(o.y, o.x) * 180) / Math.PI + 360) % 360, (Math.asin(o.z / d) * 180) / Math.PI];
};

describe('atlas data: every value has a source', () => {
  it('ships every layer and feature file the loader expects', () => {
    for (const n of LAYER_FILES) expect(existsSync(root(`${DATA}${n}.json`)), n).toBe(true);
    for (const n of FEATURE_FILES) expect(existsSync(root(`${DATA}features-${n}.json`)), n).toBe(true);
    expect(atlas.objects.length).toBeGreaterThan(15000);
  });

  it('gives every fact column of a layer a label and a listed source, and every row a finite position', () => {
    const reserved = new Set(['id', 'name', 'aliases', 'x', 'y', 'z', 'r', 'rank', 'note', 'rowSource']);
    for (const f of layers) {
      const keys = f.columns.map((c) => c.key);
      expect(new Set(keys).size, f.layer).toBe(keys.length);
      for (const c of f.columns) {
        if (c.key === 'x') expect(f.sources[c.source ?? ''], `${f.layer} position`).toBeDefined();
        if (reserved.has(c.key)) continue;
        expect(c.label, `${f.layer}.${c.key}`).toBeTruthy();
        expect(f.sources[c.source ?? ''], `${f.layer}.${c.key}`).toBeDefined();
      }
      for (const s of Object.values(f.sources)) {
        expect(s.cite.length).toBeGreaterThan(8);
        expect(s.url).toMatch(/^https?:\/\//);
        expect(s.license.length).toBeGreaterThan(2);
      }
      const ix = keys.indexOf('x');
      const ids = new Set<string>();
      for (const row of f.rows) {
        expect(row.length).toBe(keys.length);
        for (let k = 0; k < 3; k++) expect(Number.isFinite(row[ix + k])).toBe(true);
        ids.add(String(row[keys.indexOf('id')]));
      }
      expect(ids.size, f.layer).toBe(f.rows.length);
    }
  });

  it('gives every fact, position and shape of a feature a listed source', () => {
    for (const f of features) {
      for (const feat of f.features) {
        expect(f.sources[feat.positionSource], `${f.group}/${feat.id}`).toBeDefined();
        for (const fact of feat.facts ?? [])
          expect(f.sources[fact.source], `${feat.id}: ${fact.label}`).toBeDefined();
        if (feat.shape) expect(f.sources[feat.shape.source], `${feat.id} shape`).toBeDefined();
        for (const v of [feat.x, feat.y, feat.z]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('records a URL, a licence and a sha256 for every fetched file, and credits them in the manifest', () => {
    const dir = root('tools/milkyway/sources/');
    const files = readdirSync(dir).filter((n) => n.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(7);
    const cites = new Set<string>();
    let n = 0;
    for (const name of files) {
      const g = json<{ sources: Record<string, string>[] }>(`tools/milkyway/sources/${name}`);
      for (const s of g.sources) {
        expect(s.url, s.id).toMatch(/^https?:\/\//);
        expect(s.fetchUrl, s.id).toMatch(/^https:\/\//);
        expect(s.sha256, s.id).toMatch(/^[0-9a-f]{64}$/);
        expect(s.license.length, s.id).toBeGreaterThan(2);
        cites.add(`${s.attribution}|${s.license}`);
        n++;
      }
    }
    expect(n).toBeGreaterThan(150);
    const manifest = json<{ assets: { atlas?: boolean; attribution: string; license: string }[] }>(
      'assets/manifest/milkyway.json',
    );
    const credited = new Set(
      manifest.assets.filter((a) => a.atlas).map((a) => `${a.attribution}|${a.license}`),
    );
    for (const c of cites) expect(credited.has(c), c).toBe(true);
  });

  it('keeps hand-entered values with an evidence quote next to each one', () => {
    for (const g of ['structure', 'centre', 'bubbles', 'local', 'magellanic']) {
      const text = readFileSync(root(`tools/milkyway/features/${g}.json`), 'utf8');
      expect((text.match(/"quote"/g) ?? []).length, g).toBeGreaterThan(5);
      // centre and bubbles check their quotes through the helper they share with structure.mjs.
      const builder = readFileSync(root(`tools/milkyway/features/${g}.mjs`), 'utf8');
      expect(/checkQuote|from '\.\/structure\.mjs'/.test(builder), g).toBe(true);
    }
  });

  it('uses the same ICRS to Galactic rotation in the build tool as the app', () => {
    const lib = readFileSync(root('tools/milkyway/lib.mjs'), 'utf8');
    const block = /export const ICRS_TO_GALACTIC = \[([^\]]+)\]/.exec(lib)![1];
    const values = block
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '')
      .map(Number);
    expect(values.length).toBe(9);
    values.forEach((v, k) => expect(v).toBeCloseTo(ICRS_TO_GALACTIC[k], 12));
  });
});

describe('atlas data: known objects are in the right place', () => {
  it('places the Pleiades, the Hyades and M67', () => {
    const p = byName('open-clusters', 'Pleiades');
    expect(dist(p)).toBeGreaterThan(130);
    expect(dist(p)).toBeLessThan(140);
    const [ra, dec] = raDec(p);
    expect(ra).toBeCloseTo(56.7, 0);
    expect(dec).toBeCloseTo(24.1, 0);
    expect(p.aliases).toContain('M45');
    expect(dist(byName('open-clusters', 'Hyades'))).toBeCloseTo(47, 0);
    const m67 = dist(byName('open-clusters', 'M 67'));
    expect(m67).toBeGreaterThan(800);
    expect(m67).toBeLessThan(900);
    // No globular cluster in this layer (they come from the Baumgardt list) and no duplicate names.
    const names = atlas.ofClass('open-clusters').map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain('NGC 104');
  });

  it('puts the Crab Nebula at its pulsar, and Vela, Cassiopeia A and W51 at their distances', () => {
    const crab = byName('remnants', 'Crab Nebula');
    const psr = byName('pulsars', 'PSR B0531+21');
    expect(sep(crab, psr)).toBeLessThan(10);
    expect(dist(psr)).toBeGreaterThan(1600);
    expect(dist(psr)).toBeLessThan(2200);
    const [ra, dec] = raDec(psr);
    expect(ra).toBeCloseTo(83.63, 1);
    expect(dec).toBeCloseTo(22.01, 1);
    expect(dist(byName('pulsars', 'PSR B0833-45'))).toBeCloseTo(287, -1.5);
    const casA = dist(byName('remnants', 'Cassiopeia A'));
    expect(casA).toBeGreaterThan(3000);
    expect(casA).toBeLessThan(3700);
    const w51 = atlas.ofClass('masers').find((o) => /W ?51/.test(`${o.name} ${o.aliases.join(' ')}`))!;
    expect(dist(w51)).toBeGreaterThan(4800);
    expect(dist(w51)).toBeLessThan(6000);
    const taurus = dist(byName('clouds', 'Taurus'));
    expect(taurus).toBeGreaterThan(120);
    expect(taurus).toBeLessThan(170);
  });

  it('places the satellites, the streams and the Magellanic gas in the halo', () => {
    const fornax = byName('satellites', 'Fornax');
    expect(dist(fornax) / 1000).toBeGreaterThan(135);
    expect(dist(fornax) / 1000).toBeLessThan(155);
    expect(atlas.value(fornax, 'absMag')).toBeCloseTo(-13.4, 0);
    const lmc = atlas.get('mw:satellites:lmc')!;
    expect(dist(lmc) / 1000).toBeCloseTo(50, 0);
    expect(atlas.ofClass('satellites').length).toBeGreaterThan(60);
    const streams = atlas.ofClass('stream');
    expect(streams.length).toBeGreaterThan(100);
    const gd1 = streams.find((s) => s.name === 'GD-1')!;
    expect(gd1.shape?.kind).toBe('polyline');
    if (gd1.shape?.kind === 'polyline') {
      expect(gd1.shape.points.length).toBeGreaterThan(10);
      for (const p of gd1.shape.points) {
        const d = Math.hypot(p[0], p[1], p[2]) / 1000;
        expect(d).toBeGreaterThan(5);
        expect(d).toBeLessThan(15);
      }
    }
    const ms = atlas.get('mw:magellanic:magellanic-stream')!;
    expect(ms.shape?.kind).toBe('polyline');
    if (ms.shape?.kind === 'polyline')
      expect(
        sep({ x: ms.shape.points[0][0], y: ms.shape.points[0][1], z: ms.shape.points[0][2] }, lmc),
      ).toBeLessThan(8000);
  });

  it('places the Galactic-centre features at Sgr A* and the bubbles above and below it', () => {
    const c = modelToIcrsPc(0, 0, 0);
    const centre = { x: c[0], y: c[1], z: c[2] };
    expect(dist(centre)).toBeCloseTo(8178, -1);
    for (const o of atlas.objects.filter((x) => x.file === 'features-centre'))
      expect(sep(o, centre), o.id).toBeLessThan(350);
    const nsc = atlas.get('mw:centre:nuclear-star-cluster')!;
    expect(sep(nsc, centre)).toBeLessThan(5);
    expect(nsc.r).toBeCloseTo(4.2, 1);
    for (const id of ['fermi-bubbles', 'erosita-bubbles']) {
      const b = atlas.get(`mw:bubbles:${id}`)!;
      expect(b.shape?.kind).toBe('ellipsoid-pair');
      if (b.shape?.kind !== 'ellipsoid-pair') continue;
      // The lobes touch the Galactic plane: offset equals the vertical semi-axis.
      expect(b.shape.offsetPc).toBeCloseTo(b.shape.semiAxesPc[2], -1);
      expect(b.shape.offsetPc).toBeGreaterThan(4000);
      expect(b.shape.offsetPc).toBeLessThan(8000);
    }
  });

  it('has the Local Bubble around the Sun and the Radcliffe Wave through Orion', () => {
    const lb = atlas.get('mw:local:local-bubble')!;
    expect(lb.shape?.kind).toBe('radial-map');
    if (lb.shape?.kind === 'radial-map') {
      expect(lb.shape.radiiPc.length).toBe(lb.shape.nLon * lb.shape.nLat);
      expect(Math.min(...lb.shape.radiiPc)).toBeGreaterThan(50);
      expect(Math.max(...lb.shape.radiiPc)).toBeLessThan(500);
    }
    expect(dist(lb)).toBeLessThan(80);
    const rw = atlas.get('mw:local:radcliffe-wave')!;
    expect(rw.shape?.kind).toBe('polyline');
    // Orion A: l = 209, b = -19.4, 400 pc.
    const g = ICRS_TO_GALACTIC;
    const l = (209 * Math.PI) / 180;
    const b = (-19.4 * Math.PI) / 180;
    const G = [400 * Math.cos(b) * Math.cos(l), 400 * Math.cos(b) * Math.sin(l), 400 * Math.sin(b)];
    const orion = {
      x: g[0] * G[0] + g[3] * G[1] + g[6] * G[2],
      y: g[1] * G[0] + g[4] * G[1] + g[7] * G[2],
      z: g[2] * G[0] + g[5] * G[1] + g[8] * G[2],
    };
    if (rw.shape?.kind === 'polyline') {
      const nearest = Math.min(...rw.shape.points.map((p) => sep({ x: p[0], y: p[1], z: p[2] }, orion)));
      expect(nearest).toBeLessThan(60);
    }
    expect(atlas.ofClass('associations').length).toBe(27);
  });

  it('draws the arms of Reid et al. 2019 where the galaxy model has them', () => {
    const arms = atlas.ofClass('arm').filter((a) => a.shape?.kind === 'log-spiral');
    expect(arms.length).toBe(7);
    for (const row of MODEL.arms) {
      const a = arms.find((x) => x.shape?.kind === 'log-spiral' && x.shape.rKinkKpc === row.rKink);
      expect(a, row.segment).toBeDefined();
      if (a?.shape?.kind !== 'log-spiral') continue;
      expect(a.shape.psiLtDeg).toBe(row.psiLt);
      expect(a.shape.psiGtDeg).toBe(row.psiGt);
      expect(a.shape.betaKinkDeg).toBe(row.betaKink);
      // The guide line and the model use the same curve.
      const arm = ARMS[MODEL.arms.indexOf(row)];
      for (const beta of [a.shape.betaMeasuredDeg[0], row.betaKink, a.shape.betaMeasuredDeg[1]]) {
        const [[x, y]] = spiralPoints(a.shape, beta, beta);
        expect(Math.hypot(x, y)).toBeCloseTo(armRadius(arm, (beta * Math.PI) / 180), 6);
      }
    }
    // The Local arm passes within 0.5 kpc of the Sun.
    const local = arms.find((a) => a.name === 'Local Arm')!;
    if (local.shape?.kind === 'log-spiral') {
      const pts = spiralPoints(local.shape, -8, 34, 1).map(([x, y]) => modelToIcrsPc(x, y, 0));
      expect(Math.min(...pts.map((p) => Math.hypot(p[0], p[1], p[2])))).toBeLessThan(500);
    }
  });
});

describe('atlas model: warp and flare', () => {
  it('keeps the plane flat inside the solar circle and warps it north towards l = 90 outside', () => {
    expect(warpHeight(-8.178, 0)).toBe(0);
    expect(warpHeight(3, 4)).toBe(0);
    // Chen et al. 2019 at R = 15 kpc where sin(phi - phi_w) = 1: 0.06 (15 - 7.72)^1.33 = 0.84 kpc.
    const phi = ((90 + 17.5) * Math.PI) / 180;
    expect(warpHeight(-15 * Math.cos(phi), 15 * Math.sin(phi))).toBeCloseTo(0.84, 1);
    expect(warpHeight(0, 14)).toBeGreaterThan(0.3); // the l = 90 side goes north
    expect(warpHeight(0, -14)).toBeLessThan(-0.3);
  });

  it('flares the discs outside the solar circle only', () => {
    expect(thinFlare(4)).toBe(1);
    expect(thickFlare(4)).toBe(1);
    expect(thinFlare(8.178)).toBeCloseTo(1, 3);
    // Lopez-Corredoira & Molgo 2014: the thin disc is about 3.3 times thicker at 15 kpc.
    expect(thinFlare(15)).toBeGreaterThan(2.8);
    expect(thinFlare(15)).toBeLessThan(3.6);
    expect(thickFlare(15)).toBeGreaterThan(1.3);
    expect(MODEL.warp.source).toMatch(/Chen/);
    expect(MODEL.flare.source).toMatch(/Molg/);
  });
});

describe('atlas light', () => {
  const stars = decodeClusterStars(
    new Uint8Array(readFileSync(root(`${DATA}cluster-stars.bin`))).buffer as ArrayBuffer,
  );

  it('decodes the member stars and keeps them inside their clusters', () => {
    const layer = atlas.layers.get('open-clusters')!;
    const total = layer.file.rows.reduce((s, r) => s + (r[layer.col.nStars] as number), 0);
    expect(stars.count).toBe(total);
    expect(stars.count).toBeGreaterThan(300_000);
    for (let i = 1; i < stars.count; i++)
      expect(stars.cluster[i]).toBeGreaterThanOrEqual(stars.cluster[i - 1]);
    const b = new PointBuilder();
    addClusterStars(b, atlas, stars, 82);
    expect(b.count).toBe(stars.count);
    // Pleiades members: within 25 pc of the centre, the brightest ones brighter than M = 5.
    const p = byName('open-clusters', 'Pleiades');
    let n = 0;
    let brightest = 99;
    for (let i = 0; i < b.count; i++) {
      const d = Math.hypot(b.pos[3 * i] - p.x, b.pos[3 * i + 1] - p.y, b.pos[3 * i + 2] - p.z);
      if (stars.cluster[i] !== p.index) continue;
      expect(d).toBeLessThan(40);
      n++;
      brightest = Math.min(brightest, b.mag[i]);
    }
    expect(n).toBe(82);
    expect(brightest).toBeLessThan(6);
    // Fewer stars per cluster on low presets.
    const few = new PointBuilder();
    addClusterStars(few, atlas, stars, 12);
    expect(few.count).toBeLessThan(0.3 * b.count);
  });

  it('gives Cepheids their period-luminosity brightness and flags them for dust extinction', () => {
    const b = new PointBuilder();
    addCepheids(b, atlas);
    expect(b.count).toBeGreaterThan(2000);
    expect(Math.min(...b.ext)).toBe(1);
    const delta = atlas.ofClass('cepheids').find((o) => atlas.value(o, 'period')! > 10)!;
    // M_V = -4.05 - 2.43 (log P - 1)
    expect(atlas.value(delta, 'absMag')).toBeCloseTo(
      -4.05 - 2.43 * (Math.log10(atlas.value(delta, 'period')!) - 1),
      1,
    );
  });

  it('turns satellites into star clouds with the measured size and total light', () => {
    const pops = satellitePopulations(atlas, 1);
    expect(pops.length).toBeGreaterThan(50);
    const fornax = byName('satellites', 'Fornax');
    const pop = pops.find((q) => q.x === fornax.x)!;
    expect(pops.some((q) => q.x === atlas.get('mw:satellites:lmc')!.x)).toBe(false); // drawn by galaxies
    const b = new PointBuilder();
    addPopulation(b, pop, 1);
    expect(b.count).toBe(pop.points);
    // Flux conservation: the points together carry the catalogue magnitude (colour scaling aside).
    let flux = 0;
    let inside = 0;
    const { e, n } = skyBasis(pop.x, pop.y, pop.z);
    for (let i = 0; i < b.count; i++) {
      const m = Math.max(b.col[3 * i], b.col[3 * i + 1], b.col[3 * i + 2]);
      expect(m).toBeCloseTo(1, 6);
      flux += 10 ** (-0.4 * b.mag[i]);
      const dx = b.pos[3 * i] - pop.x;
      const dy = b.pos[3 * i + 1] - pop.y;
      const dz = b.pos[3 * i + 2] - pop.z;
      const pe = dx * e.x + dy * e.y + dz * e.z;
      const pn = dx * n.x + dy * n.y + dz * n.z;
      if (Math.hypot(pe, pn) < pop.rHalf) inside++;
    }
    expect(inside / b.count).toBeGreaterThan(0.3);
    expect(inside / b.count).toBeLessThan(0.7);
    const maxRgb = 10 ** (-0.4 * (b.mag[0] - (pop.absMag + 2.5 * Math.log10(pop.points))));
    expect(-2.5 * Math.log10(flux / maxRgb)).toBeCloseTo(pop.absMag, 3);
  });

  it('draws the nuclear star cluster, the nuclear disc, the Arches and the Quintuplet from their facts', () => {
    const pops = centrePopulations(atlas, 1);
    expect(pops.length).toBe(4);
    const nsc = pops.find((p) => Math.abs(p.rHalf - 4.2) < 0.01)!;
    // 2.5e7 Msun at 0.5 Lsun per Msun: M_V = 4.83 - 2.5 log10(1.25e7).
    expect(nsc.absMag).toBeCloseTo(4.83 - 2.5 * Math.log10(1.25e7), 2);
    for (const p of pops) expect(p.ext).toBe(1);
    // The Galactic plane at Sgr A* runs at a position angle of about 31.4 deg east of north (mod 180).
    const pa = ((galacticPlanePa(nsc.x, nsc.y, nsc.z) % 180) + 180) % 180;
    expect(pa).toBeGreaterThan(29);
    expect(pa).toBeLessThan(34);
  });

  it('hides exactly the Milky Way satellites of the galaxy catalogue that it draws itself', () => {
    const buf = readFileSync(root('public/data/galaxies/galaxies.bin'));
    const data = decodeGalaxies(new Uint8Array(buf).buffer as ArrayBuffer);
    const names = json<{ names: string[] }>('public/data/galaxies/names.json').names;
    const match = satelliteMatcher(satellitePopulations(atlas, 1));
    const hidden: string[] = [];
    for (let i = 0; i < data.count; i++)
      if (match(data.pos[3 * i], data.pos[3 * i + 1], data.pos[3 * i + 2]))
        hidden.push(names[data.nameIdx[i]] ?? `row ${i}`);
    for (const n of [
      'Fornax',
      'Sculptor',
      'Draco',
      'Carina',
      'Sextans',
      'Leo I',
      'Leo II',
      'UrsaMinor',
      'Sagittarius dSph',
    ])
      expect(
        hidden.some((h) => h.includes(n)),
        n,
      ).toBe(true);
    for (const h of hidden) {
      expect(h).not.toMatch(/LMC|SMC|Magellanic|M 31|M 33|Andromeda/);
    }
    expect(hidden.length).toBeLessThan(30);
    // The Sun maps to the ssb origin of the universe frame, 8.178 kpc from its origin.
    const sun = icrsPcToUniverseMpc(0, 0, 0);
    expect(Math.hypot(sun[0], sun[1], sun[2]) * 1000).toBeCloseTo(8.178, 2);
  });
});

describe('atlas guides, labels, search and info', () => {
  it('shows guides by default only beyond 2 kpc from the Sun and never far outside the Local Group', () => {
    const s = createAtlasState();
    expect(guideAlpha(s, 0, 8 * KPC)).toBe(0);
    expect(guideAlpha(s, 1.9 * KPC, 8 * KPC)).toBe(0);
    expect(guideAlpha(s, 3 * KPC, 8 * KPC)).toBe(1);
    expect(guideAlpha(s, 1300 * KPC, 1300 * KPC)).toBeLessThan(0.7);
    expect(guideAlpha(s, 2000 * KPC, 2000 * KPC)).toBe(0);
    s.mode = 'on';
    expect(guideAlpha(s, 0, 8 * KPC)).toBe(1);
    s.mode = 'off';
    expect(guideAlpha(s, 100 * KPC, 100 * KPC)).toBe(0);
  });

  it('labels arms and bubbles from far out and clusters only from close by', () => {
    const s = createAtlasState();
    const labels = createAtlasLabels(atlas, s);
    const c = modelToIcrsPc(0, 0, 80);
    const far = labels.select({ x: c[0], y: c[1], z: c[2] }).map((o) => o.name);
    expect(far).toContain('Perseus Arm');
    expect(far).toContain('Fermi bubbles');
    expect(far).toContain('Galactic bar');
    expect(far).not.toContain('Pleiades');
    expect(far.length).toBeLessThanOrEqual(48);
    const near = labels.select({ x: 0, y: 0, z: 0 }).map((o) => o.name);
    expect(near).toContain('Pleiades');
    expect(near).toContain('Hyades');
    // Switching a group off removes its labels.
    s.groups.clusters = false;
    expect(labels.select({ x: 0, y: 0, z: 0 }).map((o) => o.name)).not.toContain('Pleiades');
    // Structures centred on Sgr A* are labelled at different places.
    const anchors = ['long-bar', 'bulge', 'thin-disc', 'thick-disc', 'stellar-halo'].map((id) =>
      labelAnchor(atlas.get(`mw:structure:${id}`)!),
    );
    for (let i = 0; i < anchors.length; i++)
      for (let j = i + 1; j < anchors.length; j++)
        expect(
          Math.hypot(
            anchors[i][0] - anchors[j][0],
            anchors[i][1] - anchors[j][1],
            anchors[i][2] - anchors[j][2],
          ),
        ).toBeGreaterThan(1000);
  });

  it('has a style for every class in the data and a settings group for every style', () => {
    const classes = (raw as unknown as { classes: Record<string, unknown> }).classes;
    const groups = new Set(GROUPS.map((g) => g.id));
    for (const cls of new Set(atlas.objects.map((o) => o.cls))) {
      expect(classes[cls], cls).toBeDefined();
      expect(groups.has(styleOf(cls).group), cls).toBe(true);
    }
    expect(GROUPS.length).toBeLessThanOrEqual(8); // uGroup[8] in guides.glsl
  });

  it('finds famous objects by name and catalogue rows by designation', () => {
    const search = createAtlasSearch(atlas);
    const names = search.entries().map((e) => e.name);
    for (const n of [
      'Pleiades',
      'Crab Nebula',
      'Fermi bubbles',
      'Local Bubble',
      'Radcliffe Wave',
      'Perseus Arm',
      'GD-1',
      'Fornax',
    ])
      expect(names, n).toContain(n);
    expect(search.entries().length).toBeLessThan(2500);
    const ids = search.entries().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('mw:pulsars:j0534+2200'); // the Crab pulsar is famous: in the fuzzy index
    const minor = atlas.ofClass('pulsars').find((o) => o.rank === 0)!;
    const hits = search.query!(minor.name.slice(0, 9), 50);
    expect(hits.some((h) => h.id === minor.id)).toBe(true);
    expect(search.query!('ogle-blg-cep-06', 20).length).toBeGreaterThan(1);
    expect(search.query!('zz', 5)).toEqual([]);
  });

  it('flies to a view that looks at the object from a sensible distance', () => {
    for (const o of [
      byName('open-clusters', 'Pleiades'),
      atlas.get('mw:bubbles:fermi-bubbles')!,
      atlas.get('mw:local:local-bubble')!,
    ]) {
      const b = objectBookmark(o);
      const d = Math.hypot(b.pos.x / PC - o.x, b.pos.y / PC - o.y, b.pos.z / PC - o.z);
      expect(d).toBeGreaterThan(Math.max(o.r, 1));
      expect(Number.isFinite(b.quat!.w)).toBe(true);
    }
  });

  it('writes info cards whose every fact names its source', async () => {
    const info = createAtlasInfo(atlas);
    for (const o of atlas.objects
      .filter((_, i) => i % 97 === 0)
      .concat(atlas.objects.filter((x) => x.file.startsWith('features-')))) {
      const card = await info.info(o.id);
      expect(card, o.id).not.toBeNull();
      expect(card!.title).toBe(o.name);
      for (const f of card!.facts) {
        expect(f.source, `${o.id}: ${f.label}`).toBeTruthy();
        expect(f.source).not.toBe('unknown');
      }
    }
    const crab = await info.info('mw:remnants:g184.6-05.8');
    expect(crab!.facts.some((f) => /Distance/.test(f.label))).toBe(true);
    expect(await info.info('mw:nothing:here')).toBeNull();
  });

  it('registers atlas bookmarks with unique ids and switches guides on for the near ones', () => {
    const marks = atlasBookmarks();
    expect(new Set(marks.map((b) => b.id)).size).toBe(marks.length);
    for (const id of GUIDE_BOOKMARKS) expect(marks.some((b) => b.id === id)).toBe(true);
    for (const b of marks) expect(b.lookTarget!.length).toBeGreaterThan(40);
  });
});
