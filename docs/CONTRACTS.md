# Cosmos contracts

`src/core/contracts.ts` is the plug-in contract (DESIGN 3.4). It is **frozen at the end of Phase 1**: afterwards only optional members may be added. If you need a change, write `docs/requests/<pkg>.md`, shim inside your own module, and the integrator lands it.

## Conventions

| Topic      | Rule                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Units      | Metres, seconds and radians, as float64 `number`. `JD` = Julian Date in **TT**.                                                                                                                                           |
| Frames     | Float64 tree: `universe` (supergalactic) > `mw` (galactic, origin Sgr A*) > `ssb` (ICRF) > `<body>` (inertial) > `<body>.fixed` (rotating). On-demand frames: `star:<HIP>`, `bh:<id>`, `gal:<id>`.                        |
| World axes | ICRF/J2000 equatorial (the `ssb` axes), whatever the camera anchor is. Every "world" vector, the camera's `worldQuat` and every `toCamera` result use them.                                                               |
| FrameDef   | `positionAt` = origin in the **parent's** coordinates. `orientationAt` = rotation from **this** frame's axes into the parent's (v_parent = q · v_this). Without it, the frame shares its parent's axes.                   |
| Rendering  | Camera-relative: the three.js camera sits at the origin and only rotates. Renderables set `object.position = Float32(view.toCamera(frame, local))` each frame, and orient body-fixed meshes with `view.frameQuat(frame)`. |
| Depth      | Log depth, near `CAMERA_NEAR` = 0.05 m, far `CAMERA_FAR` = 1e27 m. Every custom shader includes `src/render/chunks/depth.glsl`.                                                                                           |
| Light      | Shaders output L[cd/m²] × `uExposure`. Exposure = 1 / (1.2 · 2^EV100). Bookmarks carry `ev` for tests.                                                                                                                    |
| Assets     | Paths are relative to `public/` (`data/<m>/x.bin`). `AssetLoader` prefixes `import.meta.env.BASE_URL` (`/my-third-repo/`).                                                                                                |

## Module lifecycle

1. **Discovery.** `src/app/discover.ts` (P1-A) runs `import.meta.glob('/src/modules/*/index.ts', { eager: true })`. Each `index.ts` default-exports (or exports `module`) a `UniverseModule` whose `id` equals its folder name.
2. **Order.** Modules are sorted topologically by `dependsOn`. A cycle or a missing dependency is a boot error.
3. **UI first.** Boot calls `mountUi(root, UiContext)` (`MountUi`) before any module, so `ctx.ui` exists during `init`.
4. **Init.** `await module.init(ctx)` runs in order. Modules register frames, bodies, renderables, passes and providers here, and keep heavy code behind dynamic `import()`. Long async work (decodes, tile queues) goes through `assets.track()` so `ready()` waits for it.
5. **Frame.** Each frame the app loop calls `clock.tick`, re-anchors the camera, builds a `ViewState`, runs `render.onBeforeFrame` hooks, calls every `Renderable.update(view)` and `SurfaceShading.update`, renders the pipeline (below), and then runs `onAfterFrame`.
6. **Teardown.** `Registry.removeRenderable` disposes the renderable. `UniverseModule.dispose?()` frees anything else (tests, hot reload). Every Renderable must report `memoryBytes()` and dispose cleanly; a contract test enforces this.

Height functions use a second glob, `/src/modules/*/height/*.ts`, which the terrain worker loads by key (`HeightSourceSpec.workerModule`). Each file exports a `HeightModule` (`create(params, ctx) → HeightFunction`). There is no shared registration file anywhere.

## Frame pipeline (DESIGN 3.3)

| #   | Stage                              | Contents                                                                                                                |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `background` layer                 | No depth, additive HDR: Milky Way panorama or sky cube, galaxies, cosmic web, CMB, stars.                               |
| 2   | `opaque` then `transparent` layers | Main scene, `clear=false`, log depth into a depth texture: bodies and terrain, then clouds, rings, tails and particles. |
| 3   | ScreenPass `atmosphere`            | Sky, aerial perspective, background transmittance.                                                                      |
| 4   | ScreenPass `lensing`               | Black holes.                                                                                                            |
| 5   | ScreenPass `effects`               | Everything else full-screen.                                                                                            |
| 6   | Exposure                           | Log-average luminance, async readback every 4 frames (fixed EV in tests).                                               |
| 7   | EffectPass                         | Mip bloom, AgX, SMAA (off on potato), vignette in photo mode.                                                           |
| 8   | `overlay` layer + DOM              | Overlay scene, labels (at most 64, decluttered by priority) and HUD.                                                    |

Within a stage, passes run by ascending `order`. The host ping-pongs HalfFloat targets: a pass reads `input` and writes `output`, and an inactive pass is skipped.

## Interfaces

**Frames and time**

- `FrameDef` / `FrameTree`: add or remove frames. `relative(a, b)` returns the vector between frame origins and `delta(a, aLocal, b, bLocal)` the vector between points; both walk to the lowest common ancestor and return world axes. Also `convertPoint`, `orientation`, `toWorldDir`/`fromWorldDir`, `findAnchor` (deepest influence sphere, 10% hysteresis) and `toCamera`.
- `SimClock`: TT `jd`, `rate` (sim s per real s), `WARP_LADDER` steps, pause and resume, `setTime(JD | Date | ISO)`, `setNow`, UTC↔TT conversion and `validity(jd)`. Only the app loop calls `tick`.
- `ValidityRange` / `ValidityStatus`: the time-validity badges, e.g. planets ±10 kyr then `frozen`.

**Things in the world**

- `Body`: anything selectable or landable (radius, GM, albedo, teff, absMag, `simulated`).
- `Bookmark`: a saved view. Deep link `#b=<id>`; e2e uses `&b=<id>`. `lookTarget` describes what a reviewer should see.
- `Renderable`: `object`, plus `layer`, `update(view)`, `memoryBytes()` and `dispose()`.
- `ScreenPass`: a full-screen stage pass with access to the log `depth` texture and `view.camera` matrices; optional `setSize`, `memoryBytes` and `dispose`.

**Surfaces (P1 sphere, P2 terrain)**

- `SurfaceShading`: GLSL defining `vec3 shadeSurface(SurfaceInput s)`, returning radiance in cd/m² before exposure. The highest `priority` per body wins (P1 default 0, overrides 10).
- `SurfaceInput` / `SURFACE_INPUT_GLSL`: the struct that geometry providers fill: view and normal vectors, body-fixed direction, `uv`, `height`, `sunIlluminance` (lux), `shadow`, `pixelSize`, and float64-anchored detail-noise origins for 5 bands (10 km to 1 m, period 256).
- `SurfaceGeometryProvider`: `wants(view, body)` / `build(body, shading)`. Each frame the highest-priority provider that wants a body is active.
- `HeightSourceSpec` / `HeightModule` / `HeightFunction`: worker height functions, batched over float64 directions.
- `OccluderProvider`: shadow casters for eclipses and moon transits (up to 4 analytic spheres in `shadows.glsl`).
- `GroundProvider`: collision height under a body-fixed direction (it must match the mesh within 1 cm). It is registered with `camera.addGroundProvider`.

**Discovery and UI content**

- `SearchProvider` (`entries()`, optional `query`) and `SearchEntry`: indexed by fuse.js in the palette. Selecting an entry runs `camera.goto(target)`.
- `InfoProvider` (`info(id) → InfoCard`): the first non-null result wins. `InfoFact.approximate` / `source` show their badges.
- `TourDef` / `TourStep`: the P5 DSL (`goto`, `orbit`, `timeRate`, `setTime`, `wait`, `caption`, `speak`, `setting`).
- `SettingDef` / `SettingsStore`: ids are `<module>.<name>`. `debug: true` routes a setting to the `?debug` lil-gui.
- `LabelSource` / `LabelItem`: extra labels. Bodies are labelled automatically.

**Services in `ModuleContext`**

- `Registry` (write) extends `RegistryReader` (read and `subscribe`). The UI receives only the reader.
- `RenderApi`: `renderer`, the three `scenes`, the origin `camera`, `exposure`, shared `uniforms` (`uExposure`, `uLogDepthFar`, `uResolution`, `uTime`, `uBlackbodyLut`, `uBlueNoise`), frame hooks, `compileAll`, `stats`, and optional `captureCube` (black-hole background, sky cube).
- `AssetLoader`: `url`, `texture`, `json`, `binary`, `text`, `progress`, `track`, `whenIdle`, all BASE_URL-aware.
- `WorkerPool` / `WorkerHandle`: comlink pools keyed by name (at most 4 workers). Calls are typed by method name; use `transfer()` for buffers.
- `QualityState` / `QualityKnobs`: presets `potato`, `low`, `medium`, `high`, `ultra` (`?q=`), plus `dynamicScale` for P5.
- `CameraApi`: `mode` (free, orbit or walk), `getState`/`setState` (`CameraState` = frame, local, quat and fov), `goto` (van Wijk-Nuij, resolves true on arrival), `speedFactor`, ground providers and `nearestSurface`.
- `UiApi`: toast, info card, selection, label sources, settings, HUD visibility and captions.
- `ResourceBudget`: `alloc(owner, key, bytes, evict?)` with LRU eviction and caps of 128, 256 or 512 MB by preset.
- `AppEnv`: `test`, `debug`, `perf`, `seed`, `baseUrl` and `params`.

## Ownership (DESIGN 3.5)

- Integrator-owned: root configs, `package.json`, the lockfile, `.github/**`, `CLAUDE.md`, this file, `src/core/**`, `src/render/**`, `src/camera/**`, `src/app/**`, `tools/lib/**`, `tools/{fetch-assets,build-credits,size-guard}.mjs`.
- Package-owned: everything under `src/modules/<m>/` and its tests, fixtures, build tool, manifest, public data and docs.
- `src/ui/**` belongs to P1-D in P1, the integrator in P2-P4, and P5-B in P5.
- Cross-module imports are allowed only from `src/core/**`, `src/render/chunks/**` and other modules' `public.ts`.

## Test API (`window.__universe`)

It exists only with `?test=1` (or in dev). In test mode rAF is disabled, time is deterministic, temporal accumulation is off and the per-frame budgets are lifted.

| Method              | Purpose                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `ready()`           | Resolves when assets, tracked work, workers and tile queues are idle.                                   |
| `renderFrames(n)`   | Renders exactly `n` frames.                                                                             |
| `goto(bookmarkId)`  | Instant teleport, applying the bookmark's `jd`/`ev`.                                                    |
| `setTime(iso)`      | Sets the UTC instant.                                                                                   |
| `stats()`           | `RenderStats`: calls, triangles, points, lines, programs, textures, geometries, tiles, gpuBytes, frame. |
| `probe(x, y, w, h)` | Mean linear RGB over a CSS-pixel rectangle (origin top-left).                                           |
| `errors()`          | Shader errors, uncaught exceptions and console errors since boot.                                       |

URL contract: `?test=1&q=potato&b=<bookmark>&t=<ISO>&ev=<EV>&seed=1` at 480×270. In specs, use `page.goto('?test=1&...')` without a leading slash so the URL resolves under `/my-third-repo/`.
