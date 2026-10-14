/**
 * The ten named galaxies (generated src/modules/galaxies/named.json, from the catalogue): bookmarks,
 * search entries, info cards and labels. Bookmarks live in the `universe` frame (supergalactic axes,
 * origin Milky Way centre) so they work before galaxies.bin has loaded.
 */
import {
  ROOT_FRAME,
  type Bookmark,
  type InfoCard,
  type InfoProvider,
  type LabelItem,
  type LabelSource,
  type SearchEntry,
  type SearchProvider,
  type Vec3d,
} from '../../core/contracts';
import { qlookRotation, qrotate, quat, v3cross, v3len, v3normalize, vec3 } from '../../core/math64';
import { KPC, LY, MPC } from '../../core/units';
import namedJson from './named.json';

export interface NamedGalaxy {
  id: string;
  title: string;
  aliases: string[];
  subtitle: string;
  /** Row in galaxies.bin. */
  index: number;
  type: string;
  /** Universe-frame position, Mpc. */
  pos: [number, number, number];
  distSunMpc: number;
  radiusKpc: number;
  absMag: number;
  quat: [number, number, number, number];
  source: string;
}

export const NAMED: readonly NamedGalaxy[] = (namedJson as unknown as { galaxies: NamedGalaxy[] }).galaxies;
const DEG = Math.PI / 180;
const SOURCE = 'CelestiaContent galaxies.dsc (NGC/IC, RC3, NED-1D)';
export const galaxyId = (g: NamedGalaxy): string => `gal:${g.id}`;
export const named = (id: string): NamedGalaxy => {
  const g = NAMED.find((x) => x.id === id);
  if (!g) throw new Error(`galaxies: unknown named galaxy ${id}`);
  return g;
};

const posM = (g: NamedGalaxy): Vec3d => vec3(g.pos[0] * MPC, g.pos[1] * MPC, g.pos[2] * MPC);
/** Disc normal (local +z) in universe axes. */
export function discNormal(g: NamedGalaxy): Vec3d {
  const [x, y, z, w] = g.quat;
  return qrotate(vec3(), { x, y, z, w }, vec3(0, 0, 1));
}

/**
 * Camera `dist` (m) from galaxy g, on the line from `from` (universe, m), looking at it with the disc's
 * major axis horizontal (up = projected disc normal).
 */
export function approachBookmark(
  g: NamedGalaxy,
  id: string,
  dist: number,
  fovY: number,
  from: Vec3d = vec3(),
): Bookmark {
  const c = posM(g);
  const fwd = v3normalize(vec3(), vec3(c.x - from.x, c.y - from.y, c.z - from.z));
  const n = discNormal(g);
  const k = n.x * fwd.x + n.y * fwd.y + n.z * fwd.z;
  let up = vec3(n.x - k * fwd.x, n.y - k * fwd.y, n.z - k * fwd.z);
  if (v3len(up) < 1e-3) up = vec3(0, 0, 1);
  return {
    id,
    title: g.title,
    frame: ROOT_FRAME,
    pos: vec3(c.x - fwd.x * dist, c.y - fwd.y * dist, c.z - fwd.z * dist),
    quat: qlookRotation(quat(), fwd, up),
    fovY,
  };
}

/** Distance at which a galaxy of radius r spans `frac` of a horizontal field of view hfov. */
export const fillDistance = (r: number, frac: number, hfov: number): number =>
  r / Math.tan((frac * hfov) / 2);

/** Horizontal field of view at 16:9 for vertical fovY. */
const hfov169 = (fovY: number) => 2 * Math.atan(Math.tan(fovY / 2) * (16 / 9));

export const M31_EV = -12;
export const LOCAL_GROUP_EV = -12;
export const VIRGO_EV = -15;

export function galaxyBookmarks(): Bookmark[] {
  const m31 = named('m31');
  const fov = 30 * DEG;
  const approach: Bookmark = {
    ...approachBookmark(m31, 'm31-approach', fillDistance(m31.radiusKpc * KPC, 1 / 3, hfov169(fov)), fov),
    title: 'Approaching Andromeda (M31)',
    ev: M31_EV,
    lookTarget:
      'The Andromeda Galaxy at the centre, seen from the Milky Way side ~150 kpc out: a bright yellowish bulge in a strongly inclined (77 deg) spiral disc spanning about a third of the view, major axis horizontal; faint background galaxies as points.',
  };
  // Local Group: look down the supergalactic pole at the midpoint of the Milky Way-M31 line.
  const c31 = posM(m31);
  const mid = vec3(c31.x * 0.45, c31.y * 0.45, c31.z * 0.45);
  const line = v3normalize(vec3(), c31);
  const side = v3normalize(vec3(), v3cross(vec3(), line, vec3(0, 0, 1)));
  const lgFwd = v3normalize(vec3(), vec3(-0.4 * side.x, -0.4 * side.y, -0.4 * side.z - 1));
  const lgDist = 1.3 * MPC;
  const local: Bookmark = {
    id: 'local-group',
    title: 'The Local Group',
    frame: ROOT_FRAME,
    pos: vec3(mid.x - lgFwd.x * lgDist, mid.y - lgFwd.y * lgDist, mid.z - lgFwd.z * lgDist),
    quat: qlookRotation(quat(), lgFwd, side),
    fovY: 50 * DEG,
    ev: LOCAL_GROUP_EV,
    lookTarget:
      'The Local Group from 1.3 Mpc above the supergalactic plane: the Milky Way with the Magellanic Clouds beside it on one side, Andromeda and Triangulum on the other, ~0.8 Mpc apart.',
  };
  const m87 = named('m87');
  const virgo: Bookmark = {
    ...approachBookmark(m87, 'virgo-cluster', 5 * MPC, 50 * DEG),
    title: 'The Virgo Cluster',
    ev: VIRGO_EV,
    lookTarget:
      'The Virgo Cluster (~16.5 Mpc away) seen from 5 Mpc: hundreds of galaxy points concentrated around the giant elliptical M87 at the centre.',
  };
  return [approach, local, virgo];
}

/** Search bookmark: the galaxy filling ~half the view, seen from the Milky Way side. */
export function namedBookmark(g: NamedGalaxy): Bookmark {
  const fov = 40 * DEG;
  return {
    ...approachBookmark(g, `galaxy:${g.id}`, fillDistance(g.radiusKpc * KPC, 0.5, hfov169(fov)), fov),
    lookTarget: `${g.title} at the centre of the view.`,
  };
}

export function createNamedSearch(): SearchProvider {
  const entries: SearchEntry[] = NAMED.map((g) => ({
    id: galaxyId(g),
    name: g.title,
    aliases: g.aliases,
    subtitle: g.subtitle,
    kind: 'galaxy',
    target: namedBookmark(g),
    priority: 2,
  }));
  return { id: 'galaxies.named', entries: () => entries };
}

/** Facts shared by named and catalogue galaxies. */
export function galaxyFacts(distSunMpc: number, type: string, radiusKpc: number, absMag: number) {
  const ly = (distSunMpc * MPC) / LY;
  const r3 = (v: number) => Number(v.toPrecision(3));
  return [
    { label: 'Distance', value: r3(ly / 1e6), unit: 'Mly', source: SOURCE },
    { label: 'Distance', value: r3(distSunMpc), unit: 'Mpc', source: SOURCE },
    { label: 'Light-travel time', value: r3(ly / 1e6), unit: 'million years', source: SOURCE },
    { label: 'Hubble type', value: type, source: SOURCE },
    {
      label: 'Diameter',
      value: r3((2 * radiusKpc * KPC) / LY / 1e3),
      unit: 'kly',
      approximate: true,
      source: SOURCE,
    },
    { label: 'Absolute magnitude (B)', value: absMag, source: SOURCE },
  ];
}

export function createNamedInfo(): InfoProvider {
  return {
    id: 'galaxies.named',
    info(id): InfoCard | null {
      const g = NAMED.find((x) => galaxyId(x) === id);
      if (!g) return null;
      const myr = Number(((g.distSunMpc * MPC) / LY / 1e6).toPrecision(3));
      return {
        title: g.title,
        subtitle: g.subtitle,
        facts: galaxyFacts(g.distSunMpc, g.type, g.radiusKpc, g.absMag),
        description: `The light we see from ${g.title} left it about ${myr} million years ago.`,
        simulated: true,
        credit:
          'Position, size, type and brightness from the catalogue; the image is a procedural morphology impostor.',
      };
    },
  };
}

/** Labels for the named galaxies once the camera has left the Milky Way's neighbourhood. */
export function createNamedLabels(visible: () => boolean): LabelSource {
  const items: LabelItem[] = NAMED.map((g) => ({
    id: galaxyId(g),
    text: g.title,
    frame: ROOT_FRAME,
    local: posM(g),
    priority: 5,
    radius: g.radiusKpc * KPC,
    color: '#c9d7ff',
    target: galaxyId(g),
  }));
  const zero = vec3();
  const t = vec3();
  return {
    id: 'galaxies.named',
    labels(view, out: LabelItem[]) {
      if (!visible() || v3len(view.toCamera(ROOT_FRAME, zero, t)) < 30 * KPC) return;
      for (const item of items) out.push(item);
    },
  };
}
