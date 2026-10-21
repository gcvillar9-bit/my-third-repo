/**
 * The life system: near Earth's ground it fills the scene around the camera with the plants and
 * animals of the clock's era (population.ts), draws them instanced (one draw per model, one shared
 * program) and labels the nearest animals. Everything sits in the "anchor" frame: a ground point near
 * the camera, snapped to a grid so instance offsets (Float32, metres) stay small and stable.
 */
import {
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
  Vector4,
  type BufferGeometry,
  type IUniform,
} from 'three';
import type { LabelItem, ModuleContext, Quatd, Vec3d, ViewState } from '../../core/contracts';
import { yearsBeforePresent } from '../../core/geotime';
import { qrotate, qrotateInv, quat, vec3 } from '../../core/math64';
import { SUN_RGB, solarIlluminance } from '../../core/photometry';
import { DEPTH_GLSL } from '../../render/chunks/index';
import {
  ATMOSPHERE_TRANSMITTANCE_GLSL,
  atmosphereShadingUniforms,
  requestAtmosphereLuts,
  siteDirection,
} from '../atmosphere/public';
import { SURFACE, paleoClimate, sampleClimate, sampleClimateLand, type ClimateMap } from '../paleo/public';
import { terrainHeightAt, terrainHeightGeneration } from '../terrain/public';
import { featuredHerds } from './bookmarks';
import { ACTIVE_ALTITUDE_M } from './constants';
import type { Candidate, Occurrences } from './ecology';
import fragGlsl from './glsl/life.frag.glsl?raw';
import vertGlsl from './glsl/life.vert.glsl?raw';
import { buildCreature } from './kit/creatures';
import { MODELS, type Gait } from './kit/models';
import { BUILDINGS, buildBuilding, type BuildingKind } from './kit/buildings';
import { PLANTS, buildPlant, type PlantKind } from './kit/plants';
import {
  HERD_CELL_M,
  BUILDING_CELL_M,
  M_PER_DEG,
  buildingsAround,
  herdsAround,
  townAt,
  localEN,
  memberAt,
  plantsAround,
  type Climate,
  type Herd,
  type LifeLimits,
  type Building,
  type Plant,
  type Town,
  type TownOf,
} from './population';
import {
  TOWNS_FROM_YEAR,
  citiesAtJd,
  citiesLoaded,
  loadCities,
  monumentsNear,
  yearOfJd,
} from '../cities/public';

export const OCCURRENCES_PATH = 'data/life/occurrences.json';
/** The anchor snaps to this grid (degrees, about 220 m). */
const ANCHOR_DEG = 0.002;
/** Plants are re-picked when the camera moves this far, m. */
const REPICK_M = 12;
/** Town landmarks other than the first stand within this distance of the town centre, m. */
const LANDMARK_SPREAD_M = 100;
/**
 * Monuments that stand in for a town's style landmark lie within this distance of the town centre, m
 * (the Empire State Building is about 4.7 km from New York's, the Forbidden City 930 m from Beijing's).
 */
const MONUMENT_SPREAD_M = 5000;

export const LIMITS: Record<string, LifeLimits> = {
  potato: {
    treeRadius: 160,
    tuftRadius: 45,
    herdRadius: 360,
    maxPlants: 900,
    maxCreatures: 50,
    buildingRadius: 450,
    maxBuildings: 500,
  },
  low: {
    treeRadius: 250,
    tuftRadius: 70,
    herdRadius: 480,
    maxPlants: 2000,
    maxCreatures: 90,
    buildingRadius: 700,
    maxBuildings: 1200,
  },
  medium: {
    treeRadius: 400,
    tuftRadius: 110,
    herdRadius: 700,
    maxPlants: 4500,
    maxCreatures: 160,
    buildingRadius: 1100,
    maxBuildings: 3000,
  },
  high: {
    treeRadius: 600,
    tuftRadius: 150,
    herdRadius: 900,
    maxPlants: 8000,
    maxCreatures: 240,
    buildingRadius: 1600,
    maxBuildings: 6000,
  },
  ultra: {
    treeRadius: 800,
    tuftRadius: 200,
    herdRadius: 1100,
    maxPlants: 12000,
    maxCreatures: 320,
    buildingRadius: 2200,
    maxBuildings: 10000,
  },
};

const GAIT_KIND: Record<Gait['kind'], number> = { walk: 0, biped: 1, upright: 2, fly: 3 };

interface InstanceSet {
  mesh: Mesh;
  geo: InstancedBufferGeometry;
  material: ShaderMaterial;
  pos: InstancedBufferAttribute;
  frame: InstancedBufferAttribute;
  motion: InstancedBufferAttribute;
  count: number;
  /** Model height, m (labels). */
  height: number;
  bytes: number;
}

/** Era key: about 2.5% steps in age, so a scene stays put while the clock runs at everyday rates. */
export function eraKey(ageMa: number): number {
  return Math.round(Math.log(ageMa * 1e6 + 1) * 40);
}

/**
 * Date step of a pick's towns and buildings: half a year, so it changes wherever one of them can (cities
 * citiesAtJd rounds to a decade before 1800 and to a year after; monuments and town walls switch on whole
 * years). One key before the first towns (cities TOWNS_FROM_YEAR), so a clock running through deep time
 * does not re-pick.
 */
export function townYearKey(year: number): number {
  return year < TOWNS_FROM_YEAR ? -Infinity : Math.floor(2 * year);
}

/**
 * Towns around (lat, lon) by use. `built` feeds buildingsAround: houses and walls (just outside the edge)
 * within the building radius, centre landmarks within 4x. `near` feeds townAt: streets and the farmland
 * ring (1.6 town radii) at any herd a pick can place (cellsAround walks a square of herd cells), so a
 * cached herd cell does not depend on where the camera stood when it was filled.
 */
export function townsAround(
  all: readonly Town[],
  lat: number,
  lon: number,
  lim: LifeLimits,
): { built: Town[]; near: Town[] } {
  const built: Town[] = [];
  const near: Town[] = [];
  const reach = Math.SQRT2 * (lim.herdRadius + HERD_CELL_M);
  for (const t of all) {
    const d = Math.hypot(...localEN(lat, lon, t.lat, t.lon));
    const walls = 1.02 * t.radiusM + 2 * BUILDING_CELL_M;
    if (d < Math.max(walls + lim.buildingRadius, 4 * lim.buildingRadius + LANDMARK_SPREAD_M)) built.push(t);
    // From the town centre, as townAt measures: across a big town at high latitude the camera's and
    // the town's east-west scales differ by more than the margin.
    if (Math.hypot(...localEN(t.lat, t.lon, lat, lon)) < 1.6 * t.radiusM + reach) near.push(t);
  }
  return { built, near };
}

/**
 * Range of the monuments a pick passes to buildingsAround, m. A monument in town replaces the style
 * landmark of its kind, which is drawn out to 4x the building radius, so the monument must be in range
 * wherever that landmark is (or the landmark shows until the camera comes within reach of the monument).
 */
export function monumentRange(lim: LifeLimits): number {
  return 4 * lim.buildingRadius + LANDMARK_SPREAD_M + MONUMENT_SPREAD_M;
}

/** Herds in drawing order under the creature cap: the hand-placed ones (bookmarks) first, then nearest. */
export function orderHerds(herds: readonly Herd[], lat: number, lon: number): Herd[] {
  return herds
    .map((h) => ({
      h,
      d: Math.hypot(...localEN(lat, lon, h.lat, h.lon)) - (h.key.startsWith('featured:') ? 1e9 : 0),
    }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.h);
}

/**
 * Climate at a point. Today's continents (since 2.6 Ma) follow the terrain, which knows the real coast:
 * land the 0.5 degree map calls sea takes the nearest land cell's climate, and ground at sea level is
 * water. Exposed shelves (the ice-age sea-level drop) stay land: the terrain has no bathymetry, so it
 * cannot tell the dry seabed from the sea. In deep time the paleo map decides (the painted land).
 * `aboveSea` is the ground height above sea level, m, or null before the terrain loads.
 */
export function groundClimate(
  map: ClimateMap,
  la: number,
  lo: number,
  aboveSea: (la: number, lo: number) => number | null,
): { kind: number; tempC: number; moisture: number } {
  const c = sampleClimate(map, la, lo);
  if (!map.modern || c.kind === SURFACE.shelf) return c;
  const ground = aboveSea(la, lo);
  if (ground === null) return c;
  if (c.kind === SURFACE.sea && ground > 1)
    return sampleClimateLand(map, la, lo) ?? { ...c, kind: SURFACE.land, moisture: 0.4 };
  if (c.kind === SURFACE.land && ground < 0.2) return { ...c, kind: SURFACE.sea };
  return c;
}

export class LifeSystem {
  readonly group = new Group();
  private sets = new Map<string, InstanceSet>();
  private shared: Record<string, IUniform>;
  private occ: Occurrences | null = null;
  private occLoad: Promise<unknown> | null = null;
  /** The occurrences have loaded or failed (herds picked before would be cached without them). */
  private occDone = false;
  private climate: ClimateMap | null = null;
  private climateKey = '';
  private climateWant = '';
  private plantCache = new Map<string, Plant[]>();
  private herdCache = new Map<string, Herd | null>();
  private candCache = new Map<string, Candidate[]>();
  private featured = featuredHerds();
  private anchorLat = NaN;
  private anchorLon = NaN;
  private anchor = vec3();
  private east = vec3();
  private north = vec3();
  private up = vec3();
  private pickLat = NaN;
  private pickLon = NaN;
  private pickEra = -1;
  /** Town date step (townYearKey) of the last pick. */
  private pickTown = NaN;
  /** Terrain height generation the scene is seated on (terrainHeightGeneration). */
  private heightGen = 0;
  private plants: Plant[] = [];
  private buildings: Building[] = [];
  /** Seated building positions by kind and place (buildingsAround returns new objects per pick). */
  private buildingPos = new Map<string, Vec3d>();
  /** Herds of the last pick in drawing order (orderHerds). */
  private herds: Herd[] = [];
  /** Members drawn this frame per species id (under the creature cap). */
  private drawn = new Map<string, number>();
  /** Ground height cache per plant (by object). */
  private plantPos = new WeakMap<Plant, Vec3d>();
  private labelsOut: LabelItem[] = [];
  private era = -1;
  private townsReady = false;
  private pickTime = -Infinity;
  private ageMa = 0;
  active = false;
  private tmp = { e: 0, n: 0, ve: 0, vn: 0 };
  private q: Quatd = quat();
  private v = vec3();
  private w = vec3();
  private m4 = new Matrix4();

  constructor(private ctx: Pick<ModuleContext, 'assets' | 'registry' | 'render' | 'quality'>) {
    requestAtmosphereLuts('earth');
    this.shared = {
      ...atmosphereShadingUniforms('earth'),
      uExposure: ctx.render.uniforms.uExposure,
      uBodyToWorld: { value: new Matrix3() },
      uAnchorRel: { value: new Vector3() },
      uEast: { value: new Vector3() },
      uNorth: { value: new Vector3() },
      uUp: { value: new Vector3() },
      uLifeTime: { value: 0 },
      uSunRel: { value: new Vector3() },
      uSunIllum: { value: new Vector3() },
      uUpWorld: { value: new Vector3() },
      uGroundRkm: { value: 6371 },
    };
    this.group.name = 'life';
    this.group.visible = false;
  }

  private earthRadius(): number {
    return this.ctx.registry.body('earth')?.radius ?? 6_378_137;
  }

  /** Ground point (body-fixed, m) under lat/lon, or null before the terrain heights load. */
  private ground(lat: number, lon: number, out: Vec3d): Vec3d | null {
    const d = siteDirection(lat, lon);
    const h = terrainHeightAt('earth', d);
    if (h === null) return null;
    const r = this.earthRadius() + h;
    out.x = d.x * r;
    out.y = d.y * r;
    out.z = d.z * r;
    return out;
  }

  private set(key: string, build: () => { geo: BufferGeometry; gait: Vector4; height: number }): InstanceSet {
    let s = this.sets.get(key);
    if (s) return s;
    const { geo: base, gait, height } = build();
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('aColor', base.getAttribute('color'));
    geo.setAttribute('aJoint', base.getAttribute('aJoint'));
    geo.setAttribute('aBend', base.getAttribute('aBend'));
    const cap = 16;
    const mk = (n: number) =>
      new InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(DynamicDrawUsage);
    const pos = mk(3);
    const frame = mk(4);
    const motion = mk(4);
    geo.setAttribute('iPos', pos);
    geo.setAttribute('iFrame', frame);
    geo.setAttribute('iMotion', motion);
    geo.instanceCount = 0;
    const material = new ShaderMaterial({
      vertexShader: `${DEPTH_GLSL}\n${vertGlsl}`,
      fragmentShader: `${DEPTH_GLSL}\n${ATMOSPHERE_TRANSMITTANCE_GLSL}\n${fragGlsl}`,
      uniforms: { ...this.shared, uGait: { value: gait } },
    });
    const mesh = new Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.name = `life.${key}`;
    this.group.add(mesh);
    const verts = (base.getAttribute('position') as { count: number }).count;
    s = { mesh, geo, material, pos, frame, motion, count: 0, height, bytes: verts * 14 * 4 };
    this.sets.set(key, s);
    base.dispose();
    return s;
  }

  private creatureSet(model: string): InstanceSet {
    return this.set(`c:${model}`, () => {
      const m = MODELS[model];
      const b = buildCreature(m.spec);
      return {
        geo: b.build(),
        gait: new Vector4(m.gait.swing, m.gait.knee, GAIT_KIND[m.gait.kind], 0),
        height: b.bounds().height,
      };
    });
  }

  private buildingSet(kind: BuildingKind): InstanceSet {
    return this.set(`b:${kind}`, () => {
      const b = buildBuilding(kind, 3);
      return { geo: b.build(), gait: new Vector4(0, 0, 4, 0), height: b.bounds().height };
    });
  }

  private plantSet(kind: PlantKind): InstanceSet {
    return this.set(`p:${kind}`, () => {
      const b = buildPlant(kind, 3);
      return { geo: b.build(), gait: new Vector4(0, 0, 4, PLANTS[kind].sway), height: b.bounds().height };
    });
  }

  private ensure(s: InstanceSet, n: number): void {
    const cap = s.pos.count;
    if (n <= cap) return;
    let c = cap;
    while (c < n) c *= 2;
    const grow = (a: InstancedBufferAttribute, k: number) => {
      const b = new InstancedBufferAttribute(new Float32Array(c * k), k).setUsage(DynamicDrawUsage);
      (b.array as Float32Array).set(a.array as Float32Array);
      return b;
    };
    s.pos = grow(s.pos, 3);
    s.frame = grow(s.frame, 4);
    s.motion = grow(s.motion, 4);
    s.geo.setAttribute('iPos', s.pos);
    s.geo.setAttribute('iFrame', s.frame);
    s.geo.setAttribute('iMotion', s.motion);
  }

  private loadOccurrences(): void {
    if (this.occLoad) return;
    const { assets } = this.ctx;
    this.occLoad = assets.track(
      assets
        .json<Occurrences>(OCCURRENCES_PATH)
        .then((o) => {
          this.occ = o;
        })
        .catch((e) => console.warn('[life] occurrences unavailable; only hand-entered ranges', e))
        .then(() => {
          this.occDone = true;
        }),
      'life occurrences',
    );
  }

  private requestClimate(jd: number, key: string): void {
    if (this.climateWant === key) return;
    this.climateWant = key;
    this.ctx.assets.track(
      paleoClimate(jd).then((c) => {
        if (this.climateWant !== key) return;
        this.climate = c;
        this.climateKey = key;
      }),
      'life climate',
    );
  }

  private reanchor(lat: number, lon: number): boolean {
    const aLat = Math.round(lat / ANCHOR_DEG) * ANCHOR_DEG;
    const aLon = Math.round(lon / ANCHOR_DEG) * ANCHOR_DEG;
    if (aLat === this.anchorLat && aLon === this.anchorLon) return false;
    if (!this.ground(aLat, aLon, this.anchor)) return false;
    this.anchorLat = aLat;
    this.anchorLon = aLon;
    const up = siteDirection(aLat, aLon);
    this.up = up;
    const ex = -up.y;
    const ey = up.x;
    const el = Math.hypot(ex, ey) || 1;
    this.east = vec3(ex / el, ey / el, 0);
    this.north = vec3(
      up.y * this.east.z - up.z * this.east.y,
      up.z * this.east.x - up.x * this.east.z,
      up.x * this.east.y - up.y * this.east.x,
    );
    const u = this.shared;
    (u.uEast.value as Vector3).set(this.east.x, this.east.y, this.east.z);
    (u.uNorth.value as Vector3).set(this.north.x, this.north.y, this.north.z);
    (u.uUp.value as Vector3).set(up.x, up.y, up.z);
    return true;
  }

  /** CPU time of the last updates, ms (diagnostics). */
  private cpuMs = 0;

  update(view: ViewState): void {
    const t0 = performance.now();
    this.step(view);
    this.cpuMs = 0.9 * this.cpuMs + 0.1 * (performance.now() - t0);
  }

  private step(view: ViewState): void {
    const near = view.nearestSurface();
    const on = !!near && near.bodyId === 'earth' && near.altitude < ACTIVE_ALTITUDE_M;
    this.active = on;
    if (!on) {
      this.group.visible = false;
      return;
    }
    // Camera on the globe (body-fixed).
    const frame = 'earth.fixed';
    const o = view.toCamera(frame, vec3(), this.v);
    view.frameQuat(frame, this.q);
    const cam = qrotateInv(this.w, this.q, vec3(-o.x, -o.y, -o.z));
    const r = Math.hypot(cam.x, cam.y, cam.z);
    const lat = (Math.asin(cam.z / r) * 180) / Math.PI;
    const lon = (Math.atan2(cam.y, cam.x) * 180) / Math.PI;
    const ageMa = Math.max(0, yearsBeforePresent(view.jd) / 1e6);
    const era = eraKey(ageMa);
    this.loadOccurrences();
    this.requestClimate(view.jd, String(era));
    if (!this.climate || this.climateKey !== String(era) || !this.occDone) {
      this.group.visible = false;
      return;
    }
    if (era !== this.era) {
      this.era = era;
      this.ageMa = ageMa;
      this.pickEra = -1;
    }
    // The ground changed under the scene (first heights, HD terrain blocks): seat everything again, at
    // most five times a second. The modern coast test (climateAt) reads the heights too, so the cached
    // cells go as well.
    const gen = terrainHeightGeneration('earth');
    if (gen !== this.heightGen && view.timeReal - this.pickTime > 0.2) {
      this.heightGen = gen;
      this.plantPos = new WeakMap();
      this.buildingPos.clear();
      this.plantCache.clear();
      this.herdCache.clear();
      this.anchorLat = this.anchorLon = NaN;
      this.pickEra = -1;
    }
    const reanchored = this.reanchor(lat, lon);
    if (Number.isNaN(this.anchorLat)) {
      this.group.visible = false;
      return; // terrain heights not ready
    }
    const lim = LIMITS[view.quality] ?? LIMITS.medium;
    const map = this.climate;
    const climate: Climate = { at: (la, lo) => this.climateAt(map, la, lo) };
    const [de, dn] = localEN(this.pickLat || lat, this.pickLon || lon, lat, lon);
    // Towns load lazily: pick again once they are known.
    loadCities();
    const towns = citiesLoaded();
    if (towns !== this.townsReady) {
      this.townsReady = towns;
      this.pickEra = -1;
      this.plantCache.clear();
      this.herdCache.clear();
    }
    const moved = Math.hypot(de, dn);
    // At most five picks a second while moving (fast low flight) or while the clock runs through the
    // towns' history, unless the camera jumped far.
    const due = view.timeReal - this.pickTime > 0.2 || moved > 20 * REPICK_M;
    const year = yearOfJd(view.jd);
    const town = townYearKey(year);
    // Towns grow, change style and vanish within an era (all of 1950 to today is one era).
    const townsChanged = town !== this.pickTown;
    if (this.pickEra !== era || ((moved > REPICK_M || townsChanged) && due)) {
      this.pickTime = view.timeReal;
      this.pickLat = lat;
      this.pickLon = lon;
      this.pickEra = era;
      this.pickTown = town;
      // Cached herd cells hold townsfolk, livestock or wild herds by the towns of their date.
      if (townsChanged) this.herdCache.clear();
      // Towns of the date (cities module) for buildings, streets and farmland.
      const towns = townsAround(citiesAtJd(view.jd), lat, lon, lim);
      const townOf: TownOf = (la, lo) => townAt(towns.near, la, lo);
      this.buildings = buildingsAround(
        lat,
        lon,
        towns.built,
        monumentsNear(lat, lon, view.jd, monumentRange(lim)),
        year,
        lim.buildingRadius,
        lim.maxBuildings,
      );
      this.plants = plantsAround(lat, lon, era, this.ageMa, climate, lim, this.plantCache, townOf);
      this.herds = orderHerds(
        herdsAround(
          lat,
          lon,
          era,
          this.ageMa,
          climate,
          this.occ,
          lim,
          this.herdCache,
          this.candCache,
          this.featured,
          eraKey,
          townOf,
        ),
        lat,
        lon,
      );
      this.fillPlants();
      this.fillBuildings();
    } else if (reanchored) {
      // Instance offsets are from the anchor: rewrite them now, the next pick waits for its turn.
      this.fillPlants();
      this.fillBuildings();
    }
    this.moveCreatures(view, lim);
    this.updateUniforms(view);
    this.group.visible = true;
  }

  /** Climate at a point (groundClimate on the terrain heights). */
  private climateAt(map: ClimateMap, la: number, lo: number) {
    return groundClimate(map, la, lo, this.aboveSea);
  }

  /** Ground height above sea level at a point, m, or null before the terrain heights load. */
  private aboveSea = (la: number, lo: number): number | null => {
    const h = terrainHeightAt('earth', siteDirection(la, lo));
    return h === null ? null : h - this.seaLevelHeight(la, lo);
  };

  /** Terrain height of the sea surface at a point: heightAt is above the equatorial radius. */
  private seaLevelHeight(la: number, lo: number): number {
    const d = siteDirection(la, lo);
    const a = this.earthRadius();
    const f = this.ctx.registry.body('earth')?.oblateness ?? 0;
    const c = a * (1 - f);
    return 1 / Math.sqrt((d.x * d.x + d.y * d.y) / (a * a) + (d.z * d.z) / (c * c)) - a;
  }

  private fillPlants(): void {
    const byKind = new Map<PlantKind, Plant[]>();
    for (const p of this.plants) {
      let l = byKind.get(p.kind);
      if (!l) byKind.set(p.kind, (l = []));
      l.push(p);
    }
    for (const [key, s] of this.sets)
      if (key.startsWith('p:') && !byKind.has(key.slice(2) as PlantKind)) s.geo.instanceCount = s.count = 0;
    const p0 = vec3();
    for (const [kind, list] of byKind) {
      const s = this.plantSet(kind);
      this.ensure(s, list.length);
      const pos = s.pos.array as Float32Array;
      const fr = s.frame.array as Float32Array;
      const mo = s.motion.array as Float32Array;
      let n = 0;
      for (const p of list) {
        let g = this.plantPos.get(p);
        if (!g) {
          const at = this.ground(p.lat, p.lon, p0);
          if (!at) continue;
          g = vec3(at.x, at.y, at.z);
          this.plantPos.set(p, g);
        }
        pos[n * 3] = g.x - this.anchor.x;
        pos[n * 3 + 1] = g.y - this.anchor.y;
        pos[n * 3 + 2] = g.z - this.anchor.z;
        fr[n * 4] = Math.cos(p.heading);
        fr[n * 4 + 1] = Math.sin(p.heading);
        fr[n * 4 + 2] = p.scale;
        fr[n * 4 + 3] = p.tint;
        mo[n * 4] = 0;
        mo[n * 4 + 1] = 0;
        mo[n * 4 + 2] = 0;
        mo[n * 4 + 3] = -0.05 * p.scale; // sink the base a little on slopes
        n++;
      }
      s.count = n;
      s.geo.instanceCount = n;
      s.pos.needsUpdate = true;
      s.frame.needsUpdate = true;
      s.motion.needsUpdate = true;
    }
  }

  private fillBuildings(): void {
    const byKind = new Map<BuildingKind, Building[]>();
    for (const b of this.buildings) {
      let l = byKind.get(b.kind);
      if (!l) byKind.set(b.kind, (l = []));
      l.push(b);
    }
    for (const [key, s] of this.sets)
      if (key.startsWith('b:') && !byKind.has(key.slice(2) as BuildingKind))
        s.geo.instanceCount = s.count = 0;
    const p0 = vec3();
    for (const [kind, list] of byKind) {
      const s = this.buildingSet(kind);
      this.ensure(s, list.length);
      const pos = s.pos.array as Float32Array;
      const fr = s.frame.array as Float32Array;
      const mo = s.motion.array as Float32Array;
      const half = BUILDINGS[kind].half;
      let n = 0;
      for (const b of list) {
        const key = `${b.kind}:${b.lat.toFixed(7)}:${b.lon.toFixed(7)}:${b.scale.toFixed(3)}`;
        let g = this.buildingPos.get(key);
        if (!g) {
          // Seat on the lowest corner so slopes do not leave the building floating.
          const at = this.ground(b.lat, b.lon, p0);
          if (!at) continue;
          g = vec3(at.x, at.y, at.z);
          const r0 = Math.hypot(g.x, g.y, g.z);
          let low = 0;
          const cosLat = Math.cos((b.lat * Math.PI) / 180);
          for (const [e, nn] of [
            [half[1], half[0]],
            [-half[1], half[0]],
            [half[1], -half[0]],
            [-half[1], -half[0]],
          ]) {
            const c = this.ground(
              b.lat + (nn * b.scale) / M_PER_DEG,
              b.lon + (e * b.scale) / (M_PER_DEG * cosLat),
              vec3(),
            );
            if (c) low = Math.min(low, Math.hypot(c.x, c.y, c.z) - r0);
          }
          const k = (r0 + low) / r0;
          g = vec3(g.x * k, g.y * k, g.z * k);
          if (this.buildingPos.size > 20_000) this.buildingPos.clear();
          this.buildingPos.set(key, g);
        }
        pos[n * 3] = g.x - this.anchor.x;
        pos[n * 3 + 1] = g.y - this.anchor.y;
        pos[n * 3 + 2] = g.z - this.anchor.z;
        fr[n * 4] = Math.cos(b.heading);
        fr[n * 4 + 1] = Math.sin(b.heading);
        fr[n * 4 + 2] = b.scale;
        fr[n * 4 + 3] = 0.5;
        mo[n * 4] = 0;
        mo[n * 4 + 1] = 0;
        mo[n * 4 + 2] = 0;
        mo[n * 4 + 3] = 0;
        n++;
      }
      s.count = n;
      s.geo.instanceCount = n;
      s.pos.needsUpdate = true;
      s.frame.needsUpdate = true;
      s.motion.needsUpdate = true;
    }
  }

  private moveCreatures(view: ViewState, lim: LifeLimits): void {
    const t = view.timeReal;
    const dt = Math.min(0.25, Math.max(0, view.dtReal));
    for (const [key, s] of this.sets) if (key.startsWith('c:')) s.count = 0;
    const labels: LabelItem[] = [];
    const nearest = new Map<string, { d: number; item: LabelItem }>();
    const drawn = this.drawn;
    drawn.clear();
    let total = 0;
    const g = vec3();
    // Herds come featured first, then nearest (orderHerds): the cap drops the farthest.
    for (const h of this.herds) {
      if (total >= lim.maxCreatures) break;
      const model = MODELS[h.species.model];
      const s = this.creatureSet(h.species.model);
      this.ensure(s, s.count + h.members.length);
      const pos = s.pos.array as Float32Array;
      const fr = s.frame.array as Float32Array;
      const mo = s.motion.array as Float32Array;
      const cosLat = Math.cos((h.lat * Math.PI) / 180);
      for (const m of h.members) {
        if (total >= lim.maxCreatures) break;
        memberAt(m, t, this.tmp);
        const lat = h.lat + this.tmp.n / M_PER_DEG;
        const lon = h.lon + this.tmp.e / (M_PER_DEG * Math.max(0.05, cosLat));
        if (!this.ground(lat, lon, g)) continue;
        const speed = Math.hypot(this.tmp.ve, this.tmp.vn);
        if (speed > 0.05) m.heading = Math.atan2(this.tmp.ve, this.tmp.vn);
        const fly = model.gait.kind === 'fly';
        m.gait = (m.gait + (fly ? 0.8 * dt : (speed * dt) / Math.max(0.1, model.gait.stride * m.scale))) % 1;
        const move = fly
          ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(0.4 * t + m.phi))
          : Math.min(1.2, speed / model.gait.speed);
        const graze = model.gait.graze ? Math.max(0, 1 - 2.5 * move) : 0;
        const n = s.count++;
        pos[n * 3] = g.x - this.anchor.x;
        pos[n * 3 + 1] = g.y - this.anchor.y;
        pos[n * 3 + 2] = g.z - this.anchor.z;
        fr[n * 4] = Math.cos(m.heading);
        fr[n * 4 + 1] = Math.sin(m.heading);
        fr[n * 4 + 2] = m.scale;
        fr[n * 4 + 3] = m.tint;
        mo[n * 4] = m.gait;
        mo[n * 4 + 1] = move;
        mo[n * 4 + 2] = graze;
        mo[n * 4 + 3] = m.fly;
        total++;
        drawn.set(h.species.id, (drawn.get(h.species.id) ?? 0) + 1);
        // Label the nearest individual of each species.
        const rel = view.toCamera('earth.fixed', g, this.v);
        const d = Math.hypot(rel.x, rel.y, rel.z);
        const prev = nearest.get(h.species.id);
        if (d < 400 && (!prev || d < prev.d)) {
          const top = (s.height * m.scale + m.fly + 0.6) / Math.hypot(g.x, g.y, g.z);
          nearest.set(h.species.id, {
            d,
            item: {
              id: `life:${h.species.id}`,
              text: h.species.name,
              frame: 'earth.fixed',
              local: vec3(g.x * (1 + top), g.y * (1 + top), g.z * (1 + top)),
              priority: 40 - d / 20,
              color: '#e8dcc0',
            },
          });
        }
      }
    }
    for (const [key, s] of this.sets) {
      if (!key.startsWith('c:')) continue;
      s.geo.instanceCount = s.count;
      if (s.count) {
        s.pos.needsUpdate = true;
        s.frame.needsUpdate = true;
        s.motion.needsUpdate = true;
      }
    }
    for (const { item } of nearest.values()) labels.push(item);
    this.labelsOut = labels;
  }

  private updateUniforms(view: ViewState): void {
    const u = this.shared;
    const q = this.q;
    this.m4.makeRotationFromQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
    (u.uBodyToWorld.value as Matrix3).setFromMatrix4(this.m4);
    const a = view.toCamera('earth.fixed', this.anchor, this.v);
    (u.uAnchorRel.value as Vector3).set(a.x, a.y, a.z);
    const upW = qrotate(this.w, q, this.up);
    (u.uUpWorld.value as Vector3).set(upW.x, upW.y, upW.z);
    u.uGroundRkm.value = Math.hypot(this.anchor.x, this.anchor.y, this.anchor.z) / 1000;
    const sun = view.sunToCamera(vec3());
    (u.uSunRel.value as Vector3).set(sun.x, sun.y, sun.z);
    const c = view.toCamera('earth', vec3(), this.w);
    const E = solarIlluminance(Math.hypot(sun.x - c.x, sun.y - c.y, sun.z - c.z));
    (u.uSunIllum.value as Vector3).set(E * SUN_RGB[0], E * SUN_RGB[1], E * SUN_RGB[2]);
    u.uLifeTime.value = view.timeReal % 10000;
  }

  /** Labels of the nearest animals (UI label source). */
  labels(out: LabelItem[]): void {
    if (!this.active || !this.group.visible) return;
    for (const l of this.labelsOut) out.push(l);
  }

  /** Instances drawn now by plant, building and model kind, and animals by species (tests, captions). */
  shown(): {
    plants: Record<string, number>;
    creatures: Record<string, number>;
    buildings: Record<string, number>;
  } {
    const plants: Record<string, number> = {};
    const creatures: Record<string, number> = {};
    const buildings: Record<string, number> = {};
    for (const [key, s] of this.sets) {
      if (!s.count) continue;
      if (key.startsWith('p:')) plants[key.slice(2)] = s.count;
      else if (key.startsWith('b:')) buildings[key.slice(2)] = s.count;
      else creatures[key.slice(2)] = s.count;
    }
    for (const [id, n] of this.drawn) creatures[`species:${id}`] = n;
    return { plants, creatures, buildings };
  }

  /** Diagnostics (tests). */
  debug(): Record<string, unknown> {
    let near = Infinity;
    const at = this.pickLat;
    for (const p of this.plants)
      near = Math.min(near, Math.hypot(...localEN(at, this.pickLon, p.lat, p.lon)));
    return {
      active: this.active,
      cpuMs: this.cpuMs,
      visible: this.group.visible,
      era: this.era,
      ageMa: this.ageMa,
      climate: this.climateKey,
      anchor: [this.anchorLat, this.anchorLon],
      plants: this.plants.length,
      nearestPlantM: near,
      herds: this.herds.map((h) => `${h.species.id}x${h.members.length}`),
    };
  }

  memoryBytes(): number {
    let b = 0;
    for (const s of this.sets.values()) b += s.bytes + s.pos.count * 11 * 4;
    return b;
  }

  dispose(): void {
    for (const s of this.sets.values()) {
      s.geo.dispose();
      s.material.dispose();
    }
    this.sets.clear();
  }
}
