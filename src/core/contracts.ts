/**
 * Frozen after Phase 1 — only optional fields may be added.
 *
 * Cosmos plug-in contract (DESIGN.md section 3.4). Frozen by the R1 integrator at the end of Phase 1:
 * existing members keep their names, types and semantics; new members must be optional.
 * Need a change? Write docs/requests/<pkg>.md and shim inside your own module.
 *
 * Conventions used throughout:
 * - Distances are metres, times are seconds, angles are radians, all as float64 `number`.
 * - `JD` is a Julian Date in TT (Terrestrial Time). UTC conversion (ΔT) lives in SimClock.
 * - World axes = ICRF/J2000 equatorial (the axes of the `ssb` frame). Every vector a
 *   helper returns "in world axes" uses them, independently of the camera's anchor frame.
 * - Camera-relative rendering: the three.js camera sits at the origin and only rotates;
 *   Renderables place objects at Float32(toCamera(frame, local)).
 * - Shaders output luminance in cd/m² multiplied by `uExposure` (pre-exposure) and must
 *   include `src/render/chunks/depth.glsl` (logarithmic depth).
 *
 * This file contains types plus a few settled constants; no runtime logic.
 */
import type * as THREE from 'three';

// ---------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------

/** Frame identifier, e.g. 'universe', 'mw', 'ssb', 'earth', 'earth.fixed', 'star:32349', 'bh:sgra', 'gal:m31'. */
export type FrameId = string;
/** Julian Date in TT, float64. */
export type JD = number;

/** Float64 vector. Metres unless stated otherwise. Mutable: helpers write into `out` params. */
export interface Vec3d {
  x: number;
  y: number;
  z: number;
}

/** Float64 unit quaternion (x, y, z, w). Rotates vectors by v' = q v q*. */
export interface Quatd {
  x: number;
  y: number;
  z: number;
  w: number;
}

// ---------------------------------------------------------------------------------------
// Settled constants (DESIGN 3.2). Never change after P1.
// ---------------------------------------------------------------------------------------

/** Root of the frame tree: supergalactic axes, origin at the Milky Way centre. */
export const ROOT_FRAME: FrameId = 'universe';
/** Milky Way frame: IAU galactic axes, origin at Sgr A*. Parent: universe. */
export const MW_FRAME: FrameId = 'mw';
/** Solar System barycentre: ICRF/J2000 equatorial axes (= world axes). Parent: mw. */
export const SSB_FRAME: FrameId = 'ssb';
/** Body frame id convention: inertial frame id = body id; body-fixed frame = `${id}.fixed`. */
export const FIXED_SUFFIX = '.fixed';

/** Camera near plane, metres. */
export const CAMERA_NEAR = 0.05;
/** Camera far plane, metres (log depth: relative precision about 4e-6). */
export const CAMERA_FAR = 1e27;
/** Speed clamp, m/s (DESIGN 3.2 Speed). */
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 1e27;

/**
 * Time-warp ladder in sim seconds per real second (positive half; negative rates mirror it).
 * 0 = paused, 1 = real time, ..., 1e13 ≈ 300 kyr/s.
 */
export const WARP_LADDER: readonly number[] = [0, 1, 60, 3600, 86400, 2.6e6, 3.15e7, 3.15e9, 3.15e11, 1e13];

/** Quality preset names in ascending cost. */
export const QUALITY_PRESETS = ['potato', 'low', 'medium', 'high', 'ultra'] as const;

// ---------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------

/**
 * A node of the Float64 frame tree (DESIGN 3.2).
 *
 * `positionAt` returns this frame's origin in the PARENT frame's coordinates (parent axes,
 * metres). `orientationAt` returns the rotation taking vectors from THIS frame's axes into
 * the PARENT's axes (v_parent = q · v_this). Frames without `orientationAt` share the
 * parent's axes (e.g. inertial body frames under `ssb`).
 */
export interface FrameDef {
  id: FrameId;
  parent: FrameId | null;
  /** Radius (m) within which the camera anchors to this frame (re-anchoring uses 10% hysteresis). */
  influenceRadius: number;
  positionAt(jd: JD, out: Vec3d): Vec3d;
  orientationAt?(jd: JD, out: Quatd): Quatd;
}

/**
 * The frame tree service (implemented in src/core/frames.ts).
 *
 * All transforms walk up to the lowest common ancestor (LCA) and subtract only local offsets,
 * so precision is bounded by the scale of the LCA, not of the root. Results are cached per jd.
 */
export interface FrameTree {
  /** Always ROOT_FRAME. */
  readonly rootId: FrameId;
  /** Adds a frame. Throws if the id exists or the parent is unknown. */
  addFrame(f: FrameDef): void;
  /** Removes a leaf frame created on demand (promoted stars). Throws if it has children. */
  removeFrame(id: FrameId): void;
  has(id: FrameId): boolean;
  get(id: FrameId): FrameDef | undefined;
  /** Direct children ids. */
  children(id: FrameId): readonly FrameId[];
  /** Ids from the root down to `id` inclusive. */
  path(id: FrameId): readonly FrameId[];
  /** Lowest common ancestor of two frames. */
  lca(a: FrameId, b: FrameId): FrameId;
  /** Vector from the origin of `a` to the origin of `b` at `jd`, world axes, metres. */
  relative(a: FrameId, b: FrameId, jd: JD, out: Vec3d): Vec3d;
  /**
   * Vector from point `aLocal` (in frame `a` coordinates) to point `bLocal` (in frame `b`
   * coordinates), world axes. The precision workhorse behind every toCamera helper.
   */
  delta(a: FrameId, aLocal: Vec3d, b: FrameId, bLocal: Vec3d, jd: JD, out: Vec3d): Vec3d;
  /** Point `local` given in frame `from` re-expressed in frame `to` coordinates (to's axes). */
  convertPoint(from: FrameId, local: Vec3d, to: FrameId, jd: JD, out: Vec3d): Vec3d;
  /** Rotation taking vectors from `frame` axes into world axes at `jd`. */
  orientation(frame: FrameId, jd: JD, out: Quatd): Quatd;
  /** Rotates a direction from `frame` axes into world axes. */
  toWorldDir(frame: FrameId, v: Vec3d, jd: JD, out: Vec3d): Vec3d;
  /** Rotates a world-axes direction into `frame` axes. */
  fromWorldDir(frame: FrameId, v: Vec3d, jd: JD, out: Vec3d): Vec3d;
  /**
   * Deepest frame whose influence sphere contains the point (`local` in frame `from`).
   * `current` + `hysteresis` (default 0.1) keep the current anchor until the point is
   * beyond (1 + hysteresis) × its influence radius.
   */
  findAnchor(from: FrameId, local: Vec3d, jd: JD, current?: FrameId, hysteresis?: number): FrameId;
  /**
   * Camera helper: vector from the camera (`cam.frame`, `cam.local`) to point `local` in
   * `frame`, world axes. Renderables use ViewState.toCamera, which binds cam and jd.
   */
  toCamera(cam: { frame: FrameId; local: Vec3d }, frame: FrameId, local: Vec3d, jd: JD, out: Vec3d): Vec3d;
}

// ---------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------

/**
 * Declares where a model is valid in time (DESIGN 3.2 Time). The time bar shows a badge
 * for every range whose `appliesTo` is visible and reports `beyond` outside [jdMin, jdMax].
 */
export interface ValidityRange {
  id: string;
  /** What the range covers, e.g. 'planets', 'stars.proper-motion', 'galactic-rotation'. */
  appliesTo: string;
  /** Model name for the badge, e.g. 'astronomy-engine VSOP87', 'linear proper motion'. */
  model: string;
  jdMin: JD;
  jdMax: JD;
  /** What happens outside the range. */
  beyond: 'frozen' | 'extrapolated' | 'hidden' | 'approximate';
  /** Citation or note. */
  source?: string;
}

/** Validity of one range at the current instant. */
export interface ValidityStatus {
  range: ValidityRange;
  inside: boolean;
}

/**
 * Simulation clock (src/core/time.ts). TT Julian Date as float64. Only the app loop calls
 * `tick`; modules read `jd` (or ViewState.jd) and never advance time themselves.
 */
export interface SimClock {
  /** Current instant, JD TT. */
  readonly jd: JD;
  /** Sim seconds per real second; negative runs backwards; 0 when paused. */
  readonly rate: number;
  readonly paused: boolean;
  /** WARP_LADDER (positive half). */
  readonly warpLadder: readonly number[];
  setRate(rate: number): void;
  /** Steps along ±WARP_LADDER: +1 faster/forward, -1 slower/backward. */
  warpStep(direction: 1 | -1): void;
  pause(): void;
  resume(): void;
  /** Jump to an instant: JD TT, a Date, or an ISO-8601 UTC string. */
  setTime(t: JD | Date | string): void;
  /** Jump to the current wall-clock instant. */
  setNow(): void;
  /** Advances by `dtReal` seconds (app loop only); returns dtSim in seconds. */
  tick(dtReal: number): number;
  /** UTC Date of the current instant (via ΔT). Outside the Date range returns null. */
  toDate(jd?: JD): Date | null;
  /** UTC JD → TT JD and back (ΔT applied). */
  utcToTt(jdUtc: JD): JD;
  ttToUtc(jdTt: JD): JD;
  /** Validity status of every registered ValidityRange at `jd` (default: now). */
  validity(jd?: JD): readonly ValidityStatus[];
  /** Notified on setTime/setRate/pause/resume (not on every tick). Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
}

// ---------------------------------------------------------------------------------------
// Bodies, bookmarks
// ---------------------------------------------------------------------------------------

export type BodyKind =
  | 'star'
  | 'planet'
  | 'dwarf'
  | 'moon'
  | 'minor'
  | 'comet'
  | 'blackhole'
  | 'spacecraft'
  | 'galaxy'
  | 'cluster';

/** A physical object you can select, fly to and (usually) land on. */
export interface Body {
  /** Unique, lowercase, e.g. 'earth', 'titan', 'sgra', 'hip:32349'. */
  id: string;
  name: string;
  kind: BodyKind;
  /** Inertial frame (origin = body centre). Conventionally the same as `id`. */
  frame: FrameId;
  /** Body-fixed rotating frame (IAU pole and W(t)), conventionally `${id}.fixed`. */
  fixedFrame?: FrameId;
  /** Parent body id (planet for a moon, star for a planet). */
  parent?: string;
  /** Mean (equatorial for oblate bodies) radius, m. Black holes: Schwarzschild radius. */
  radius: number;
  /** Flattening f = (a - c) / a. */
  oblateness?: number;
  /** Gravitational parameter GM, m³/s². Drives walk-mode gravity g = GM/R². */
  gm?: number;
  /** Camera anchoring radius, m (also used for speed and label culling). */
  influenceRadius: number;
  /** Geometric albedo (photometric points: flux ∝ albedo · πR² · phase). */
  albedo?: number;
  /** Effective temperature, K (stars, disks). */
  teff?: number;
  /** Absolute visual magnitude M_V (stars, galaxies). */
  absMag?: number;
  /** True when appearance is procedural/artistic; the UI labels it "simulated". */
  simulated?: boolean;
  /** Label declutter priority, higher wins (default: derived from kind and size). */
  labelPriority?: number;
}

/**
 * A saved view. Ids are kebab-case and globally unique (e.g. 'earth-now', 'sgra-lensing').
 * Deep link: `#b=<id>`. E2E: `?test=1&q=potato&b=<id>`.
 */
export interface Bookmark {
  id: string;
  title: string;
  /** Frame `pos` is expressed in. */
  frame: FrameId;
  /** Camera position in `frame` coordinates, m. */
  pos: Vec3d;
  /** Camera orientation relative to `frame` axes. Omitted: look at `lookAt`. */
  quat?: Quatd;
  /** Body id to face (and orbit) on arrival. */
  lookAt?: string;
  /** Instant to set on arrival ('now' = wall clock). Omitted: keep the current time. */
  jd?: JD | 'now';
  /** Fixed exposure EV100 used in test mode (and photo presets). */
  ev?: number;
  /** What a reviewer should see in the screenshot (plain text). */
  lookTarget?: string;
  /** Vertical field of view, radians. */
  fovY?: number;
  /** Camera mode on arrival (e.g. 'walk' for surface bookmarks). */
  mode?: CameraMode;
  /** Time rate on arrival, sim s per real s. */
  rate?: number;
}

// ---------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------

export type QualityPreset = (typeof QUALITY_PRESETS)[number];

/**
 * Numeric knobs of a preset (values live in src/core/quality.ts). DESIGN 3.3 values:
 * terrainTileCap 64/192/384/768/1024, gpuBudgetMB 128 (potato, low), 256 (medium), 512 (high, ultra).
 */
export interface QualityKnobs {
  preset: QualityPreset;
  /** Multiplier on the CSS-pixel canvas size, 0.25..1 (potato renders exactly the viewport). */
  renderScale: number;
  /** Upper bound applied to window.devicePixelRatio. */
  maxPixelRatio: number;
  /** Atmosphere raymarch steps (sky-view and aerial perspective LUTs). */
  atmosphereSteps: number;
  /** Black-hole lensing RK4 steps (64/128/256 by preset; potato uses the minimum). */
  lensingSteps: number;
  /** Galaxy/volume raymarch steps (24/48/96/160). */
  volumeSteps: number;
  /** Max points for procedural point clouds (star sectors, tracers), per module. */
  pointBudget: number;
  /** Terrain screen-space-error target, px. */
  terrainSse: number;
  /** Max resident terrain tiles. */
  terrainTileCap: number;
  /** Largest texture edge to request (2048 / 4096 / 8192). */
  maxTextureSize: number;
  /** ResourceBudget cap, MB. */
  gpuBudgetMB: number;
  bloom: boolean;
  smaa: boolean;
  /** Temporal accumulation (always off in test mode). */
  temporal: boolean;
}

/** Current quality (src/core/quality.ts). `?q=<preset>` selects it at boot. */
export interface QualityState {
  readonly preset: QualityPreset;
  readonly knobs: Readonly<QualityKnobs>;
  /** Dynamic resolution factor 0.5..1 applied on top of renderScale (P5 PID loop; 1 in tests). */
  readonly dynamicScale: number;
  set(preset: QualityPreset): void;
  setDynamicScale(s: number): void;
  subscribe(listener: (knobs: Readonly<QualityKnobs>) => void): () => void;
}

/**
 * Per-frame view description passed to every update/render hook. Valid only during the
 * call; do not store it. All vectors are world axes unless noted.
 */
export interface ViewState {
  /** Current instant, JD TT. */
  jd: JD;
  /** Real seconds since the previous frame (fixed 1/60 in test mode). */
  dtReal: number;
  /** Sim seconds advanced this frame. */
  dtSim: number;
  /** Monotonic real time since boot, s (deterministic in test mode); for animations. */
  timeReal: number;
  /** Frame counter since boot. */
  frameIndex: number;
  /** Camera anchor frame. */
  frame: FrameId;
  /** Camera position in `frame` coordinates. */
  cameraLocal: Vec3d;
  /** Camera orientation relative to `frame` axes. */
  cameraQuat: Quatd;
  /** Camera orientation in world axes (what the three.js camera uses). */
  worldQuat: Quatd;
  /** The render camera (origin, rotation only); read its projection matrices, never move it. */
  camera: THREE.PerspectiveCamera;
  /** Vertical field of view, radians. */
  fovY: number;
  /** Drawing-buffer size in device pixels. */
  viewport: [number, number];
  /** Angle subtended by one pixel, radians (photometric point LOD, label culling). */
  pixelAngle: number;
  /** Current pre-exposure multiplier (shaders output L[cd/m²] · exposure). */
  exposure: number;
  quality: QualityPreset;
  knobs: Readonly<QualityKnobs>;
  /** True under ?test=1: deterministic time, no temporal accumulation, budgets lifted. */
  test: boolean;
  /** Vector from the camera to `local` in `frame`, world axes, m. */
  toCamera(frame: FrameId, local: Vec3d, out: Vec3d): Vec3d;
  /** Vector from the camera to the Sun's centre, world axes, m. */
  sunToCamera(out: Vec3d): Vec3d;
  /** Rotation taking `frame` axes into world axes at `jd` (orient body-fixed meshes). */
  frameQuat(frame: FrameId, out: Quatd): Quatd;
  /** Nearest body surface (radius + terrain) and altitude above it, m. */
  nearestSurface(): { bodyId: string; altitude: number } | null;
}

/** Scene layer of a Renderable (DESIGN 3.3 frame pipeline). */
export type RenderLayer = 'background' | 'opaque' | 'transparent' | 'overlay';

/**
 * Anything drawn. The engine adds `object` to the scene for `layer` and calls `update`
 * once per frame before rendering (set position = Float32(view.toCamera(...)) here).
 */
export interface Renderable {
  /** Unique, e.g. 'stars.points', 'solar-system.orbit.mars'. */
  id: string;
  /** background: no depth, additive HDR; opaque/transparent: main scene with log depth; overlay: drawn last, no post. */
  layer: RenderLayer;
  object: THREE.Object3D;
  update(view: ViewState): void;
  /** GPU bytes held (geometry + textures + targets); reported to ResourceBudget and stats(). */
  memoryBytes(): number;
  /** Frees every GPU resource. Called on removal and at shutdown. */
  dispose(): void;
}

/**
 * Full-screen pass hosted by src/render/screenpass-host.ts, run between the main scene and
 * the EffectPass. Stages run in order atmosphere → lensing → effects; within a stage by
 * ascending `order`. The host ping-pongs HalfFloat targets: read `input`, write `output`.
 * Inactive passes are skipped without a copy.
 */
export interface ScreenPass {
  id: string;
  stage: 'atmosphere' | 'lensing' | 'effects';
  order: number;
  active(view: ViewState): boolean;
  /**
   * `depth` is the main scene's log depth (decode with linearFromLogDepth from depth.glsl;
   * background pixels have depth 1). Reconstruct view rays from view.camera matrices.
   */
  render(
    gl: THREE.WebGLRenderer,
    input: THREE.WebGLRenderTarget,
    depth: THREE.DepthTexture,
    output: THREE.WebGLRenderTarget,
    view: ViewState,
  ): void;
  /** Called on resize with the full-resolution drawing-buffer size (allocate half-res targets here). */
  setSize?(width: number, height: number): void;
  /** GPU bytes held by private targets/LUTs. */
  memoryBytes?(): number;
  dispose?(): void;
}

/** Uniform objects shared by reference: splice them into a material's `uniforms` and the renderer updates them once per frame. */
export interface SharedUniforms {
  /** Pre-exposure multiplier. */
  uExposure: THREE.IUniform<number>;
  /** CAMERA_FAR, for linearFromLogDepth. */
  uLogDepthFar: THREE.IUniform<number>;
  /** Drawing-buffer size in pixels. */
  uResolution: THREE.IUniform<THREE.Vector2>;
  /** timeReal, s. */
  uTime: THREE.IUniform<number>;
  /** Blackbody LUT 1000-40000 K → linear sRGB (DataTexture, 256 entries). */
  uBlackbodyLut: THREE.IUniform<THREE.Texture | null>;
  /** Tiling blue-noise texture (null until loaded). */
  uBlueNoise: THREE.IUniform<THREE.Texture | null>;
}

/** Exposure control (src/render/exposure.ts). EV is EV100; exposure = 1 / (1.2 · 2^EV). */
export interface ExposureControl {
  /** Current multiplier written to uExposure. */
  readonly value: number;
  /** Current EV100. */
  readonly ev: number;
  /** Fix the exposure (tests, photo mode) or pass null to return to eye adaptation. */
  setFixedEV(ev: number | null): void;
  /** Exposure compensation in stops, added to the metered EV (photo mode). */
  compensation: number;
}

/** renderer.info snapshot plus engine counters (also returned by __universe.stats()). */
export interface RenderStats {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  programs: number;
  textures: number;
  geometries: number;
  /** Resident terrain tiles (0 before P2). */
  tiles: number;
  /** ResourceBudget total, bytes. */
  gpuBytes: number;
  /** Frames rendered since boot. */
  frame: number;
}

/** Options for RenderApi.captureCube. */
export interface CubeCaptureOptions {
  frame: FrameId;
  local: Vec3d;
  target: THREE.WebGLCubeRenderTarget;
  /** Layers to draw (default ['background']). */
  layers?: RenderLayer[];
  /** Faces to render this call (time slicing), default all 6. */
  faces?: number[];
}

/**
 * Renderer facade (src/render/renderer.ts). Renderables and ScreenPasses are added through
 * the Registry, never directly to the scenes.
 */
export interface RenderApi {
  readonly renderer: THREE.WebGLRenderer;
  readonly scenes: {
    readonly background: THREE.Scene;
    readonly main: THREE.Scene;
    readonly overlay: THREE.Scene;
  };
  /** The render camera: at the origin, rotation only, near CAMERA_NEAR, far CAMERA_FAR. */
  readonly camera: THREE.PerspectiveCamera;
  readonly exposure: ExposureControl;
  readonly uniforms: SharedUniforms;
  /** Drawing-buffer size, device pixels. */
  readonly size: { readonly width: number; readonly height: number; readonly pixelRatio: number };
  /** Hook run every frame before Renderable updates. Returns unsubscribe. */
  onBeforeFrame(cb: (view: ViewState) => void): () => void;
  /** Hook run after the frame is presented. Returns unsubscribe. */
  onAfterFrame(cb: (view: ViewState) => void): () => void;
  /** Compiles every registered material (compile-all spec). */
  compileAll(): Promise<void>;
  stats(): RenderStats;
  /**
   * Renders the scene from an arbitrary Float64 viewpoint into a cube target (black-hole
   * background capture, sky-cube re-bake). Optional until a phase implements it.
   */
  captureCube?(opts: CubeCaptureOptions): void;
}

// ---------------------------------------------------------------------------------------
// Surfaces (shared by the sphere provider of P1 and terrain of P2)
// ---------------------------------------------------------------------------------------

/** Number of Float64-anchored detail-noise bands (wavelengths 10 km, 1 km, 100 m, 10 m, 1 m). */
export const SURFACE_DETAIL_BANDS = 5;
/** Wavelength of band k, metres: SURFACE_DETAIL_BASE_M · 10^-k. */
export const SURFACE_DETAIL_BASE_M = 1e4;
/** Period of detail noise, in band units (noise must be periodic with this period). */
export const SURFACE_NOISE_PERIOD = 256;

/**
 * GLSL struct every SurfaceShading receives. Geometry providers fill it; shading code
 * defines `vec3 shadeSurface(SurfaceInput s)` returning radiance in cd/m² (linear RGB,
 * BEFORE exposure; the geometry shader multiplies by uExposure and writes log depth).
 * Aerial perspective is applied later by the atmosphere ScreenPass.
 */
export const SURFACE_INPUT_GLSL = /* glsl */ `
#define SURFACE_DETAIL_BANDS ${SURFACE_DETAIL_BANDS}
#define SURFACE_NOISE_PERIOD ${SURFACE_NOISE_PERIOD}.0
struct SurfaceInput {
  vec3 viewPos;        // fragment relative to camera, world axes, m (float32, camera-relative)
  vec3 viewDir;        // unit, fragment -> camera, world axes
  vec3 normal;         // unit shading normal (terrain/normal map applied), world axes
  vec3 up;             // unit ellipsoid normal (local vertical), world axes
  vec3 dirBody;        // unit direction from body centre, body-fixed axes (texture lookup)
  vec3 normalBody;     // shading normal in body-fixed axes
  vec2 uv;             // equirectangular: u = lon/2pi + 0.5 (east-positive), v = lat/pi + 0.5
  float height;        // m above the reference radius (0 on the sphere provider)
  float slope;         // 1 - dot(normal, up)
  vec3 sunDir;         // unit, fragment -> Sun, world axes
  vec3 sunIlluminance; // solar illuminance at the body top-of-atmosphere, lux per channel (linear RGB)
  float shadow;        // eclipse / occluder visibility of the Sun, 0..1 (shadows.glsl)
  float pixelSize;     // metres covered by one pixel at this fragment (filter detail bands)
  vec3 localPos;       // m, body-fixed axes, relative to the provider's float64 local origin
  vec3 detailOrigin[SURFACE_DETAIL_BANDS]; // frac(origin / lambda_k / P) * P, computed in float64
};
// Detail domain for band k: detailOrigin[k] + localPos / (SURFACE_DETAIL_BASE_M * pow(10, -k)), wrap at P.
`;

/** TypeScript mirror of the GLSL SurfaceInput (documentation and CPU twins). */
export interface SurfaceInput {
  viewPos: Vec3d;
  viewDir: Vec3d;
  normal: Vec3d;
  up: Vec3d;
  dirBody: Vec3d;
  normalBody: Vec3d;
  uv: [number, number];
  height: number;
  slope: number;
  sunDir: Vec3d;
  sunIlluminance: [number, number, number];
  shadow: number;
  pixelSize: number;
  localPos: Vec3d;
  detailOrigin: Vec3d[];
}

/**
 * How a body's surface looks. Highest `priority` per bodyId wins (P1 default 0,
 * P2/P3 overrides 10). The same GLSL serves the sphere and terrain geometry.
 */
export interface SurfaceShading {
  bodyId: string;
  priority: number;
  /** Defines `vec3 shadeSurface(SurfaceInput s)`; may declare its own uniforms and helper functions. */
  glsl: string;
  uniforms: Record<string, THREE.IUniform>;
  update?(view: ViewState): void;
  /** Extra #defines for the shading code. */
  defines?: Record<string, string | number | boolean>;
}

/**
 * Builds the mesh for a body's surface ('sphere' P1 priority 0, 'terrain' P2 priority 10).
 * Each frame the engine activates, per body, the highest-priority provider whose `wants`
 * returns true; renderables are built lazily and kept while inactive (budget may evict).
 */
export interface SurfaceGeometryProvider {
  /** Provider name, e.g. 'sphere', 'terrain'. */
  id: string;
  bodyId: string | '*';
  priority: number;
  wants(view: ViewState, body: Body): boolean;
  build(body: Body, shading: SurfaceShading): Renderable;
}

/**
 * Registers a height function for a body. The terrain worker loads `workerModule`, a key of
 * import.meta.glob('/src/modules/*\/height/*.ts'), e.g. '/src/modules/surfaces/height/moon.ts'.
 */
export interface HeightSourceSpec {
  bodyId: string;
  workerModule: string;
  /** Structured-cloneable parameters passed to HeightModule.create. */
  params: unknown;
  /** Max |height| in metres (culling bounds, collision safety margin). */
  maxAbsHeight: number;
  priority?: number;
}

/** Height function instance living in a worker (and on the main thread for collision). */
export interface HeightFunction {
  /**
   * Heights (m above reference radius) for `count` unit body-fixed directions packed xyz in
   * `dirs`, written to `out`. `level` is the quadtree level (band limit; 0 = whole face).
   */
  sample(dirs: Float64Array, out: Float64Array, count: number, level: number): void;
}

/** Services available to height modules inside a worker. */
export interface HeightWorkerContext {
  /** Fetches a file under BASE_URL (e.g. 'data/surfaces/moon-height.png'). */
  fetchBinary(path: string): Promise<ArrayBuffer>;
  seed: number;
}

/** Shape of every '/src/modules/*\/height/*.ts' file (default export or named `create`). */
export interface HeightModule {
  create(params: unknown, ctx: HeightWorkerContext): HeightFunction | Promise<HeightFunction>;
}

/** Bodies that cast shadows on receivers (eclipses, moon transits on giants). */
export interface OccluderProvider {
  receivers: string[] | '*';
  occluders(view: ViewState): { bodyId: string; radius: number }[];
}

/**
 * Ground for collision and speed (DESIGN 3.2 Speed, P2 walk mode). Must match the rendered
 * mesh within 1 cm. Registered on CameraApi; highest priority answering non-null wins.
 */
export interface GroundProvider {
  id: string;
  bodyId: string | '*';
  priority: number;
  /** Height (m above reference radius) under unit body-fixed direction `dirBody`; null = unknown. */
  heightAt(bodyId: string, dirBody: Vec3d): number | null;
  /** Unit ground normal in body-fixed axes (default: radial). */
  normalAt?(bodyId: string, dirBody: Vec3d, out: Vec3d): Vec3d;
}

// ---------------------------------------------------------------------------------------
// Search, info, tours, settings
// ---------------------------------------------------------------------------------------

/** One searchable item. The palette indexes entries with fuse.js (name + aliases). */
export interface SearchEntry {
  /** Unique id, usually a body id or 'hip:<n>' / 'gal:<id>'. Passed to InfoProvider. */
  id: string;
  name: string;
  aliases?: string[];
  /** Short subtitle, e.g. 'Moon of Saturn'. */
  subtitle?: string;
  kind: BodyKind | 'bookmark' | 'tour' | 'constellation' | 'other';
  /** Where selecting the entry flies: a body id or a bookmark. */
  target: string | Bookmark;
  /** Ranking boost, higher first on ties (default 0). */
  priority?: number;
}

/** Contributes search entries (palette `/`, Ctrl+K). */
export interface SearchProvider {
  id: string;
  /** Static entry list, indexed once (call registry change notifications to re-index). */
  entries(): readonly SearchEntry[];
  /** Optional custom query (e.g. catalogue numbers); merged with fuse results. */
  query?(text: string, limit: number): readonly SearchEntry[];
}

/** One line of an info card. */
export interface InfoFact {
  label: string;
  value: string | number;
  unit?: string;
  /** UI marks it "approximate". */
  approximate?: boolean;
  source?: string;
}

/** Content of the info card. */
export interface InfoCard {
  title: string;
  subtitle?: string;
  facts: InfoFact[];
  description?: string;
  /** Procedural appearance ("simulated" / "artist's impression" badge). */
  simulated?: boolean;
  credit?: string;
  links?: { label: string; url: string }[];
}

/** Supplies info cards for ids it recognises (first provider returning non-null wins). */
export interface InfoProvider {
  id: string;
  info(id: string): InfoCard | null | Promise<InfoCard | null>;
}

/** Tour DSL step (P5 player). Durations in real seconds. */
export type TourStep =
  | { type: 'goto'; target: string | Bookmark; duration?: number }
  | { type: 'orbit'; target: string; degrees: number; duration: number }
  | { type: 'timeRate'; rate: number }
  | { type: 'setTime'; jd: JD | 'now' }
  | { type: 'wait'; seconds: number }
  | { type: 'caption'; text: string; seconds?: number }
  | { type: 'speak'; text: string }
  | { type: 'setting'; id: string; value: SettingValue };

export interface TourDef {
  id: string;
  title: string;
  description?: string;
  steps: TourStep[];
}

export type SettingValue = boolean | number | string;

/**
 * A user setting (settings panel; `debug: true` puts it in the ?debug lil-gui instead).
 * Ids are '<module>.<name>'. Values persist in localStorage when `persist` is true.
 */
export interface SettingDef {
  id: string;
  label: string;
  group: string;
  type: 'boolean' | 'number' | 'select' | 'action';
  default: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  description?: string;
  debug?: boolean;
  persist?: boolean;
  /** Called with the new value (and once at registration with the initial value). */
  onChange?(value: SettingValue): void;
}

/** Read/write access to setting values. */
export interface SettingsStore {
  get<T extends SettingValue = SettingValue>(id: string): T | undefined;
  set(id: string, value: SettingValue): void;
  subscribe(id: string, listener: (value: SettingValue) => void): () => void;
}

// ---------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------

/** What changed in a registry notification. */
export type RegistryKind =
  | 'frame'
  | 'body'
  | 'renderable'
  | 'screenPass'
  | 'surface'
  | 'height'
  | 'occluder'
  | 'search'
  | 'info'
  | 'bookmark'
  | 'tour'
  | 'setting'
  | 'validity';

/** Read side of the registry (engine, UI, and modules reading each other's registrations). */
export interface RegistryReader {
  body(id: string): Body | undefined;
  bodies(): readonly Body[];
  bookmark(id: string): Bookmark | undefined;
  bookmarks(): readonly Bookmark[];
  renderables(): readonly Renderable[];
  screenPasses(): readonly ScreenPass[];
  /** Winning shading for a body (highest priority), if any. */
  surfaceShading(bodyId: string): SurfaceShading | undefined;
  surfaceGeometries(): readonly SurfaceGeometryProvider[];
  heightSource(bodyId: string): HeightSourceSpec | undefined;
  occluderProviders(): readonly OccluderProvider[];
  searchProviders(): readonly SearchProvider[];
  infoProviders(): readonly InfoProvider[];
  tours(): readonly TourDef[];
  settings(): readonly SettingDef[];
  validityRanges(): readonly ValidityRange[];
  /** Notified after any add/remove. Returns unsubscribe. */
  subscribe(listener: (kind: RegistryKind) => void): () => void;
}

/** Write side used by modules in `init` (and later for on-demand objects). */
export interface Registry extends RegistryReader {
  /** Same as frames.addFrame. */
  addFrame(f: FrameDef): void;
  addBody(b: Body): void;
  removeBody(id: string): void;
  addRenderable(r: Renderable): void;
  /** Removes and disposes. */
  removeRenderable(id: string): void;
  addScreenPass(p: ScreenPass): void;
  removeScreenPass(id: string): void;
  /** Highest priority per bodyId wins. */
  setSurfaceShading(s: SurfaceShading): void;
  /** 'sphere' (P1, priority 0) or 'terrain' (P2, priority 10). */
  setSurfaceGeometry(g: SurfaceGeometryProvider): void;
  addHeightSource(h: HeightSourceSpec): void;
  addOccluders(p: OccluderProvider): void;
  addSearch(p: SearchProvider): void;
  addInfo(p: InfoProvider): void;
  addBookmarks(b: Bookmark[]): void;
  addTour(t: TourDef): void;
  addSetting(s: SettingDef): void;
  addValidity(v: ValidityRange): void;
}

// ---------------------------------------------------------------------------------------
// Services: assets, workers, budget
// ---------------------------------------------------------------------------------------

export interface TextureOptions {
  /** 'srgb' for colour maps (default), 'linear' for data (normals, heights, masks). */
  colorSpace?: 'srgb' | 'linear';
  mipmaps?: boolean;
  wrap?: 'repeat' | 'clamp' | 'mirror';
  anisotropy?: number;
  flipY?: boolean;
  /** Owner for ResourceBudget accounting (module id). */
  owner?: string;
}

export interface AssetProgress {
  loaded: number;
  total: number;
  /** Bytes received so far (best effort). */
  bytes: number;
}

/**
 * Asset loader (src/core/assets.ts). Paths are relative to the public root, e.g.
 * 'data/stars/stars.bin'; the loader prefixes import.meta.env.BASE_URL. Never hard-code '/'.
 */
export interface AssetLoader {
  /** Absolute URL for a public path (BASE_URL-aware). */
  url(path: string): string;
  texture(path: string, opts?: TextureOptions): Promise<THREE.Texture>;
  json<T = unknown>(path: string): Promise<T>;
  binary(path: string): Promise<ArrayBuffer>;
  text(path: string): Promise<string>;
  progress(): AssetProgress;
  /**
   * Registers other async work (tile queues, worker decodes) so `whenIdle` and the test
   * API's ready() wait for it. Returns the same promise.
   */
  track<T>(work: Promise<T>, label?: string): Promise<T>;
  /** Resolves when no tracked or loading work remains. */
  whenIdle(): Promise<void>;
  subscribe(listener: (p: AssetProgress) => void): () => void;
}

/** Method names of T whose values are functions. */
export type MethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];

/** A pool of identical comlink workers exposing API T. */
export interface WorkerHandle<T extends object> {
  /** Calls `method` on the least-busy worker. Use comlink's transfer() for large buffers. */
  call<K extends MethodKeys<T>>(
    method: K,
    ...args: T[K] extends (...a: infer A) => unknown ? A : never
  ): Promise<T[K] extends (...a: never[]) => infer R ? Awaited<R> : never>;
  /** Calls `method` on every worker (broadcast configuration). */
  broadcast<K extends MethodKeys<T>>(
    method: K,
    ...args: T[K] extends (...a: infer A) => unknown ? A : never
  ): Promise<void>;
  readonly size: number;
  /** In-flight calls. */
  pending(): number;
  terminate(): void;
}

/**
 * Worker pool (src/core/workers.ts). Worker files call comlink `expose(api)`; the main
 * thread creates them with `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`
 * inside the `create` factory so Vite bundles them.
 */
export interface WorkerPool {
  /** navigator.hardwareConcurrency clamped to [1, 4]. */
  readonly maxWorkers: number;
  /** Creates (or returns the existing, by key) pool of `count` workers (default 1). */
  pool<T extends object>(key: string, create: () => Worker, count?: number): WorkerHandle<T>;
  /** Total in-flight calls across pools (ready() waits for 0). */
  pending(): number;
  terminateAll(): void;
}

/** One budgeted GPU allocation. */
export interface BudgetEntry {
  readonly owner: string;
  readonly key: string;
  readonly bytes: number;
  /** Marks as recently used (LRU). */
  touch(): void;
  resize(bytes: number): void;
  /** Releases the accounting (caller already disposed the resource). */
  free(): void;
}

/**
 * GPU memory accounting with LRU eviction (src/core/budget.ts). Cap from QualityKnobs.gpuBudgetMB.
 * Evictable entries pass `evict`, which must dispose the resource; the budget then frees it.
 */
export interface ResourceBudget {
  readonly capBytes: number;
  alloc(owner: string, key: string, bytes: number, evict?: () => void): BudgetEntry;
  /** Total bytes, or bytes of one owner. */
  used(owner?: string): number;
  /** Bytes per owner. */
  report(): Record<string, number>;
  /** Evicts least-recently-used evictable entries until `bytes` more fit. Returns bytes freed. */
  makeRoom(bytes: number): number;
}

// ---------------------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------------------

export type CameraMode = 'free' | 'orbit' | 'walk';

/** Float64 camera state (DESIGN 3.2 Camera). */
export interface CameraState {
  frame: FrameId;
  /** Position in `frame` coordinates, m. */
  local: Vec3d;
  /** Orientation relative to `frame` axes. Camera looks down -Z, up is +Y (three.js). */
  quat: Quatd;
  /** Vertical field of view, radians. */
  fovY: number;
}

export interface GotoOptions {
  /** Flight time, s (default: van Wijk-Nuij, 3-12 s). */
  duration?: number;
  /** Final distance from the target's surface, m (default: about 3 radii). */
  distance?: number;
  /** Teleport without animation (tests, deep links). */
  instant?: boolean;
}

/** Camera controller (src/camera). */
export interface CameraApi {
  readonly mode: CameraMode;
  setMode(mode: CameraMode): void;
  /** Copy of the current state. */
  getState(out?: CameraState): CameraState;
  /** Teleport (fields omitted are kept). Re-anchors as needed. */
  setState(s: Partial<CameraState>): void;
  /** Selected/orbit target body id. */
  readonly target: string | null;
  setTarget(bodyId: string | null): void;
  /** Flies to a body id, bookmark id, or bookmark. Resolves true on arrival, false if cancelled. */
  goto(target: string | Bookmark, opts?: GotoOptions): Promise<boolean>;
  cancelGoto(): void;
  readonly traveling: boolean;
  /** User speed factor k in [0.1, 5] per second (v = k · d_nearest). */
  speedFactor: number;
  /** Current speed, m/s. */
  readonly speed: number;
  /** Registers a collision/ground source. Returns unsubscribe. */
  addGroundProvider(p: GroundProvider): () => void;
  /** Nearest surface (sphere radius + ground height) and altitude above it. */
  nearestSurface(): { bodyId: string; altitude: number } | null;
  /** Notified on mode/target/goto start and end. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
}

// ---------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------

/** One label candidate for the decluttered overlay (at most 64 shown). */
export interface LabelItem {
  id: string;
  text: string;
  frame: FrameId;
  local: Vec3d;
  /** Higher wins when labels overlap. */
  priority: number;
  /** Sphere radius for occlusion testing and the offset of the label, m (0 for points). */
  radius?: number;
  /** CSS colour. */
  color?: string;
  /** Click target (body id or bookmark id) for goto/select. */
  target?: string;
}

/** Contributes labels every frame (bodies get labels automatically from the registry). */
export interface LabelSource {
  id: string;
  /** Push candidates into `out`; keep it cheap (called each UI frame). */
  labels(view: ViewState, out: LabelItem[]): void;
}

/** UI services (src/ui). */
export interface UiApi {
  toast(message: string, opts?: { kind?: 'info' | 'warn' | 'error'; durationMs?: number }): void;
  /** Opens the info card for an id (null closes it). */
  showInfo(id: string | null): void;
  /** Current selection (body/search id); also drives the info card. */
  readonly selection: string | null;
  select(id: string | null): void;
  addLabelSource(src: LabelSource): () => void;
  readonly settings: SettingsStore;
  /** Hides/shows the HUD and overlays (photo mode). */
  setHudVisible(visible: boolean): void;
  /** Persistent caption line (tours). null clears it. */
  setCaption(text: string | null): void;
}

/**
 * What boot (src/app, P1-A) hands to the UI shell (src/ui, P1-D). The UI only reads the
 * registry; modules register settings, labels and providers themselves.
 */
export type UiContext = Omit<ModuleContext, 'ui' | 'registry'> & { registry: RegistryReader };

/**
 * Signature of `mountUi` exported by src/ui/index.ts. Boot calls it once, before module
 * `init`, and passes the returned UiApi to every module as ctx.ui.
 */
export type MountUi = (root: HTMLElement, ctx: UiContext) => UiApi;

// ---------------------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------------------

/** Boot environment derived from the URL. */
export interface AppEnv {
  /** ?test=1: deterministic, rAF disabled, window.__universe installed. */
  test: boolean;
  /** ?debug: lil-gui panel. */
  debug: boolean;
  /** ?perf=1: stats-gl overlay. */
  perf: boolean;
  /** ?seed= (default 1). */
  seed: number;
  /** import.meta.env.BASE_URL, e.g. '/my-third-repo/'. */
  baseUrl: string;
  /** Full query parameters. */
  params: URLSearchParams;
}

/** Everything a module gets in `init`. */
export interface ModuleContext {
  frames: FrameTree;
  clock: SimClock;
  registry: Registry;
  render: RenderApi;
  assets: AssetLoader;
  workers: WorkerPool;
  quality: QualityState;
  camera: CameraApi;
  ui: UiApi;
  budget: ResourceBudget;
  env: AppEnv;
}

/**
 * A feature module: src/modules/<id>/index.ts default-exports (or exports `module`) one of
 * these. Discovered with import.meta.glob('/src/modules/*\/index.ts', { eager: true }),
 * sorted topologically by `dependsOn`, then `init` is awaited in order.
 */
export interface UniverseModule {
  /** Equals the folder name, e.g. 'solar-system'. */
  id: string;
  dependsOn?: string[];
  init(ctx: ModuleContext): void | Promise<void>;
  /** Releases everything not owned by registered Renderables (tests, hot reload). */
  dispose?(): void;
}

// ---------------------------------------------------------------------------------------
// Test API (window.__universe, only with ?test=1 or in dev)
// ---------------------------------------------------------------------------------------

/** Deterministic hooks for Playwright (DESIGN 3.4 Test API, section 7). */
export interface UniverseTestApi {
  /** Resolves when assets are loaded and tile/worker queues are empty. */
  ready(): Promise<void>;
  /** Renders exactly n frames (rAF is disabled in test mode). */
  renderFrames(n: number): Promise<void>;
  /** Teleports to a bookmark (instant) and applies its jd/ev. */
  goto(bookmarkId: string): Promise<void>;
  /** Sets the sim time from an ISO-8601 UTC string. */
  setTime(iso: string): void;
  stats(): RenderStats;
  /** Mean linear RGB of the final canvas over a pixel rectangle (CSS px, origin top-left). */
  probe(x: number, y: number, w: number, h: number): Promise<[number, number, number]>;
  /** Shader compile errors, uncaught exceptions and console errors since boot. */
  errors(): string[];
}

declare global {
  interface Window {
    __universe?: UniverseTestApi;
  }
}
