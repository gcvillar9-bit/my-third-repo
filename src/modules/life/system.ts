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
import { paleoClimate, sampleClimate, type ClimateMap } from '../paleo/public';
import { terrainHeightAt } from '../terrain/public';
import { featuredHerds } from './bookmarks';
import type { Candidate, Occurrences } from './ecology';
import fragGlsl from './glsl/life.frag.glsl?raw';
import vertGlsl from './glsl/life.vert.glsl?raw';
import { buildCreature } from './kit/creatures';
import { MODELS, type Gait } from './kit/models';
import { PLANTS, buildPlant, type PlantKind } from './kit/plants';
import {
  M_PER_DEG,
  herdsAround,
  localEN,
  memberAt,
  plantsAround,
  type Climate,
  type Herd,
  type LifeLimits,
  type Plant,
} from './population';

export const LIFE_MODULE_ID = 'life';
export const OCCURRENCES_PATH = 'data/life/occurrences.json';
/** The scene is filled below this altitude above the ground, m. */
export const ACTIVE_ALTITUDE_M = 3000;
/** The anchor snaps to this grid (degrees, about 220 m). */
const ANCHOR_DEG = 0.002;
/** Plants are re-picked when the camera moves this far, m. */
const REPICK_M = 12;

export const LIMITS: Record<string, LifeLimits> = {
  potato: { treeRadius: 160, tuftRadius: 45, herdRadius: 360, maxPlants: 900, maxCreatures: 50 },
  low: { treeRadius: 250, tuftRadius: 70, herdRadius: 480, maxPlants: 2000, maxCreatures: 90 },
  medium: { treeRadius: 400, tuftRadius: 110, herdRadius: 700, maxPlants: 4500, maxCreatures: 160 },
  high: { treeRadius: 600, tuftRadius: 150, herdRadius: 900, maxPlants: 8000, maxCreatures: 240 },
  ultra: { treeRadius: 800, tuftRadius: 200, herdRadius: 1100, maxPlants: 12000, maxCreatures: 320 },
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

export class LifeSystem {
  readonly group = new Group();
  private sets = new Map<string, InstanceSet>();
  private shared: Record<string, IUniform>;
  private occ: Occurrences | null = null;
  private occLoad: Promise<unknown> | null = null;
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
  private plants: Plant[] = [];
  private herds: Herd[] = [];
  /** Ground height cache per plant (by object). */
  private plantPos = new WeakMap<Plant, Vec3d>();
  private labelsOut: LabelItem[] = [];
  private era = -1;
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
        .catch((e) => console.warn('[life] occurrences unavailable; only hand-entered ranges', e)),
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
    if (!this.climate || this.climateKey !== String(era) || !this.occLoad) {
      this.group.visible = false;
      return;
    }
    if (era !== this.era) {
      this.era = era;
      this.ageMa = ageMa;
      this.pickEra = -1;
    }
    const reanchored = this.reanchor(lat, lon);
    if (Number.isNaN(this.anchorLat)) {
      this.group.visible = false;
      return; // terrain heights not ready
    }
    const lim = LIMITS[view.quality] ?? LIMITS.medium;
    const map = this.climate;
    const climate: Climate = { at: (la, lo) => sampleClimate(map, la, lo) };
    const [de, dn] = localEN(this.pickLat || lat, this.pickLon || lon, lat, lon);
    if (reanchored || this.pickEra !== era || Math.hypot(de, dn) > REPICK_M) {
      this.pickLat = lat;
      this.pickLon = lon;
      this.pickEra = era;
      this.plants = plantsAround(lat, lon, era, this.ageMa, climate, lim, this.plantCache);
      this.herds = herdsAround(
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
      );
      this.fillPlants();
    }
    this.moveCreatures(view, lim);
    this.updateUniforms(view);
    this.group.visible = true;
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

  private moveCreatures(view: ViewState, lim: LifeLimits): void {
    const t = view.timeReal;
    const dt = Math.min(0.25, Math.max(0, view.dtReal));
    const counts = new Map<string, number>();
    for (const [key, s] of this.sets) if (key.startsWith('c:')) s.count = 0;
    const labels: LabelItem[] = [];
    const nearest = new Map<string, { d: number; item: LabelItem }>();
    let total = 0;
    const g = vec3();
    for (const h of this.herds) {
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
      counts.set(h.species.model, s.count);
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

  /** Species shown now (tests, captions). */
  shown(): { plants: Record<string, number>; creatures: Record<string, number> } {
    const plants: Record<string, number> = {};
    const creatures: Record<string, number> = {};
    for (const [key, s] of this.sets) {
      if (!s.count) continue;
      if (key.startsWith('p:')) plants[key.slice(2)] = s.count;
      else creatures[key.slice(2)] = s.count;
    }
    for (const h of this.herds)
      creatures[`species:${h.species.id}`] = (creatures[`species:${h.species.id}`] ?? 0) + h.members.length;
    return { plants, creatures };
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
