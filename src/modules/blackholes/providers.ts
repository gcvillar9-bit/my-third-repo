/**
 * Search entries, info cards and bookmarks for the black-hole catalogue, the S-stars and the
 * Cygnus X-1 companion.
 */
import type {
  Bookmark,
  InfoCard,
  InfoFact,
  InfoProvider,
  SearchEntry,
  SearchProvider,
} from '../../core/contracts';
import { qlookRotation, quat, v3cross, v3normalize, vec3 } from '../../core/math64';
import { AU, KM, formatDistance } from '../../core/units';
import { companionOrbit, companionPosition, shadowDiameterFromEarth, type Hole } from './catalog';
import { B_CRIT, PHOTON_SPHERE, R_ISCO } from './geodesic';
import { apoapsis, periapsis, skyBasis, sstarPosition, type SStarOrbit } from './sstars';

export const sstarBodyId = (id: string): string => `sgra-${id}`;
const MUAS = (180 / Math.PI) * 3600 * 1e6;

function massText(m: number): string {
  if (m >= 1e9) return `${(m / 1e9).toFixed(1)} billion`;
  if (m >= 1e6) return `${(m / 1e6).toFixed(2)} million`;
  return m.toFixed(1);
}

export function createSearch(holes: readonly Hole[], orbits: readonly SStarOrbit[]): SearchProvider {
  const entries: SearchEntry[] = [];
  for (const h of holes) {
    entries.push({
      id: h.id,
      name: h.row.name,
      aliases: h.row.aliases,
      subtitle: `Black hole, ${massText(h.row.massMsun)} solar masses`,
      kind: 'blackhole',
      target: h.id,
      priority: h.row.atMwOrigin ? 5 : 2,
    });
    const c = h.row.companion;
    if (c)
      entries.push({
        id: c.id,
        name: c.name,
        subtitle: `Supergiant companion of ${h.row.name}`,
        kind: 'star',
        target: c.id,
      });
  }
  for (const o of orbits)
    entries.push({
      id: sstarBodyId(o.row.id),
      name: o.row.name,
      aliases: o.row.id === 's2' ? ['S0-2', 'S2 star'] : [`${o.row.name} star`],
      subtitle: 'Star orbiting Sgr A*',
      kind: 'star',
      target: sstarBodyId(o.row.id),
    });
  return { id: 'blackholes.search', entries: () => entries };
}

function holeCard(h: Hole): InfoCard {
  const rsKm = h.rs / KM;
  const facts: InfoFact[] = [
    { label: 'Mass', value: massText(h.row.massMsun), unit: 'M☉', source: h.row.source },
    { label: 'Distance', value: formatDistance(h.distance) },
    {
      label: 'Schwarzschild radius',
      value: rsKm < 1e4 ? rsKm.toFixed(1) : rsKm.toExponential(3),
      unit: 'km',
    },
    { label: 'Photon sphere', value: (PHOTON_SPHERE * rsKm).toPrecision(4), unit: 'km' },
    { label: 'Innermost stable orbit', value: (R_ISCO * rsKm).toPrecision(4), unit: 'km' },
    {
      label: 'Shadow diameter from Earth',
      value: (shadowDiameterFromEarth(h) * MUAS).toPrecision(3),
      unit: 'μas',
      approximate: !h.row.atMwOrigin && h.id !== 'm87',
    },
    { label: 'Shadow radius', value: B_CRIT.toFixed(3), unit: 'r_s (3√3/2)' },
  ];
  const c = companionOrbit(h);
  if (c)
    facts.push({
      label: 'Companion',
      value: `${c.row.name}, ${c.row.periodDays.toFixed(2)} d orbit`,
      source: c.row.source,
    });
  return {
    title: h.row.name,
    subtitle: h.diskMode === 'none' ? 'Dormant black hole' : 'Black hole',
    facts,
    description: h.row.description,
    simulated: h.diskMode !== 'none',
    credit: h.row.source,
  };
}

function sstarCard(o: SStarOrbit): InfoCard {
  const arcmin = (o.dOmega * 180 * 60) / Math.PI;
  const nextPeri = o.row.tpYear + o.row.periodYr * Math.ceil((2026 - o.row.tpYear) / o.row.periodYr);
  return {
    title: o.row.name,
    subtitle: 'Star orbiting Sgr A*',
    facts: [
      {
        label: 'Orbital period',
        value: o.row.periodYr.toFixed(2),
        unit: 'yr',
        source: o.row.source,
        approximate: o.row.approximate,
      },
      { label: 'Eccentricity', value: o.row.e.toFixed(4), approximate: o.row.approximate },
      { label: 'Pericentre distance', value: (periapsis(o) / AU).toFixed(0), unit: 'AU' },
      { label: 'Apocentre distance', value: (apoapsis(o) / AU).toFixed(0), unit: 'AU' },
      { label: 'Last/next pericentre', value: `${o.row.tpYear.toFixed(2)} / ${nextPeri.toFixed(2)}` },
      { label: 'Schwarzschild precession', value: arcmin.toFixed(1), unit: 'arcmin per orbit' },
      { label: 'Absolute magnitude', value: o.row.absMagV.toFixed(1), unit: 'V', approximate: true },
    ],
    description:
      'One of the S-stars, whose orbits around Sgr A* weighed the black hole. The orbit precesses forwards because of general relativity (Schwarzschild precession).',
  };
}

export function createInfo(holes: readonly Hole[], orbits: readonly SStarOrbit[]): InfoProvider {
  return {
    id: 'blackholes.info',
    info(id: string): InfoCard | null {
      const h = holes.find((x) => x.id === id);
      if (h) return holeCard(h);
      const o = orbits.find((x) => sstarBodyId(x.row.id) === id);
      if (o) return sstarCard(o);
      const host = holes.find((x) => x.row.companion?.id === id);
      const c = host && companionOrbit(host);
      if (host && c)
        return {
          title: c.row.name,
          subtitle: `O9.7 Iab supergiant, companion of ${host.row.name}`,
          facts: [
            { label: 'Mass', value: c.row.massMsun, unit: 'M☉', source: c.row.source },
            { label: 'Radius', value: c.row.radiusRsun, unit: 'R☉', approximate: true },
            { label: 'Temperature', value: c.row.teffK, unit: 'K', approximate: true },
            { label: 'Orbital period', value: c.row.periodDays, unit: 'd' },
            { label: 'Separation', value: (c.a / AU).toFixed(3), unit: 'AU' },
          ],
          description: 'Its strong stellar wind feeds the black hole; the stream drawn here is illustrative.',
        };
      return null;
    },
  };
}

/** Camera quaternion looking along `fwd` with `up` (frame axes = world axes for hole frames). */
const look = (fwd: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }) =>
  qlookRotation(quat(), fwd, up);

export function buildBookmarks(holes: readonly Hole[], orbits: readonly SStarOrbit[]): Bookmark[] {
  const out: Bookmark[] = [];
  const by = (id: string) => holes.find((h) => h.id === id);
  const sgra = by('sgra');
  if (sgra) {
    const n = sgra.diskNormal;
    const p = sgra.diskA;
    const inc = (78 * Math.PI) / 180;
    const c = vec3(
      Math.cos(inc) * n.x + Math.sin(inc) * p.x,
      Math.cos(inc) * n.y + Math.sin(inc) * p.y,
      Math.cos(inc) * n.z + Math.sin(inc) * p.z,
    );
    const D = 26 * sgra.rs;
    out.push({
      id: 'sgra-lensing',
      title: 'Sgr A*: lensing and accretion disk',
      frame: sgra.frame,
      pos: vec3(c.x * D, c.y * D, c.z * D),
      quat: look(vec3(-c.x, -c.y, -c.z), n),
      lookAt: 'sgra',
      fovY: (60 * Math.PI) / 180,
      ev: 11,
      lookTarget:
        'Black shadow at the centre ringed by a thin bright photon ring; the disk crosses in front, its far side lensed over the top and under the bottom; the approaching (left or right) side is brighter and bluer.',
    });
    const s2 = orbits.find((o) => o.row.id === 's2');
    if (s2) {
      const b = skyBasis(sgra.row.raDeg, sgra.row.decDeg);
      const p0 = sstarPosition(s2, b, s2.tpJd, vec3(), 0, (s2.row.omegaDeg * Math.PI) / 180);
      const p1 = sstarPosition(s2, b, s2.tpJd, vec3(), Math.PI / 2, (s2.row.omegaDeg * Math.PI) / 180);
      const nu = v3normalize(vec3(), v3cross(vec3(), p0, p1));
      const D = 3200 * AU;
      out.push({
        id: 'sgra-s2-periapsis',
        title: 'S2 at pericentre (2018 May 19)',
        frame: sgra.frame,
        pos: vec3(nu.x * D, nu.y * D, nu.z * D),
        quat: look(vec3(-nu.x, -nu.y, -nu.z), b.n),
        lookAt: 'sgra',
        jd: 2458257.5008,
        fovY: (70 * Math.PI) / 180,
        rate: 2.6e6,
        ev: 16,
        lookTarget:
          'The S-star orbits seen face-on to S2; S2 is the bright star right next to Sgr A* at pericentre.',
      });
    }
  }
  const m87 = by('m87');
  if (m87) {
    const u = m87.skyDir;
    const D = 60 * m87.rs;
    out.push({
      id: 'm87-shadow',
      title: 'M87*: the shadow seen from Earth’s direction',
      frame: m87.frame,
      pos: vec3(-u.x * D, -u.y * D, -u.z * D),
      quat: look(u, skyBasis(m87.row.raDeg, m87.row.decDeg).n),
      lookAt: 'm87',
      fovY: (40 * Math.PI) / 180,
      ev: 11,
      lookTarget:
        'A nearly face-on bright ring around a dark shadow, brighter on one side (Doppler beaming), like the EHT image.',
    });
  }
  const bh3 = by('gaiabh3');
  if (bh3) {
    const u = bh3.skyDir;
    const D = 40 * bh3.rs;
    out.push({
      id: 'gaia-bh3-dormant',
      title: 'Gaia BH3: a dormant black hole lensing the stars',
      frame: bh3.frame,
      pos: vec3(u.x * D, u.y * D, u.z * D),
      quat: look(vec3(-u.x, -u.y, -u.z), skyBasis(bh3.row.raDeg, bh3.row.decDeg).n),
      lookAt: 'gaiabh3',
      fovY: (60 * Math.PI) / 180,
      ev: -8,
      lookTarget:
        'A black disk in front of the Sun’s stellar neighbourhood; stars near it are smeared into arcs and an Einstein ring.',
    });
  }
  const cyg = by('cygx1');
  const orbit = cyg && companionOrbit(cyg);
  if (cyg && orbit) {
    // Quarter phase (companion beside the hole as seen from Earth) nearest to 2026.0.
    const n0 = Math.floor((2461041.5 - orbit.row.t0Jd) / orbit.row.periodDays);
    const jd = orbit.row.t0Jd + (n0 + 0.25) * orbit.row.periodDays;
    const comp = companionPosition(orbit, jd, vec3());
    const ch = v3normalize(vec3(), comp);
    const side = v3normalize(vec3(), v3cross(vec3(), orbit.n, ch));
    const a = orbit.a;
    const el = (32 * Math.PI) / 180;
    const target = vec3(0.3 * a * ch.x, 0.3 * a * ch.y, 0.3 * a * ch.z);
    const R = 1.75 * a;
    const pos = vec3(
      target.x + R * (Math.cos(el) * side.x + Math.sin(el) * orbit.n.x),
      target.y + R * (Math.cos(el) * side.y + Math.sin(el) * orbit.n.y),
      target.z + R * (Math.cos(el) * side.z + Math.sin(el) * orbit.n.z),
    );
    out.push({
      id: 'cygx1-disk',
      title: 'Cygnus X-1: supergiant, stream and disk',
      frame: cyg.frame,
      pos,
      quat: look(vec3(target.x - pos.x, target.y - pos.y, target.z - pos.z), orbit.n),
      lookAt: 'cygx1',
      jd,
      fovY: (60 * Math.PI) / 180,
      ev: 0, // replaced in index.ts from the companion's surface luminance
      lookTarget:
        'The blue supergiant HDE 226868 on one side, a gas stream spiralling from it into a glowing disk around the black hole.',
    });
  }
  return out;
}
