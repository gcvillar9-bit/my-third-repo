/**
 * Galaxy portraits (background layer): a 3D emission/absorption model per "portrait" galaxy (the 54
 * gallery galaxies), drawn instead of the generic impostor from the same angular size where impostors
 * start (IMPOSTOR_LO..HI crossfade against the point) and kept at any distance, including from inside
 * the disc. One back-face box draw per drawn portrait: the PORTRAIT_MAX_DRAWS largest on screen each
 * frame; the impostor pass draws every other one (`select` gives it the per-frame mask). This module,
 * looks.json and gallery-facts.json load lazily after the catalogue (off the startup path). Face-on maps and
 * bulge tables are baked lazily on the CPU the first time a galaxy qualifies (128² on potato, 256²
 * otherwise), cached (PORTRAIT_CACHE) and uploaded as half-float textures. Photometry: with dust off
 * the integrated flux equals the catalogue's (same E as the points and impostors).
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  Group,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RedFormat,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import {
  ROOT_FRAME,
  SSB_FRAME,
  type QualityPreset,
  type Quatd,
  type Renderable,
  type ViewState,
} from '../../core/contracts';
import { qrotate, qset, quat, vec3 } from '../../core/math64';
import { LUX_MAG0 } from '../../core/photometry';
import { KPC, MPC } from '../../core/units';
import { NOISE_GLSL } from '../../render/chunks';
import { skyWeight } from '../milkyway/public';
import { galaxyQuat, type GalaxyData } from './format';
import { measuredForPortrait } from './facts';
import looksJson from './looks.json';
import { GALLERY } from './named';
import portraitShader from './portrait.glsl?raw';
import {
  buildPortraitModel,
  LUT_N,
  skyAimAzimuth,
  tiltToInclination,
  type PortraitModel,
} from './portrait-model';
import {
  derivePortraitParams,
  type PortraitLook,
  type PortraitMeasured,
  type PortraitParams,
} from './portrait-params';
import { IMPOSTOR_HI, IMPOSTOR_LO, PANO_MAG } from './renderables';

export interface PortraitEntry {
  /** Named-galaxy id (looks.json key). */
  id: string;
  /** Catalogue row. */
  index: number;
  measured?: PortraitMeasured;
}

export interface PortraitLayer extends Renderable {
  visible: boolean;
  /** Catalogue indices that have a portrait. */
  readonly indices: ReadonlySet<number>;
  /**
   * Chooses (and bakes) this frame's portraits; returns a per-catalogue-row mask of the galaxies drawn
   * as portraits, which the impostor pass skips. Computed once per frame, whichever layer asks first.
   */
  select(view: ViewState): Uint8Array;
}

/** Most portrait draws per frame (the nearest / largest win). */
export const PORTRAIT_MAX_DRAWS = 8;
/** Baked maps kept resident. */
export const PORTRAIT_CACHE = 8;
/** Map size by preset. */
export const portraitMapSize = (preset: QualityPreset): number => (preset === 'potato' ? 128 : 256);

const LOOKS = (looksJson as unknown as { looks: Record<string, PortraitLook> }).looks;

/** Styling row of a named galaxy (simulated values), if any. */
export const portraitLook = (id: string): PortraitLook | undefined => LOOKS[id];

/** Entries for the 54 gallery galaxies with their measured inputs (gallery-facts.json, sanity-checked). */
export function galleryPortraitEntries(): PortraitEntry[] {
  return GALLERY.map((g) => ({ id: g.id, index: g.index, measured: measuredForPortrait(g).measured }));
}

/** Frames the warm-up mesh stays in the scene so the shader program links before the first portrait. */
const WARM_FRAMES = 240;

export const portraitIndices = (entries: readonly PortraitEntry[]): Set<number> =>
  new Set(entries.map((e) => e.index));

/** Pure parameter derivation for a catalogue row (+ optional measured inputs and styling). */
export function portraitParamsFor(data: GalaxyData, e: PortraitEntry): PortraitParams {
  const i = e.index;
  return derivePortraitParams({
    index: i,
    type: data.type[i],
    radiusKpc: data.radiusKpc[i],
    absMag: data.absMag[i],
    measured: e.measured,
    look: LOOKS[e.id],
  });
}

/** Rotates universe-axes vector v into galaxy-local axes (q: local → universe, [x, y, z, w]). */
function toLocal(q: readonly number[], v: readonly number[]): [number, number, number] {
  const o = vec3();
  qrotate(o, { x: -q[0], y: -q[1], z: -q[2], w: q[3] }, vec3(v[0], v[1], v[2]));
  return [o.x, o.y, o.z];
}

/** Float32 → half-float mip chain (2×2 box filter), RGBA or single channel. */
function halfMips(
  src: Float32Array,
  size: number,
  ch: number,
): { data: Uint16Array; width: number; height: number }[] {
  const out: { data: Uint16Array; width: number; height: number }[] = [];
  let cur = src;
  let n = size;
  for (;;) {
    const h = new Uint16Array(n * n * ch);
    for (let k = 0; k < h.length; k++) h[k] = DataUtils.toHalfFloat(cur[k]);
    out.push({ data: h, width: n, height: n });
    if (n === 1) break;
    const m = n >> 1;
    const next = new Float32Array(m * m * ch);
    for (let j = 0; j < m; j++)
      for (let i = 0; i < m; i++)
        for (let c = 0; c < ch; c++)
          next[(j * m + i) * ch + c] =
            0.25 *
            (cur[(2 * j * n + 2 * i) * ch + c] +
              cur[(2 * j * n + 2 * i + 1) * ch + c] +
              cur[((2 * j + 1) * n + 2 * i) * ch + c] +
              cur[((2 * j + 1) * n + 2 * i + 1) * ch + c]);
    cur = next;
    n = m;
  }
  return out;
}

interface Slot {
  entry: PortraitEntry;
  params: PortraitParams;
  /** Galaxy-local → universe rotation (after any inclination correction). */
  q: number[];
  model: PortraitModel | null;
  map: DataTexture | null;
  lut: DataTexture | null;
  bytes: number;
  mesh: Mesh | null;
  material: ShaderMaterial | null;
  lastUsed: number;
  /** This frame's crossfade weight and ranking key. */
  w: number;
  rank: number;
}

export function createPortraitLayer(
  data: GalaxyData,
  entries: readonly PortraitEntry[],
  quality: { readonly preset: QualityPreset },
): PortraitLayer {
  const group = new Group();
  const box = new BoxGeometry(2, 2, 2);
  const indices = portraitIndices(entries);
  const slots: Slot[] = entries
    .filter((e) => e.index >= 0 && e.index < data.count)
    .map((entry) => ({
      entry,
      params: portraitParamsFor(data, entry),
      q: galaxyQuat(data, entry.index, [0, 0, 0, 1]),
      model: null,
      map: null,
      lut: null,
      bytes: 0,
      mesh: null,
      material: null,
      lastUsed: -1,
      w: 0,
      rank: 0,
    }));
  let frame = 0;
  let bytes = 0;
  const drawn = new Uint8Array(data.count);
  let selectedFrame = -1;
  const live: Slot[] = [];

  // cosmos:no-depth (background layer: galaxy portraits are composited additively behind everything)
  const makeMaterial = (uniforms: Record<string, IUniform>) =>
    new ShaderMaterial({
      vertexShader: `#define COSMOS_VERTEX\n${portraitShader}`,
      fragmentShader: `#define LUT_N ${LUT_N}\n${NOISE_GLSL}\n${portraitShader}`,
      uniforms,
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  // Warm-up: a degenerate (zero-area) mesh with the same program, visible for the first frames so the
  // renderer links the program in the background before any portrait needs it.
  const dummy = new DataTexture(new Uint16Array(4), 1, 1, RGBAFormat, HalfFloatType);
  dummy.generateMipmaps = false;
  dummy.minFilter = dummy.magFilter = LinearFilter;
  dummy.needsUpdate = true;
  const warmMat = makeMaterial({
    uMap: { value: dummy },
    uLut: { value: dummy },
    uHalf: { value: new Vector3(1, 1, 1) },
  });
  const warm = new Mesh(box, warmMat);
  warm.frustumCulled = false;
  warm.scale.setScalar(1e-30);
  warm.position.set(0, 0, -1);
  warm.renderOrder = -10.4;
  group.add(warm);

  const posOf = (i: number): number[] => [data.pos[3 * i], data.pos[3 * i + 1], data.pos[3 * i + 2]];

  /** Builds the model and textures for a slot (synchronous, deterministic). */
  function bake(s: Slot, sun: number[]): void {
    const p = s.params;
    const gp = posOf(s.entry.index);
    // Line of sight from the galaxy to the Sun (universe axes).
    const los = [sun[0] - gp[0], sun[1] - gp[1], sun[2] - gp[2]];
    if (p.inclinationDeg !== null)
      s.q = tiltToInclination(galaxyQuat(data, s.entry.index), los, p.inclinationDeg);
    const lv = toLocal(s.q, los);
    const ll = Math.hypot(lv[0], lv[1], lv[2]) || 1;
    const losLocal: [number, number, number] = [lv[0] / ll, lv[1] / ll, lv[2] / ll];
    let tailAngleRad: number | undefined;
    const to = p.tail?.toIndex;
    if (to !== undefined && to >= 0 && to < data.count) {
      const cp = posOf(to);
      tailAngleRad = skyAimAzimuth(toLocal(s.q, [cp[0] - gp[0], cp[1] - gp[1], cp[2] - gp[2]]), losLocal);
    }
    const size = portraitMapSize(quality.preset);
    const m = buildPortraitModel(p, size, { losLocal, tailAngleRad });
    s.model = m;
    const mips = halfMips(m.map, size, 4);
    const map = new DataTexture(mips[0].data, size, size, RGBAFormat, HalfFloatType);
    map.mipmaps = mips;
    map.generateMipmaps = false;
    map.minFilter = LinearMipmapLinearFilter;
    map.magFilter = LinearFilter;
    map.wrapS = map.wrapT = ClampToEdgeWrapping;
    map.needsUpdate = true;
    const lutData = new Uint16Array(LUT_N * LUT_N);
    for (let k = 0; k < lutData.length; k++) lutData[k] = DataUtils.toHalfFloat(m.lut[k]);
    const lut = new DataTexture(lutData, LUT_N, LUT_N, RedFormat, HalfFloatType);
    lut.minFilter = lut.magFilter = LinearFilter;
    lut.generateMipmaps = false;
    lut.wrapS = lut.wrapT = ClampToEdgeWrapping;
    lut.needsUpdate = true;
    s.map = map;
    s.lut = lut;
    s.bytes = Math.round((size * size * 8 * 4) / 3) + LUT_N * LUT_N * 2;
    bytes += s.bytes;
    const col = (c: readonly number[], a: number) => new Vector3(c[0] * a, c[1] * a, c[2] * a);
    const u: Record<string, IUniform> = {
      uHalf: { value: new Vector3(m.half[0], m.half[1], m.half[2]) },
      uMap: { value: map },
      uLut: { value: lut },
      uCam: { value: new Vector3() },
      uGain: { value: 0 },
      uPixAngle: { value: 1e-3 },
      uSteps: { value: 24 },
      uMapExtent: { value: m.gExtent },
      uMapTexel: { value: (2 * m.gExtent) / size },
      uMapRc: { value: m.mapWarpKpc },
      uOuterSteps: { value: m.outerSteps },
      uLutMax: { value: m.lutMax },
      uSlabHalf: { value: m.slabHalf },
      uCylR: { value: m.cylR },
      uH: { value: new Vector4(p.hOldKpc, p.hYoungKpc, p.hDustKpc, p.hHiiKpc) },
      uBulgeFlat: { value: p.bulgeFlat },
      uWarp: {
        value: new Vector4(
          p.warpAmpKpc,
          p.warpStartKpc,
          Math.max(p.radiusKpc - p.warpStartKpc, 1e-3),
          p.warpAngleRad,
        ),
      },
      uColBulge: { value: col(p.colors.bulge, m.amp.bulge) },
      uColOld: { value: col(p.colors.old, m.amp.old) },
      uColYoung: { value: col(p.colors.young, m.amp.young) },
      uColHii: { value: col(p.colors.hii, m.amp.hii) },
      uColPolar: { value: col(p.polar?.color ?? [0, 0, 0], m.amp.polar) },
      uRedden: { value: new Vector3(p.redden[0], p.redden[1], p.redden[2]) },
      uPolarAxis: { value: new Vector3(...(m.polarAxis ?? [0, 0, 1])) },
      uPolar: {
        value: new Vector4(
          p.polar?.lengthKpc ?? 1,
          p.polar?.widthKpc ?? 1,
          Math.tan(((p.polar?.openingDeg ?? 0) * Math.PI) / 180),
          p.polar ? (p.polar.kind === 'cones' ? 1 : 2) : 0,
        ),
      },
      uDetail: { value: 1 / (0.9 * ((2 * m.gExtent) / size)) },
      uSeed: { value: (s.entry.index % 997) + 0.37 },
    };
    if (!s.material) {
      s.material = makeMaterial(u);
      s.mesh = new Mesh(box, s.material);
      s.mesh.frustumCulled = false;
      s.mesh.renderOrder = -10.4;
      s.mesh.visible = false;
      group.add(s.mesh);
    } else Object.assign(s.material.uniforms, u);
  }

  function evict(s: Slot): void {
    s.map?.dispose();
    s.lut?.dispose();
    s.map = s.lut = null;
    s.model = null;
    bytes -= s.bytes;
    s.bytes = 0;
    if (s.mesh) s.mesh.visible = false;
  }

  const t = vec3();
  const cam = vec3();
  const zero = vec3();
  const q: Quatd = quat();
  const qi: Quatd = quat();
  const rel = vec3();
  const loc = vec3();
  const qg: Quatd = quat();

  const self: PortraitLayer = {
    id: 'galaxies.portraits',
    layer: 'background',
    object: group,
    visible: true,
    indices,
    select(view) {
      if (selectedFrame === view.frameIndex) return drawn;
      selectedFrame = view.frameIndex;
      frame++;
      for (const s of live) drawn[s.entry.index] = 0;
      live.length = 0;
      if (!self.visible) return drawn;
      view.frameQuat(ROOT_FRAME, q);
      group.quaternion.set(q.x, q.y, q.z, q.w);
      // Camera and Sun in universe axes, Mpc (float64), as renderables.ts.
      qset(qi, -q.x, -q.y, -q.z, q.w);
      view.toCamera(ROOT_FRAME, zero, t);
      qrotate(cam, qi, t);
      cam.x = -cam.x / MPC;
      cam.y = -cam.y / MPC;
      cam.z = -cam.z / MPC;
      view.toCamera(SSB_FRAME, zero, t);
      const dSun = Math.hypot(t.x, t.y, t.z);
      qrotate(t, qi, t);
      const sun = [cam.x + t.x / MPC, cam.y + t.y / MPC, cam.z + t.z / MPC];
      const pano = skyWeight(dSun);
      // Crossfade weights (same rules as the impostor, without its near fade-out).
      for (const s of slots) {
        const i = s.entry.index;
        const dx = data.pos[3 * i] - cam.x;
        const dy = data.pos[3 * i + 1] - cam.y;
        const dz = data.pos[3 * i + 2] - cam.z;
        const d = Math.max(Math.hypot(dx, dy, dz), 1e-12);
        const R = data.radiusKpc[i] * 1e-3;
        const rpx = R / (d * view.pixelAngle);
        const x = Math.min(1, Math.max(0, (rpx - IMPOSTOR_LO) / (IMPOSTOR_HI - IMPOSTOR_LO)));
        let w = x * x * (3 - 2 * x);
        const sd = Math.hypot(
          data.pos[3 * i] - sun[0],
          data.pos[3 * i + 1] - sun[1],
          data.pos[3 * i + 2] - sun[2],
        );
        if (data.absMag[i] + 25 + 5 * Math.log10(Math.max(sd, 1e-9)) < PANO_MAG) w *= pano;
        s.w = w;
        s.rank = rpx;
        if (s.mesh) s.mesh.visible = false;
        if (w >= 1e-3) live.push(s);
      }
      // The largest on screen get portraits; the rest stay impostors.
      live.sort((a, b) => b.rank - a.rank);
      live.length = Math.min(live.length, PORTRAIT_MAX_DRAWS);
      // Bake what is missing (all at once in tests; otherwise one per frame to bound the hitch).
      let budget = view.test ? live.length : 1;
      for (const s of live) {
        if (s.model) continue;
        if (budget-- <= 0) break;
        const resident = slots.filter((o) => o.model);
        if (resident.length >= PORTRAIT_CACHE) {
          const victim = resident.filter((o) => !live.includes(o)).sort((a, b) => a.lastUsed - b.lastUsed)[0];
          if (victim) evict(victim);
        }
        bake(s, sun);
      }
      // Not baked yet (bake budget): drawn by the impostor this frame.
      for (let k = live.length - 1; k >= 0; k--) if (!live[k].model) live.splice(k, 1);
      for (const s of live) drawn[s.entry.index] = 1;
      return drawn;
    },
    update(view) {
      group.visible = self.visible;
      if (!self.visible) return;
      self.select(view);
      warm.visible = frame <= WARM_FRAMES;
      view.frameQuat(ROOT_FRAME, q);
      qset(qi, -q.x, -q.y, -q.z, q.w);
      view.toCamera(ROOT_FRAME, zero, t);
      qrotate(cam, qi, t);
      cam.x = -cam.x / MPC;
      cam.y = -cam.y / MPC;
      cam.z = -cam.z / MPC;
      const unit = (m: PortraitModel) => (Math.max(m.half[0], m.half[2]) * KPC) / 1e6; // metres per scene unit
      for (const s of live) {
        const m = s.model;
        const mesh = s.mesh;
        if (!m || !mesh || !s.material) continue;
        s.lastUsed = frame;
        const i = s.entry.index;
        // Galaxy centre relative to the camera, universe axes (float64), then scaled scene units.
        rel.x = (data.pos[3 * i] - cam.x) * MPC;
        rel.y = (data.pos[3 * i + 1] - cam.y) * MPC;
        rel.z = (data.pos[3 * i + 2] - cam.z) * MPC;
        const us = unit(m);
        mesh.position.set(rel.x / us, rel.y / us, rel.z / us);
        qset(qg, s.q[0], s.q[1], s.q[2], s.q[3]);
        mesh.quaternion.set(qg.x, qg.y, qg.z, qg.w);
        mesh.scale.set((m.half[0] * KPC) / us, (m.half[1] * KPC) / us, (m.half[2] * KPC) / us);
        // Camera in galaxy-local kpc (float64 → float32 uniform).
        qset(qi, -qg.x, -qg.y, -qg.z, qg.w);
        rel.x = -rel.x / KPC;
        rel.y = -rel.y / KPC;
        rel.z = -rel.z / KPC;
        qrotate(loc, qi, rel);
        const u = s.material.uniforms;
        (u.uCam.value as Vector3).set(loc.x, loc.y, loc.z);
        u.uGain.value = LUX_MAG0 * view.exposure * 10 ** (-0.4 * (data.absMag[i] + 25)) * 1e6 * s.w;
        u.uPixAngle.value = view.pixelAngle;
        u.uSteps.value = view.knobs.volumeSteps;
        mesh.visible = true;
      }
    },
    memoryBytes: () => bytes + 1024,
    dispose() {
      for (const s of slots) {
        evict(s);
        s.material?.dispose();
      }
      warmMat.dispose();
      dummy.dispose();
      box.dispose();
    },
  };
  return self;
}
