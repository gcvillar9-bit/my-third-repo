/**
 * exoplanets (P4-C): Open Exoplanet Catalogue systems. The nearest system within PROMOTE_PC of the camera
 * is activated: its host is promoted through starsystems (HYG star or a custom star), each planet gets a
 * Float64 frame on a Kepler orbit, a Body and a class-tinted "artist's impression" SurfaceShading, and the
 * 'exoplanets.system' overlay draws orbits, the habitable zone and planet markers. Everything else costs a
 * distance scan over ~4000 positions every 8 frames.
 */
import {
  SSB_FRAME,
  type Bookmark,
  type InfoCard,
  type ModuleContext,
  type UniverseModule,
  type Vec3d,
} from '../../core/contracts';
import { qlookRotation, quat, vec3 } from '../../core/math64';
import { AU, PC, R_SUN } from '../../core/units';
import { starCatalog, yearsSinceJ2000, type StarCatalog } from '../stars/public';
import {
  deg,
  hashPhase,
  orbitNormal,
  orbitOffset,
  PROMOTE_PC,
  RELEASE_PC,
  skyBasis,
  starSystems,
  type Elements,
  type SkyBasis,
  type StarSystemsApi,
} from '../starsystems/public';
import { diskLuminance } from '../sun/public';
import { CLASS_STYLE, R_EARTH } from './classify';
import {
  hostOf,
  planetsOf,
  SYSTEMS_PATH,
  type Host,
  type Planet,
  type SystemRow,
  type SystemsFile,
} from './data';
import { BOOKMARK_JD, EXOPLANET_BOOKMARKS } from './public';
import { createSystemOverlay, MAX_PLANETS, planetShading } from './render';

const OWNER = 'exoplanets';
const SCAN_EVERY = 8;
const NORTH = vec3(0, 0, 1);

interface Active {
  sys: SystemRow;
  host: Host;
  hostFrame: string;
  hostBody: string;
  planets: Planet[];
  basis: SkyBasis;
}

function systemDirPc(s: SystemRow): Vec3d | null {
  if (s.ra == null || s.dec == null || !s.dist) return null;
  const a = deg(s.ra);
  const d = deg(s.dec);
  return vec3(Math.cos(d) * Math.cos(a) * s.dist, Math.cos(d) * Math.sin(a) * s.dist, Math.sin(d) * s.dist);
}

function elementsOf(p: Planet): Elements {
  return {
    a: p.aAU * AU,
    e: p.e,
    i: deg(p.inclDeg),
    node: 0,
    peri: 0,
    periodYr: p.periodDays / 365.25,
    m0: hashPhase(p.id),
  };
}

const fmt = (v: number, digits = 3) => +v.toPrecision(digits);

const exoplanets: UniverseModule = {
  id: 'exoplanets',
  dependsOn: ['stars', 'starsystems', 'sun'],
  async init(ctx: ModuleContext) {
    const { registry, render, frames } = ctx;
    const [cat, api, file] = await Promise.all([
      starCatalog(),
      starSystems(),
      ctx.assets.track(ctx.assets.json<SystemsFile>(SYSTEMS_PATH), 'exoplanets.systems'),
    ]);
    const systems = file.systems;
    const byId = new Map(systems.map((s) => [s.id, s]));
    const hygHost = (s: SystemRow) =>
      s.star >= 0 ? { absMag: cat.data.absMag[s.star], teff: cat.teff(s.star) } : undefined;

    // J2000 positions (pc) and velocities (pc/yr) for the proximity scan; NaN = not placeable.
    const pos = new Float64Array(3 * systems.length).fill(NaN);
    const vel = new Float64Array(3 * systems.length);
    const t0 = vec3();
    const t1 = vec3();
    systems.forEach((s, k) => {
      if (s.star >= 0) {
        api.starPositionPc(s.star, 0, t0);
        api.starPositionPc(s.star, 1e4, t1);
        pos.set([t0.x, t0.y, t0.z], 3 * k);
        vel.set([(t1.x - t0.x) / 1e4, (t1.y - t0.y) / 1e4, (t1.z - t0.z) / 1e4], 3 * k);
      } else {
        const p = systemDirPc(s);
        if (p) pos.set([p.x, p.y, p.z], 3 * k);
      }
    });
    const systemPc = (k: number, years: number, out: Vec3d): Vec3d =>
      vec3set(
        out,
        pos[3 * k] + vel[3 * k] * years,
        pos[3 * k + 1] + vel[3 * k + 1] * years,
        pos[3 * k + 2] + vel[3 * k + 2] * years,
      );

    const overlay = createSystemOverlay();
    registry.addRenderable(overlay);
    registry.addSetting({
      id: 'exoplanets.orbits',
      label: 'Exoplanet orbits and habitable zone',
      group: 'Sky',
      type: 'boolean',
      default: true,
      persist: true,
      onChange: (v) => void (overlay.orbitsOn = v === true),
    });

    let active: Active | null = null;
    let activeIdx = -1;
    const shaded = new Set<string>();

    const activate = (k: number, years: number) => {
      const sys = systems[k];
      const host = hostOf(sys, hygHost(sys));
      const centre = systemPc(k, years, vec3());
      let hostFrame: string | null;
      let hostBody: string;
      if (sys.star >= 0) {
        hostFrame = api.promoteStar(sys.star, OWNER);
        hostBody = cat.idOf(sys.star);
      } else {
        hostBody = `exo:${sys.id}`;
        hostFrame = api.promoteCustom(
          {
            id: hostBody,
            name: sys.name,
            teff: host.teff,
            radius: host.radiusRsun * R_SUN,
            absMag: host.absMagV,
            massMsun: host.massMsun,
            positionPc: systemPc(k, 0, vec3()),
            source: 'Open Exoplanet Catalogue host parameters',
          },
          OWNER,
        );
      }
      if (!hostFrame) return;
      const d = Math.hypot(centre.x, centre.y, centre.z) || 1;
      const basis = skyBasis(vec3(centre.x / d, centre.y / d, centre.z / d));
      const planets = planetsOf(sys, host).slice(0, MAX_PLANETS);
      const hostInfo = { frame: hostFrame, absMagV: host.absMagV, teff: host.teff };
      for (const p of planets) {
        const el = elementsOf(p);
        if (!frames.has(p.id))
          registry.addFrame({
            id: p.id,
            parent: hostFrame,
            influenceRadius: Math.max(60 * p.rEarth * R_EARTH, 1e8),
            positionAt: (jd, out) => orbitOffset(el, basis, jd, out),
          });
        registry.addBody({
          id: p.id,
          name: p.name,
          kind: 'planet',
          frame: p.id,
          parent: hostBody,
          radius: p.rEarth * R_EARTH,
          influenceRadius: Math.max(60 * p.rEarth * R_EARTH, 1e8),
          simulated: true,
          labelPriority: 35,
        });
        if (!shaded.has(p.id)) {
          shaded.add(p.id);
          const id = p.id;
          registry.setSurfaceShading(
            planetShading(id, id, p.cls, () =>
              active && active.planets.some((q) => q.id === id) ? hostInfo : null,
            ),
          );
        }
      }
      active = { sys, host, hostFrame, hostBody, planets, basis };
      activeIdx = k;
      overlay.show({
        frame: hostFrame,
        basis,
        planets: planets.map((p) => ({ el: elementsOf(p), cls: p.cls })),
        hz: host.hz,
      });
    };

    const deactivate = () => {
      if (!active) return;
      for (const p of active.planets) if (registry.body(p.id)) registry.removeBody(p.id);
      api.release(OWNER);
      overlay.show(null);
      active = null;
      activeIdx = -1;
    };

    const zero = vec3();
    const toSun = vec3();
    const cam = vec3();
    const tmp = vec3();
    render.onBeforeFrame((view) => {
      if (view.frameIndex % SCAN_EVERY !== 0 && !view.test) return;
      view.toCamera(SSB_FRAME, zero, toSun);
      vec3set(cam, -toSun.x / PC, -toSun.y / PC, -toSun.z / PC);
      const years = yearsSinceJ2000(view.jd);
      if (active) {
        systemPc(activeIdx, years, tmp);
        if (Math.hypot(tmp.x - cam.x, tmp.y - cam.y, tmp.z - cam.z) <= RELEASE_PC) return;
        deactivate();
      }
      let best = -1;
      let bestD = PROMOTE_PC;
      for (let k = 0; k < systems.length; k++) {
        const dx = pos[3 * k] + vel[3 * k] * years - cam.x;
        if (!(Math.abs(dx) < bestD)) continue;
        systemPc(k, years, tmp);
        const d = Math.hypot(tmp.x - cam.x, tmp.y - cam.y, tmp.z - cam.z);
        if (d < bestD) {
          best = k;
          bestD = d;
        }
      }
      if (best >= 0) activate(best, years);
    });

    registry.addSearch({ id: 'exoplanets', entries: () => searchEntries });
    const searchEntries = systems.flatMap((s, k) => {
      if (Number.isNaN(pos[3 * k])) return [];
      const p = systemPc(k, 0, vec3());
      const d = Math.hypot(p.x, p.y, p.z);
      const standoff = 0.005; // pc: proper motion since J2000 stays small against this
      const look = vec3(p.x / d, p.y / d, p.z / d);
      const b: Bookmark = {
        id: `exosys-${s.id}`,
        title: s.name,
        frame: SSB_FRAME,
        pos: vec3(
          (p.x - look.x * standoff) * PC,
          (p.y - look.y * standoff) * PC,
          (p.z - look.z * standoff) * PC,
        ),
        quat: qlookRotation(quat(), look, NORTH),
        fovY: (40 * Math.PI) / 180,
      };
      return [
        {
          id: `exosys:${s.id}`,
          name: s.name,
          aliases: s.planets.map((q) => `${s.name} ${q[0]}`),
          subtitle: `Planetary system · ${s.planets.length} planet${s.planets.length > 1 ? 's' : ''}`,
          kind: 'other' as const,
          target: b,
        },
      ];
    });

    registry.addInfo({
      id: 'exoplanets',
      info: (id) => info(id, byId, cat, active, hygHost),
    });

    registry.addBookmarks(exoBookmarks(systems, api, hygHost));
  },
};

function vec3set(out: Vec3d, x: number, y: number, z: number): Vec3d {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

function info(
  id: string,
  byId: Map<string, SystemRow>,
  cat: StarCatalog,
  active: Active | null,
  hygHost: (s: SystemRow) => { absMag: number; teff: number } | undefined,
): InfoCard | null {
  const m = /^exo(?:sys)?:([^:]+)(?::(.+))?$/.exec(id);
  if (!m) return null;
  const sys = byId.get(m[1]);
  if (!sys) return null;
  const host = active?.sys === sys ? active.host : hostOf(sys, hygHost(sys));
  const planets = planetsOf(sys, host);
  const credit = "Open Exoplanet Catalogue (MIT); appearance: artist's impression";
  if (m[2]) {
    const p = planets.find((q) => q.id === id);
    if (!p) return null;
    const style = CLASS_STYLE[p.cls];
    return {
      title: p.name,
      subtitle: `${style.label} · artist's impression`,
      simulated: true,
      credit,
      description:
        "Artist's impression: the colour is chosen from the planet's size and temperature class. The orbital phase is illustrative.",
      facts: [
        { label: 'Radius', value: fmt(p.rEarth), unit: 'R⊕', approximate: p.radiusDerived },
        ...(p.mEarth != null ? [{ label: 'Mass', value: fmt(p.mEarth), unit: 'M⊕' }] : []),
        { label: 'Orbital period', value: fmt(p.periodDays, 4), unit: 'days' },
        { label: 'Semi-major axis', value: fmt(p.aAU), unit: 'AU' },
        { label: 'Eccentricity', value: fmt(p.e, 2) },
        { label: 'Equilibrium temperature', value: Math.round(p.teq), unit: 'K', approximate: p.teqDerived },
        {
          label: 'In the habitable zone',
          value: p.aAU >= host.hz[0] && p.aAU <= host.hz[1] ? 'yes' : 'no',
          approximate: true,
          source: 'Kopparapu et al. 2013',
        },
        ...(p.year ? [{ label: 'Discovered', value: `${p.year} (${p.method ?? '?'})` }] : []),
      ],
    };
  }
  const facts = [
    { label: 'Planets', value: sys.planets.length },
    ...(sys.dist ? [{ label: 'Distance', value: fmt(sys.dist), unit: 'pc' }] : []),
    { label: 'Host temperature', value: Math.round(host.teff), unit: 'K', approximate: host.approximate },
    { label: 'Host radius', value: fmt(host.radiusRsun), unit: 'R☉', approximate: host.approximate },
    { label: 'Host mass', value: fmt(host.massMsun), unit: 'M☉', approximate: sys.mass == null },
    {
      label: 'Habitable zone',
      value: `${fmt(host.hz[0], 2)}–${fmt(host.hz[1], 2)}`,
      unit: 'AU',
      approximate: true,
    },
    ...(sys.star >= 0 ? [{ label: 'HYG star', value: cat.displayName(sys.star) }] : []),
  ];
  return { title: sys.name, subtitle: 'Planetary system', facts, credit };
}

/** The four exoplanet bookmarks, computed at BOOKMARK_JD (they set that time on arrival). */
function exoBookmarks(
  systems: SystemRow[],
  api: StarSystemsApi,
  hygHost: (s: SystemRow) => { absMag: number; teff: number } | undefined,
): Bookmark[] {
  const years = yearsSinceJ2000(BOOKMARK_JD);
  const out: Bookmark[] = [];
  for (const def of EXOPLANET_BOOKMARKS) {
    const sys = systems.find((s) => s.id === def.system);
    if (!sys) continue;
    const host = hostOf(sys, hygHost(sys));
    const planets = planetsOf(sys, host);
    const target = def.planet ? planets.find((p) => p.suffix === def.planet) : undefined;
    const centre = sys.star >= 0 ? api.starPositionPc(sys.star, years, vec3()) : systemDirPc(sys);
    if (!centre || !planets.length) continue;
    const d = Math.hypot(centre.x, centre.y, centre.z);
    const basis = skyBasis(vec3(centre.x / d, centre.y / d, centre.z / d));
    const n = orbitNormal({ i: deg(planets[0].inclDeg), node: 0 }, basis, vec3());
    // Camera on the Sun-facing side, 35 deg above the orbital plane, at def.scale x the outer orbit.
    const aMax = Math.max(...planets.map((p) => p.aAU)) * AU;
    const dist = def.scale * (target ? target.aAU * AU : aMax);
    const r = basis.radial;
    const c35 = Math.cos(deg(35));
    const s35 = Math.sin(deg(35));
    const off = vec3(-r.x * c35 + n.x * s35, -r.y * c35 + n.y * s35, -r.z * c35 + n.z * s35);
    const ol = Math.hypot(off.x, off.y, off.z);
    off.x *= dist / ol;
    off.y *= dist / ol;
    off.z *= dist / ol;
    const look = vec3(-off.x / dist, -off.y / dist, -off.z / dist);
    out.push({
      id: def.id,
      title: def.title,
      frame: SSB_FRAME,
      pos: vec3(centre.x * PC + off.x, centre.y * PC + off.y, centre.z * PC + off.z),
      quat: qlookRotation(quat(), look, n),
      jd: BOOKMARK_JD,
      fovY: (def.fovDeg * Math.PI) / 180,
      // Photosphere at about 2 (pre-exposed) so the host disk reads in tests.
      ev: Math.round(Math.log2(diskLuminance(host.teff) / (1.2 * 2)) * 2) / 2,
      lookTarget: def.lookTarget,
    });
  }
  return out;
}

export default exoplanets;
