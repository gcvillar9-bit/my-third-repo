/**
 * largescale places (pure TS): bookmarks 'great-attractor' and 'laniakea', search entries, info cards and
 * labels for the Great Attractor, the Norma Cluster, the Shapley Supercluster, Laniakea and the Local
 * Group's motion relative to the CMB. Everything lives in ROOT_FRAME ('universe', supergalactic axes).
 */
import {
  ROOT_FRAME,
  type Bookmark,
  type InfoCard,
  type InfoFact,
  type LabelItem,
  type LabelSource,
  type SearchEntry,
  type Vec3d,
} from '../../core/contracts';
import { qlookRotation, quat, v3cross, v3dot, v3len, v3normalize, vec3 } from '../../core/math64';
import { MPC } from '../../core/units';
import {
  GA_POS,
  KMS_PER_UNIT,
  LANIAKEA,
  MW_FLOW,
  NORMA_POS,
  row,
  SHAPLEY_POS,
  shellPoint,
  streamlineEnd,
  universeToGalacticLB,
} from './model';

export const GA_BOOKMARK = 'great-attractor';
export const LANIAKEA_BOOKMARK = 'laniakea';
export const IDS = {
  ga: 'ls:great-attractor',
  norma: 'ls:norma',
  shapley: 'ls:shapley',
  laniakea: 'ls:laniakea',
  lg: 'ls:lg-motion',
} as const;
/** Layer fade with the camera's distance from the Milky Way, Mpc. */
export const FADE_START = 20;
export const FADE_END = 40;
const DEG = Math.PI / 180;
const MLY_PER_MPC = 3.2616;
const [e1, e2, e3] = LANIAKEA.axes;

const add = (a: Vec3d, s: number, b: Vec3d) => vec3(a.x + s * b.x, a.y + s * b.y, a.z + s * b.z);
const unit = (x: number, y: number, z: number) => v3normalize(vec3(), vec3(x, y, z));
const comb = (a: number, b: number, c: number) =>
  unit(a * e1.x + b * e2.x + c * e3.x, a * e1.y + b * e2.y + c * e3.y, a * e1.z + b * e2.z + c * e3.z);

/** Camera `dist` Mpc from `target` (Mpc) along `dir`, looking back at it with `right` horizontal. */
function view(
  id: string,
  title: string,
  target: Vec3d,
  dir: Vec3d,
  dist: number,
  right: Vec3d,
  fovDeg: number,
  ev: number,
  lookTarget: string,
): Bookmark {
  const p = add(target, dist, dir);
  const f = vec3(-dir.x, -dir.y, -dir.z);
  const d = v3dot(right, f);
  const r = unit(right.x - d * f.x, right.y - d * f.y, right.z - d * f.z);
  const up = v3cross(vec3(), r, f);
  return {
    id,
    title,
    frame: ROOT_FRAME,
    pos: vec3(p.x * MPC, p.y * MPC, p.z * MPC),
    quat: qlookRotation(quat(), f, up),
    fovY: fovDeg * DEG,
    ev,
    lookTarget,
  };
}

export function largescaleBookmarks(): Bookmark[] {
  return [
    view(
      GA_BOOKMARK,
      'The Great Attractor and the cosmic flow',
      vec3(GA_POS.x * 0.55, GA_POS.y * 0.55, GA_POS.z * 0.55),
      comb(-0.25, 0.45, 0.85),
      150,
      e1,
      60,
      -16,
      'From ~150 Mpc above the supergalactic plane: hundreds of blue-to-gold flow lines with moving dashes converging on a bright knot (the Great Attractor, right), the green "Our path" line from the Milky Way marker (left), inside a faint golden Laniakea outline.',
    ),
    view(
      LANIAKEA_BOOKMARK,
      'Laniakea, our home supercluster',
      LANIAKEA.centre,
      comb(-0.35, -0.55, 0.75),
      230,
      e1,
      50,
      -16.5,
      'The whole Laniakea outline (a faint lumpy golden shell with contour slices, ~160 Mpc across) with the flow lines converging inside it on the Great Attractor; Shapley labelled beyond it.',
    ),
  ];
}

/** A look at a structure from `dist` Mpc on the Milky Way's side, slightly above (search targets). */
function approach(id: string, title: string, target: Vec3d, dist: number): Bookmark {
  const d = v3normalize(vec3(), target);
  const dir = unit(-0.75 * d.x + 0.66 * e3.x, -0.75 * d.y + 0.66 * e3.y, -0.75 * d.z + 0.66 * e3.z);
  return view(id, title, target, dir, dist, e2, 60, -16, title);
}

export function largescaleSearch(bookmarks: Bookmark[]): SearchEntry[] {
  const [ga, lan] = bookmarks;
  return [
    {
      id: IDS.ga,
      name: 'Great Attractor',
      aliases: ['GA', 'Norma–Hydra–Centaurus', 'Cosmic flow'],
      subtitle: 'Gravitational focus of Laniakea, ~250 Mly',
      kind: 'other',
      target: ga,
      priority: 2,
    },
    {
      id: IDS.norma,
      name: 'Norma Cluster',
      aliases: ['Abell 3627', 'ACO 3627'],
      subtitle: 'Galaxy cluster at the heart of the Great Attractor',
      kind: 'other',
      target: approach('ls-norma', 'Norma Cluster', NORMA_POS, 30),
    },
    {
      id: IDS.shapley,
      name: 'Shapley Supercluster',
      aliases: ['Shapley Concentration', 'SCL 124'],
      subtitle: 'Largest concentration of galaxies within ~1 Gly',
      kind: 'other',
      target: approach('ls-shapley', 'Shapley Supercluster', SHAPLEY_POS, 110),
    },
    {
      id: IDS.laniakea,
      name: 'Laniakea Supercluster',
      aliases: ['Laniakea', 'Local Supercluster', 'Home supercluster'],
      subtitle: 'Our home supercluster, ~520 Mly across',
      kind: 'other',
      target: lan,
      priority: 2,
    },
    {
      id: IDS.lg,
      name: 'Local Group motion (CMB dipole)',
      aliases: ['CMB dipole', '627 km/s', 'Peculiar velocity'],
      subtitle: 'The Milky Way moves at ~627 km/s relative to the CMB',
      kind: 'other',
      target: ga,
    },
  ];
}

const fact = (label: string, value: string | number, unit?: string, source?: string): InfoFact => ({
  label,
  value,
  unit,
  approximate: true,
  source,
});
const mly = (mpc: number) => Math.round((mpc * MLY_PER_MPC) / 10) * 10;
const sci = (v: number) => v.toExponential(0).replace('e+', 'e');

export function largescaleInfo(id: string): InfoCard | null {
  switch (id) {
    case IDS.ga: {
      const r = row('great-attractor');
      return {
        title: 'Great Attractor',
        subtitle: 'Gravitational focus of the local cosmic flow',
        facts: [
          fact('Distance', mly(r.distMpc!), 'Mly', r.source),
          fact('Distance', r.distMpc!, 'Mpc'),
          fact('Recession velocity', r.czKms!, 'km/s'),
          fact('Direction (galactic)', `l ${r.l}°, b ${r.b}°`),
          fact('Mass (order of magnitude)', sci(r.massMsun!), 'M☉'),
        ],
        description:
          'Galaxies over hundreds of millions of light-years, the Milky Way included, are drifting toward this region. It lies behind the Milky Way’s own disc, in the Zone of Avoidance, so dust and stars hide most of it; X-ray and radio surveys found the Norma Cluster at its heart. The flow lines here are a toy model (softened pulls of the Great Attractor, Shapley and Virgo), not measured velocities.',
        credit: `${r.source}.`,
      };
    }
    case IDS.norma: {
      const r = row('norma');
      return {
        title: 'Norma Cluster (Abell 3627)',
        subtitle: 'Rich galaxy cluster in the Great Attractor region',
        facts: [
          fact('Distance', mly(r.distMpc!), 'Mly'),
          fact('Distance', r.distMpc!, 'Mpc'),
          fact('Recession velocity', r.czKms!, 'km/s'),
          fact('Mass', sci(r.massMsun!), 'M☉'),
          fact('Direction (galactic)', `l ${r.l}°, b ${r.b}°`),
        ],
        description:
          'A massive cluster only 7° below the Galactic plane, discovered in 1996 behind the Milky Way’s dust. It is thought to be the core of the Great Attractor.',
        credit: `${r.source}.`,
      };
    }
    case IDS.shapley: {
      const r = row('shapley');
      return {
        title: 'Shapley Supercluster',
        subtitle: 'The largest concentration of galaxies within ~1 billion light-years',
        facts: [
          fact('Distance', mly(r.distMpc!), 'Mly'),
          fact('Distance', r.distMpc!, 'Mpc'),
          fact('Redshift', r.z!),
          fact('Mass', sci(r.massMsun!), 'M☉'),
        ],
        description:
          'Beyond the Great Attractor, in nearly the same direction, lies this huge collection of rich clusters. It lies outside Laniakea but its pull adds to the Local Group’s motion.',
        credit: `${r.source}.`,
      };
    }
    case IDS.laniakea: {
      const r = row('laniakea');
      return {
        title: 'Laniakea Supercluster',
        subtitle: 'Our home supercluster: “immeasurable heaven” in Hawaiian',
        facts: [
          fact('Diameter', r.diameterMly!, 'Mly', r.source),
          fact('Diameter', r.diameterMpc!, 'Mpc'),
          fact('Galaxies', '~100,000'),
          fact('Mass', sci(r.massMsun!), 'M☉'),
        ],
        description:
          'Defined in 2014 by Tully, Courtois, Hoffman and Pomarède from the motions of 8,000 galaxies: the region whose galaxies all flow toward the Great Attractor. It contains the Virgo, Hydra–Centaurus and Pavo–Indus superclusters and the Milky Way near its edge. The outline shown is a stylised, approximate shape (after Tully et al. 2014), not the measured boundary.',
        simulated: true,
        credit: `${r.source}.`,
      };
    }
    case IDS.lg: {
      const r = row('lg-motion');
      const m = universeToGalacticLB(MW_FLOW);
      return {
        title: 'Local Group motion relative to the CMB',
        subtitle: 'Our peculiar velocity, seen as the cosmic microwave background dipole',
        facts: [
          fact('Speed', `${r.speedKms} ± ${r.speedErrKms}`, 'km/s', r.source),
          fact('Direction (galactic)', `l ${r.l}°, b ${r.b}°`),
          fact('Toy-model flow direction', `l ${Math.round(m.l)}°, b ${Math.round(m.b)}°`),
          fact('Toy-model speed (calibrated)', Math.round(v3len(MW_FLOW) * KMS_PER_UNIT), 'km/s'),
        ],
        description:
          'The CMB looks slightly hotter in one direction because the Milky Way and its neighbours move through it at ~627 km/s, pulled mostly by the Great Attractor and the Shapley Supercluster (and Virgo nearby). The flow lines show a toy model calibrated to this speed.',
        credit: `${r.source}.`,
      };
    }
    default:
      return null;
  }
}

/** Labels once the camera is far enough out for each structure to make sense. */
export function largescaleLabels(on: () => boolean): LabelSource {
  const mk = (id: string, text: string, p: Vec3d, priority: number, color: string): LabelItem => ({
    id,
    text,
    frame: ROOT_FRAME,
    local: vec3(p.x * MPC, p.y * MPC, p.z * MPC),
    priority,
    color,
    target: id,
  });
  const ga = mk(IDS.ga, 'Great Attractor', GA_POS, 60, '#ffd28a');
  const norma = mk(IDS.norma, 'Norma Cluster', NORMA_POS, 30, '#ffe3b8');
  const shapley = mk(IDS.shapley, 'Shapley Supercluster', SHAPLEY_POS, 50, '#ffd28a');
  const lan = mk(IDS.laniakea, 'Laniakea Supercluster', shellPoint(0, 0, 1, 1), 55, '#f3c77c');
  // 'Our path': ~24 Mpc down the Milky Way's streamline (the green line).
  const path = mk(IDS.lg, 'Our path', streamlineEnd(vec3(), 12), 40, '#73f08c');
  const zero = vec3();
  const t = vec3();
  return {
    id: 'largescale.labels',
    labels(viewState, out) {
      if (!on()) return;
      const d = v3len(viewState.toCamera(ROOT_FRAME, zero, t)) / MPC;
      if (d < FADE_START + 5) return;
      out.push(ga, lan, path);
      if (d < 260) out.push(norma);
      if (d > 45) out.push(shapley);
    },
  };
}
