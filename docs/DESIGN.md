# Cosmos: design (source of truth)

> **Execution overrides (these take precedence over anything below)**
> - **Git:** all work lands on branch `claude/dazzling-bohr-oq7go0`.
>   - Never push `main`.
>   - Each phase ends with a pull request into `main`. The project owner merges it, and `deploy.yml` then publishes to GitHub Pages.
>   - Where the text below says "push `main`", read "push `claude/dazzling-bohr-oq7go0`".
> - **GitHub Pages** is already enabled, with Source set to GitHub Actions. The site is `https://gcvillar9-bit.github.io/my-third-repo/`.
> - **Parallel work:** the orchestrator's workflow creates the worktrees. Implementers create branch `p<N>-<pkg>` inside their worktree, commit there and never push. The merge and integrator steps then merge into `claude/dazzling-bohr-oq7go0` and push that branch.
> - **Budget priority:** if a phase runs over plan, cut Phase 3 items before Phase 4 items. Sgr A\* (black-hole lensing, disk and S-stars) has top priority and is never cut.
> - **Dollar figures** below are the original planning estimates. The live budget is tracked by the orchestrator.


**Repo:** `gcvillar9-bit/my-third-repo`. It is currently empty apart from README.md and `.gitattributes` with `* text=auto`.
**Live URL after Phase 1:** `https://gcvillar9-bit.github.io/my-third-repo/`
**Builder:** AI coding agents, at most 2 running at once.
**Budget:** USD 190 planned plus a USD 50 reserve, totalling USD 240.

### Where each part of the plan comes from

**Backbone (from the engineering proposal):**
- Typed contracts frozen after Phase 1.
- Modules auto-discovered with `import.meta.glob`.
- Dependencies frozen in Phase 1.
- One git worktree per agent.
- A deterministic test API.
- `renderer.info` budgets, plus leak and jitter specs.
- GPU Kepler propagation for small bodies.
- Fixture routing so runtime streaming can be tested.

**Taken from the realism proposal:**
- One photometric chain: magnitude to flux, B-V to Teff, then Planck x CIE colour.
- GPU-free science acceptance tests.
- Hillaire LUT atmospheres, with aerial perspective packed as a 2D atlas.
- Frankot-Chellappa height recovery from Celestia normal maps.
- A Novikov-Thorne accretion disk with the g-factor.
- S-stars with Schwarzschild precession.
- A Reid-2019 Milky Way, calibrated against `mw.json`, plus sky-cube re-baking.
- Celestia `galaxies.dsc` 3D distances.
- An offline Zel'dovich cosmic web.
- Time-validity badges.

**Taken from the experience proposal:**
- The van Wijk-Nuij autopilot.
- The command palette.
- Planets drawn as photometric points.
- Walking and jumping with real gravity.
- Standing on the ground during real eclipses.
- Deep links.
- Tours, photo mode, audio and onboarding.
- The light-delay readout.

**Dropped:**
- Sources that are not verified: Stellarium textures and `.ini` files, the build-time AWS Terrarium bake, threex, NASA-3D-Resources.
- Reversed-Z and `EXT_clip_control`.
- GPU tile generation into texture arrays.
- Layered depth partitions.
- Scale-compression modes.
- The 1M-galaxy, 20 MB cosmic web.

---

## 1. Vision

You open a link and you are 400 km above Earth's dawn terminator at the real current instant. City lights fade into a blue limb, and the Moon and planets are exactly where they are in the real sky.

One continuous flight, with no loading screens, covers 30 orders of magnitude:
- Stand at the Apollo 11 site and jump at 1/6 g.
- Watch a blue sunset on Mars.
- Skim Saturn's backlit rings.
- Leave the Sun until it is a magnitude 0.5 star in Cassiopeia.
- See the Milky Way's barred spiral from 100 kpc.
- Watch S2 whip around a ray-traced Sgr A*.
- Cross 10,937 real galaxies into the cosmic web and on to the CMB.

Real data (ephemerides and catalogues) places everything that can be known. Physically motivated procedural models fill in the rest, and those are labelled "simulated" in the UI. Every view is a shareable URL.

### Signature wow moments (phase where each ships)

1. **"Right now" (P1).** The app opens on the real sky at the current UTC time. Planets are bright points that resolve into worlds as you approach, and the stars are the HYG catalogue with true colours.
2. **One-keystroke travel (P1).** Press `/`, type "Saturn", and a smooth log-space autopilot arc takes you there in 3-12 seconds. Time warp shows the Galilean moons dancing.
3. **Orbit to boots (P2).** One unbroken descent from orbit to standing 1.7 m above the Apollo 11 landing area, with Earth hanging in a black sky. Press G to walk, and jump at 1.62 m/s².
4. **Alien skies (P2).** A blue sunset at Gale crater on Mars, and Earth's sunrise limb from 400 km with ocean glint and cloud shadows.
5. **"The Day the Earth Smiled" (P3).** Saturn backlit on 2013-07-19 with forward-scattering rings, then a fly-through of ring ice particles in the Cassini Division.
6. **Stand in totality (P3).** "Next eclipse" puts you on the ground in Luxor on 2027-08-02 as the corona appears and the stars come out.
7. **Constellations break (P4).** Orion's figure, drawn between true 3D star positions, stretches apart as you leave. From Alpha Centauri the Sun is a magnitude 0.5 star in Cassiopeia. A time warp of 100,000 years deforms the Big Dipper.
8. **The galaxy from outside (P4).** The barred spiral with dust lanes and a "You are here" marker, built from a published structural model.
9. **Sgr A* (P4).** S2 slingshots through periapsis behind a ray-traced shadow and photon ring that lens the real sky. Toggle Doppler beaming. Cygnus X-1 devours its companion.
10. **Cosmic Zoom (P5).** One narrated, continuous shot from a boot print to Andromeda, the Virgo cluster, the cosmic web filaments and the CMB, and back again.

---

## 2. Tech stack (pinned)

**Runtime dependencies**

| Package | Version | Use |
|---|---|---|
| three | 0.186.1 | `WebGLRenderer`, WebGL2 only, with `logarithmicDepthBuffer`. Pinned because postprocessing 6.39.5 requires three below 0.187. |
| @types/three | 0.186.0 | Type definitions. |
| postprocessing | 6.39.5 | HalfFloat `EffectComposer`, mip-chain bloom, AgX `ToneMappingEffect`, SMAA. |
| astronomy-engine | 2.1.19 | Ephemerides, `RotationAxis`, eclipse search, `LagrangePoint`, ΔT. |
| comlink | 4.4.2 | Worker RPC (catalogue decode, terrain patches, star sectors). |
| fast-png | 8.0.0 | 16-bit PNG decode in workers (heightmaps, Terrarium tiles). |
| simplex-noise | 4.0.3 | Seeded CPU noise in terrain workers. |
| fuse.js | 7.x | Fuzzy search. Exact version pinned at scaffold time. |
| preact | 10.x | HUD. Exact version pinned at scaffold time. |
| @preact/signals | 10.x-compatible | HUD state. Exact version pinned at scaffold time. |
| lil-gui | 0.21.0 | Debug panel behind `?debug`. |
| stats-gl | 4.2.3 | Performance overlay behind `?perf`. |

**Development and tooling**

- vite 8.3.4
- typescript 5.9.3 (not TS 7)
- vitest 5.0.4
- @playwright/test 1.56.1 exactly. This matches the preinstalled `/opt/pw-browsers/chromium-1194`.
- sharp 0.35.5
- d3-celestial 0.7.35 (data only, never bundled)
- prettier 3

**Contingency rule.** If vite 8 and vitest 5 fail at scaffold time, the scaffold agent pins vite 7.3.x with a compatible vitest and records this in CLAUDE.md.

**CI.** Node 22, pnpm 10.28. GitHub Actions: `actions/checkout@v5`, `pnpm/action-setup@v4`, `actions/setup-node@v5`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v4`, `actions/deploy-pages@v4`.

**Not used:** WebGPU/TSL, `EXT_clip_control`, 3D render targets, eslint (to save cost), Git LFS (GitHub Pages does not serve LFS).

---

## 3. Architecture

### 3.1 Module layout

```
/                      package.json, pnpm-lock.yaml, vite/vitest/playwright configs, tsconfig, index.html,
                       CLAUDE.md, .gitattributes (*.bin *.png *.webp *.jpg binary), .gitignore (.cache dist artifacts)
.github/workflows/     ci.yml, deploy.yml
docs/                  CONTRACTS.md, DATA_SOURCES.md, modules/<module>.md, modules/data-formats.md,
                       requests/<pkg>.md, status/<pkg>.md, demos/phase-N.md
assets/manifest/       <module>.json   (per-module asset manifest fragments: url, sha256, license, attribution, outputs)
tools/lib/             curl fetch + sha256 verify, sharp helpers, binary writers, radix-2 FFT   (frozen after P1)
tools/                 fetch-assets.mjs, build-credits.mjs, size-guard.mjs, gen-bluenoise.mjs, build-<module>.mjs
public/textures/<module>/  public/data/<module>/  public/credits.json
src/core/              math64, frames, time, photometry, units, cosmology-constants, contracts.ts, discover.ts,
                       workers.ts, assets.ts, quality.ts, budget.ts
src/render/            renderer.ts, passes.ts, exposure.ts, screenpass-host.ts, post.ts,
                       chunks/{depth,rte,noise,blackbody,shadows,phase}.glsl
src/camera/            free.ts, orbit.ts, walk.ts, autopilot.ts, speed.ts, collision-hook.ts
src/app/               boot.ts, loop.ts, url-state.ts, test-api.ts, onboarding.ts
src/ui/                preact shell, palette, info card, time bar, HUD, labels overlay, settings
src/modules/<name>/    index.ts (exports UniverseModule), public.ts (cross-module API), height/*.ts (worker height fns), private files
tests/unit/<area>/     tests/e2e/<module>.spec.ts     tests/fixtures/<module>/
```

Planned modules by phase:

| Phase | Modules |
|---|---|
| P1 | `solar-system`, `stars`, `_debug` |
| P2 | `terrain`, `atmosphere`, `earth`, `surfaces` |
| P3 | `giants`, `rings`, `sun`, `smallbodies`, `eclipses` |
| P4 | `milkyway`, `blackholes`, `starsystems`, `exoplanets` |
| P5 | `galaxies`, `cosmicweb`, `tours`, `photo`, `audio` |

### 3.2 Scale and precision strategy (settled in P1, never revisited)

**Float64 frame tree.** All positions are in metres, stored as Float64.

```
universe  (supergalactic axes, origin = Milky Way centre)
├─ mw  (IAU galactic axes, origin = Sgr A*)
│   ├─ ssb  (ICRF/J2000 equatorial axes, origin = Solar System barycentre; Sun at R0 = 8.178 kpc, z0 = +20.8 pc)
│   │   └─ <body> inertial frames  →  <body>.fixed  (IAU WGCCRE pole and W(t))
│   ├─ star:<HIP>  (created on demand)
│   └─ bh:<id>
└─ gal:<id>
```

Every frame node has `positionAt(jd, out)`, an optional `orientationAt`, and an `influenceRadius`.

**Lowest-common-ancestor transforms.** `relative(a, b)` walks up to the lowest common ancestor and subtracts only small local offsets. The error is bounded by the scale of that ancestor: below 1e-9 m for a pair of points on Earth's surface.

**Camera.** The camera state is `{frame, local: Vec3d, quat}`. Each frame it re-anchors to the deepest frame whose influence radius contains it, with 10% hysteresis.

**Camera-relative rendering.** The three.js camera always sits at the origin and only rotates. Each Renderable sets `object.position = Float32(toCamera(frame, local))`. Rules for specific cases:
- **Large point clouds** (stars in pc, asteroid elements in AU, galaxies in Mpc) receive the camera position relative to the cloud origin as a high/low float pair, `uCamHigh` and `uCamLow`. The vertex shader computes `(p - uCamHigh) - uCamLow` (the `rte.glsl` chunk).
- **Terrain vertices** are Float32 offsets from a tile centre that the worker computes in Float64. Precision is below 1 mm at level 20.
- **Fragment detail noise** uses per-octave-band domain origins `frac(centre/λ/P)·P`, computed in Float64 and passed as uniforms, with periodic noise. This avoids blocky Float32 noise at walking scale.
- **Star promotion.** When you approach within 0.5 pc of a star, or select it as a target, it gets its own Float64 frame and Body. Point sprites cannot be precise at close range, so this hand-off is required.

**Depth.**
- three's `logarithmicDepthBuffer` is on, with near = 0.05 m and far = 1e27 m. Relative precision is about 4e-6, which is about 4 cm at 10 km.
- Every custom shader includes `chunks/depth.glsl`. It provides the log-depth write and `linearFromLogDepth(d) = exp2(d·log2(far+1)) - 1`.
- A vitest "conventions" test fails if any `ShaderMaterial` source lacks the chunk.
- Background layers are drawn without depth.

**Speed.**
- Speed is `v = k · d_nearest`.
- `d_nearest` is the distance to the nearest of: a body surface (radius plus terrain height), a promoted-star radius, or a galaxy radius.
- `k` ranges from 0.1/s to 5/s and is adjusted with the mouse wheel or the `[` and `]` keys.
- Changes are smoothed with a critically damped spring.
- Speed is clamped to [0.5 m/s, 1e27 m/s].
- The HUD shows m/s, then multiples of c, then ly/s, then Mpc/s.

**Time.**
- `SimClock` holds the Julian Date in TT as Float64. astronomy-engine handles UT/ΔT.
- Warp ladder: pause, ±1, 60, 3600, 86400, 2.6e6, 3.15e7, 3.15e9, 3.15e11, 1e13 (1e13 is about 300 kyr/s).
- A validity badge shows which model is active:
  - Planets use astronomy-engine within ±10 kyr and are frozen beyond that.
  - Stellar proper motion is linear up to ±1 Myr.
  - Galactic rotation is used beyond that.

**Photometry** (`src/core/photometry.ts`).
- Illuminance from magnitude: `E = 2.54e-6 lux · 10^(-0.4m)`.
- Apparent magnitude: `m = M + 5·log10(d/10 pc)`.
- B-V to Teff: Ballesteros (2012).
- Teff to linear sRGB: a 256-entry DataTexture LUT from 1000 K to 40000 K, built at startup by integrating Planck against tabulated CIE 1931 2° colour-matching functions.
- Solar irradiance falls off as 1/r².
- Planets drawn as points: `flux = E_sun(r) · albedo · πR² · LambertPhase(α) / (π·Δ²)`. This works from any viewpoint.

**Pre-exposure.**
- Every shader outputs `L[cd/m²] · uExposure`, so the Sun (1.6e9 cd/m²) and starlight both fit in half-float.
- The exposure value comes from the log-average luminance: a downsample to 1×1, read back asynchronously every 4 frames with `readRenderTargetPixelsAsync`, falling back to a synchronous read.
- Eye adaptation uses τ = 0.5 s when getting brighter and 2 s when getting darker.
- Test mode uses the fixed `ev` from the bookmark.

### 3.3 Frame pipeline (`src/render`, integrator-owned)

1. **Background scene.** No depth, additive HDR. Contents: Milky Way diffuse panorama or Milky Way sky cube, galaxies, cosmic web, CMB, stars.
2. **Main scene.** `clear=false`, log depth, with a depth texture. Opaque objects (bodies, terrain), then transparent ones (clouds, rings, tails, particles).
3. **ScreenPass stage `atmosphere`.** Sky, aerial perspective, and background transmittance (this is what makes stars vanish in daylight).
4. **ScreenPass stage `lensing`.** Black holes.
5. **ScreenPass stage `effects`.**
6. **Exposure measurement.**
7. **EffectPass.** Mip bloom, AgX, SMAA (off in potato), and a vignette in photo mode only.
8. **DOM overlay.** Labels (decluttered by priority, at most 64, occlusion tested by ray-sphere) and the HUD.

**Quality presets.**

| Preset | Notes |
|---|---|
| potato | Tests only: 480×270, minimum steps, terrain tile cap 64. |
| low | |
| medium | Default until P5's auto-detect. |
| high | |
| ultra | Streams 8k textures. |

Presets control render scale, raymarch steps, point counts, terrain screen-space-error target and tile cap (64/192/384/768/1024), and texture tier.

**ResourceBudget.** Tracks GPU bytes per module with LRU eviction. Caps are 128, 256 and 512 MB.

### 3.4 Plug-in registry API (`src/core/contracts.ts`, frozen at the end of P1; afterwards only optional fields may be added)

```ts
export type FrameId = string; export type JD = number;           // JD in TT, float64
export interface Vec3d { x: number; y: number; z: number }       // metres, float64
export interface Quatd { x: number; y: number; z: number; w: number }
export interface FrameDef { id: FrameId; parent: FrameId | null; influenceRadius: number;
  positionAt(jd: JD, out: Vec3d): Vec3d; orientationAt?(jd: JD, out: Quatd): Quatd }
export interface UniverseModule { id: string; dependsOn?: string[]; init(ctx: ModuleContext): void | Promise<void> }
export interface ModuleContext { frames: FrameTree; clock: SimClock; registry: Registry; render: RenderApi;
  assets: AssetLoader; workers: WorkerPool; quality: QualityState; camera: CameraApi; ui: UiApi; budget: ResourceBudget }
export interface Registry {
  addFrame(f: FrameDef): void; addBody(b: Body): void; addRenderable(r: Renderable): void; addScreenPass(p: ScreenPass): void;
  setSurfaceShading(s: SurfaceShading): void;            // highest priority per bodyId wins
  setSurfaceGeometry(g: SurfaceGeometryProvider): void;  // 'sphere' (P1, prio 0) or 'terrain' (P2, prio 10)
  addHeightSource(h: HeightSourceSpec): void; addOccluders(p: OccluderProvider): void;
  addSearch(p: SearchProvider): void; addInfo(p: InfoProvider): void; addBookmarks(b: Bookmark[]): void;
  addTour(t: TourDef): void; addSetting(s: SettingDef): void; addValidity(v: ValidityRange): void }
export interface Body { id: string; name: string; kind: 'star'|'planet'|'dwarf'|'moon'|'minor'|'comet'|'blackhole'|'spacecraft'|'galaxy';
  frame: FrameId; fixedFrame?: FrameId; parent?: string; radius: number; oblateness?: number; gm?: number;
  influenceRadius: number; albedo?: number; teff?: number; absMag?: number; simulated?: boolean }
export interface Renderable { id: string; layer: 'background'|'opaque'|'transparent'|'overlay'; object: THREE.Object3D;
  update(view: ViewState): void; memoryBytes(): number; dispose(): void }
export interface ScreenPass { id: string; stage: 'atmosphere'|'lensing'|'effects'; order: number; active(view: ViewState): boolean;
  render(gl: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, depth: THREE.DepthTexture, output: THREE.WebGLRenderTarget, view: ViewState): void }
export interface SurfaceShading { bodyId: string; priority: number;
  glsl: string;   // defines: vec3 shadeSurface(SurfaceInput s) — shared by sphere and terrain geometry
  uniforms: Record<string, THREE.IUniform>; update?(view: ViewState): void }
export interface SurfaceGeometryProvider { bodyId: string | '*'; priority: number; wants(view: ViewState, body: Body): boolean;
  build(body: Body, shading: SurfaceShading): Renderable }
export interface HeightSourceSpec { bodyId: string; workerModule: string;  // key into import.meta.glob('/src/modules/*/height/*.ts')
  params: unknown; maxAbsHeight: number }
export interface OccluderProvider { receivers: string[] | '*'; occluders(view: ViewState): { bodyId: string; radius: number }[] }
export interface ViewState { jd: JD; dtReal: number; dtSim: number; frame: FrameId; cameraLocal: Vec3d; cameraQuat: Quatd;
  fovY: number; viewport: [number, number]; pixelAngle: number; exposure: number; quality: QualityPreset; test: boolean;
  toCamera(frame: FrameId, local: Vec3d, out: Vec3d): Vec3d; sunToCamera(out: Vec3d): Vec3d;
  nearestSurface(): { bodyId: string; altitude: number } | null }
export interface Bookmark { id: string; title: string; frame: FrameId; pos: Vec3d; quat?: Quatd; lookAt?: string;
  jd?: JD | 'now'; ev?: number /* fixed exposure for tests */; lookTarget?: string /* what a reviewer should see */ }
```

**Discovery.** `src/app/discover.ts` runs `import.meta.glob('/src/modules/*/index.ts', {eager: true})`, sorts the modules topologically by `dependsOn`, then calls `init`. Heavy code is lazily imported inside each module. Height functions run in the worker through the same glob, so no shared registration file exists anywhere.

**Test API.** `window.__universe` exists only with `?test=1` or in dev. It provides:
- `ready()`: resolves when assets are loaded and the tile queue is empty.
- `renderFrames(n)`: the requestAnimationFrame loop is disabled in test mode, so frames advance only through this call.
- `goto(bookmarkId)`, `setTime(iso)`, `stats()`.
- `probe(x, y, w, h)`: mean linear RGB of the final canvas.
- `errors()`.

`stats()` returns `renderer.info` calls, triangles, programs, textures and geometries, plus tile count and gpuBytes.

### 3.5 File ownership rules (two parallel agents never touch the same file)

- **Integrator-owned** (after the P1 scaffold and engine packages): root configs, `package.json`, the lockfile, `.github/**`, `CLAUDE.md`, `docs/CONTRACTS.md`, `src/core/**`, `src/render/**`, `src/camera/**`, `src/app/**`, `tools/lib/**`, `tools/{fetch-assets,build-credits,size-guard}.mjs`. Only the phase integrator edits these, unless a package brief explicitly grants a path.
- **Package-owned:**
  - `src/modules/<module>/**`
  - `tests/unit/<module>/**`
  - `tests/e2e/<module>.spec.ts`
  - `tests/fixtures/<module>/**`
  - `tools/build-<module>.mjs`
  - `assets/manifest/<module>.json`
  - `public/{textures,data}/<module>/**`
  - `docs/modules/<module>.md`
  - `docs/status/<pkg>.md`
  - `docs/requests/<pkg>.md`
- **`src/ui/**` ownership by phase:** P1-D owns it in P1, the integrator in P2-P4, and P5-B in P5. `src/modules/stars/**` passes from P1-D to P4-C.
- **Cross-module imports** are allowed only from `src/core/**`, `src/render/chunks/**`, and another module's `public.ts`, and are read-only. A vitest boundary test enforces this.
- **No new npm dependencies after P1-W0.** If one is needed, write it in `docs/requests/<pkg>.md`. The same applies to contract changes: write the request, add a shim inside your own module, and the integrator lands the change.
- **Worktrees and ports:**
  - Each package works in `/home/user/wt/<pkg>` on branch `p<N>-<pkg>`.
  - Wave slot A uses `E2E_PORT=4173` and slot B uses `4174`.
  - `pnpm e2e` wraps Playwright in `flock /tmp/universe-pw.lock`, so SwiftShader runs are serialized across the 4 CPUs.
  - Only the integrator pushes `main`.

### 3.6 Agent operating rules (CLAUDE.md, under 2k tokens)

- **Read only:** CLAUDE.md, `docs/CONTRACTS.md`, your brief, files you own, and the `public.ts` of your dependencies.
- **Never read:** `node_modules`, `.cache`, `public/data/**`, `public/textures/**`, `dist`, the lockfile, or other packages' artifacts.
- **Commands:**
  - `pnpm typecheck`
  - `pnpm test -- <module> --reporter=dot`
  - `pnpm e2e -- tests/e2e/<module>.spec.ts`
- **Screenshots:** at most 6 inspections per implementer, always at 480×270 on the potato preset.
- **Turn caps:** implementer 150, reviewer 50, integrator 80. On hitting the cap, commit and write `docs/status/<pkg>.md` (done, gaps, requests; at most 30 lines).
- **Hand-entered numbers** live in JSON rows with a `source` field. Anything uncertain is labelled `approximate` in the UI.
- **Every brief contains:** owned globs, inputs, the contracts it implements, a deliverables checklist, unit test names, e2e bookmarks with look targets, the budget, and the branch, worktree and port.

---

## 4. Data and assets (verified sources only)

### 4.1 Build-time sources

All downloads go through `tools/fetch-assets.mjs`. It shells out to `curl -fsSL --retry 3` because curl is already configured for the proxy and CA. Node's `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set. Downloads land in `.cache/raw/` (gitignored), and each file's sha256 is recorded in its module's manifest fragment and then verified. Only processed outputs are committed.

| Source | URL / package | License | Script → output |
|---|---|---|---|
| three.js Earth set | `https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/` `earth_day_4096.jpg`, `earth_night_4096.jpg`, `earth_bump_roughness_clouds_4096.jpg`, `earth_normal_2048.jpg`, `earth_specular_2048.jpg` | MIT repo; NASA Blue/Black Marble public domain | build-solar-system → `textures/solar-system/earth_{day,night}_{2k,4k}.webp`, `earth_brc_4k.webp` (lossless, channel-packed), `earth_{normal,spec}_2k.webp` |
| three.js misc | `.../examples/textures/waternormals.jpg`; `.../cube/MilkyWay/dark-s_{px,nx,py,ny,pz,nz}.jpg` | MIT | `textures/earth/waternormals.webp`; fallback sky cube `textures/stars/fallback_*.webp` |
| three-globe | `https://raw.githubusercontent.com/vasturiano/three-globe/master/example/img/earth-topology.png`, `earth-water.png` | MIT; NASA/ETOPO public domain | build-surfaces → `data/surfaces/earth_height_2k.png` (16-bit, smoothed), `earth_ocean_2k.png` |
| Solar System Scope 8k | `https://media.githubusercontent.com/media/computationalcore/worldline-kinematics/main/apps/web/public/textures/` `8k_sun.jpg`, `8k_mercury.jpg`, `8k_moon.jpg`, `8k_mars.jpg`, `8k_jupiter.jpg`, `8k_saturn.jpg`, `8k_saturn_ring_alpha.png`, `8k_venus_surface.jpg` | CC BY 4.0 (Solar System Scope / INOVE) | build-solar-system → `<body>_{2k,4k}.webp`; `venus_radar_2k.webp` |
| SSS Milky Way | `https://media.githubusercontent.com/media/ebiederstadt/solar-system/master/assets/textures/8k_stars_milky_way.jpg` | CC BY 4.0 | build-stars → `textures/stars/milkyway_diffuse_{2k,4k}.webp` (point stars removed with a sharp median plus min filter; HYG supplies the stars) |
| Celestia hires | `https://raw.githubusercontent.com/CelestiaProject/CelestiaContent/master/textures/hires/` io.png, europa, ganymede, callisto, titan.png, enceladus, mimas, tethys, dione, rhea, iapetus, miranda, ariel, triton, phobos, deimos, ceres, vesta, pluto, charon, venus (cloud tops), uranus, neptune, saturn-rings.png, uranus-rings.png, plus every `<file>.license` | Per-file SPDX: CC-BY-4.0 / CC-BY-3.0 / GPL-2.0+ default. **pluto.jpg is CC-BY-NC-SA-3.0** and is flagged in credits. | build-solar-system → `<moon>_2k.webp`, `uranus_4k.webp`, `neptune_4k.webp`; build-giants-rings → `data/rings/{saturn,uranus}_profile.png` (4096×1) |
| Celestia normals | `.../textures/hires/moon-normal.png`, `mars-normal.png` | GPL-2.0-or-later (LOLA/MOLA-derived) | build-surfaces → Frankot-Chellappa → `data/surfaces/{moon,mars}_height_2k.png` (16-bit), `{moon,mars}_normal_2k.webp` |
| HYG v4.1 | `https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv` | CC BY-SA 4.0 | build-stars → `data/stars/stars.bin` (SoA, 24 B/star: f32×3 xyz [pc, ICRS, Sun-centred], f16 absMag, u8 B-V quantised, u8 flags, f16×3 v [km/s], u16 name index; about 2.9 MB), `names.json` |
| Stellarium modern sky culture | `https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern/index.json` | CC BY-SA 4.0 | build-starsystems → `data/starsystems/constellations.json` (HIP polylines and names) |
| d3-celestial | npm `d3-celestial@0.7.35` `data/mw.json`, `constellations.json` | BSD-3 | `mw.json` is used only in the Milky Way calibration unit test; constellation label positions |
| OpenNGC | `https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv` + `addendum.csv` | CC-BY-SA-4.0 | build-starsystems → `data/starsystems/dso.json`; galaxy common names cross-referenced in build-galaxies |
| Celestia data | `https://raw.githubusercontent.com/CelestiaProject/CelestiaContent/master/data/` `galaxies.dsc`, `globulars.dsc`, `solarsys.ssc`, `minormoons.ssc`, `outersys.ssc`, `dwarfplanets.ssc`, `asteroids.ssc`, `comets.ssc` | GPL-2.0-or-later (kept as attributed data files) | `data/solar-system/bodies.json` (elements, radii, rotation); `data/smallbodies/*.json`; `data/milkyway/globulars.json`; `data/galaxies/galaxies.bin` |
| Open Exoplanet Catalogue | `https://raw.githubusercontent.com/OpenExoplanetCatalogue/oec_tables/master/comma_separated/open_exoplanet_catalogue.txt` | MIT | build-exoplanets → `data/exoplanets/exoplanets.json` |
| astronomy-engine | npm 2.1.19 | MIT | Runtime ephemerides |
| Hand-curated JSON | Written by agents, `source` field on every row | Ours (CC BY 4.0) with citations | `blackholes.json` (Sgr A*, M87*, Cyg X-1, Gaia BH1/2/3, V404 Cyg, A0620-00), `sstars.json` (Gillessen 2017), `binaries.json` (α Cen, Sirius), `localgroup.json` (M31, M33, LMC, SMC parameters), `nebulae.json` (distances), `superclusters.json`, `milkyway-model.json` (Reid 2019, GRAVITY R0) |
| Procedural | `gen-bluenoise.mjs` (64² void-and-cluster); `build-cosmicweb.mjs` (Zel'dovich) | Ours | `data/render/bluenoise64.png`, `data/cosmicweb/web.bin` (about 1.5 MB) |

### 4.2 Offline scripts

| Script | Owner | Phase | Purpose |
|---|---|---|---|
| `fetch-assets.mjs` | P1-B | P1 | Reads all manifest fragments; curl download plus sha256 check. |
| `build-credits.mjs` | P1-B | P1 | Writes `public/credits.json` and `CREDITS.md`, including copies of the `.license` files. |
| `size-guard.mjs` | P1-W0 | P1 | Enforces the size limits in 4.4. |
| `gen-bluenoise.mjs` | P1-A | P1 | Blue-noise texture. |
| `build-solar-system.mjs` | P1-B | P1 | Planet and moon textures, `bodies.json`. |
| `build-stars.mjs` | P1-B | P1 | `stars.bin`, names, Milky Way diffuse panorama. |
| `build-surfaces.mjs` | P2-C | P2 | Frankot-Chellappa via the `tools/lib` FFT; Earth heights; Terrarium-encoded test fixtures. |
| `build-giants-rings.mjs` | P3-A | P3 | Ring profiles. |
| `build-smallbodies.mjs` | P3-B | P3 | Small-body elements. |
| `build-starsystems.mjs` | P4-C | P4 | Constellations and DSO data. |
| `build-exoplanets.mjs` | P4-C | P4 | Exoplanet catalogue. |
| `build-galaxies.mjs` | P5-A | P5 | Galaxy catalogue binary. |
| `build-cosmicweb.mjs` | P5-A | P5 | 128³ field, Eisenstein-Hu no-wiggle P(k), σ8 = 0.81, Zel'dovich at z = 0, 250k Int16 tracers. |

All scripts are deterministic and re-runnable.

### 4.3 Optional runtime streaming

These are off by default. Each sits behind a flag, uses an `AbortController` timeout, caches through the Cache API, shows the bundled asset first and crossfades to the streamed one, and shows an "HD layer unavailable" toast on failure.

- **Ultra textures.** The `ultra` preset streams 8k Earth day/night, Moon, Mars and Mercury from the `media.githubusercontent.com` SSS paths above (CORS * is verified). Timeout 8 s.
- **Earth HD terrain.** `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` at z5-z12. This is unverified from the container. Playwright routes these URLs to `tests/fixtures/surfaces/` tiles, so the code path is tested deterministically. Fallback: the baked 2k height plus procedural detail.
- **NASA GIBS daily imagery.** Reserve-only "could" item.

### 4.4 Size budget and licensing

- **Size.** About 36 MB is expected. CI fails if:
  - `public/` exceeds 60 MB,
  - any single file exceeds 15 MB, or
  - the boot critical path (JS, Earth 2k set, `stars.bin`, Milky Way 2k) exceeds 8 MB.
- **Licensing.** App code is MIT. Data under `public/data` and `public/textures` keeps its upstream licences: CC BY-SA derived binaries stay CC BY-SA, and Celestia data stays GPL as an aggregate. An in-app Credits panel and `CREDITS.md` are generated from the manifests. Pluto's NC licence is flagged; a procedural Pluto is the fallback if the user ever wants commercial use.

---

## 5. Phases

| Phase | Implementers | Review/integration | Overhead/slack | Est. cost | Cumulative |
|---|---|---|---|---|---|
| P1 First Light | 5 (W0 + 2×2) | R1 $3 | $2 | **$42** | $42 |
| P2 Worlds | 3 | R2a $3 + R2b $4 | $2 | **$42** | $84 |
| P3 Grand Tour | 2 | R3 $5 | $4 | **$30** | $114 |
| P4 The Galaxy | 3 | R4a $3 + R4b $4 | $2 | **$42** | $156 |
| P5 Cosmos & Showtime | 2 | R5 $5 | $6 | **$34** | **$190** |
| Reserve | Not scheduled | | | **$50** | $240 |

Orchestration overhead is included in each phase. Every integrator also applies up to 5 fixes from the previous phase's demo feedback.

### Phase 1: "First Light". A deployed, flyable, real-time Solar System under real stars ($42)

**Goal.** Freeze contracts, precision, depth, photometry, the test harness and CI/Pages. Ship a navigable Solar System with ephemeris accuracy and the HYG sky.

| Wave | Package (agent) | Owns | Deliverables | Cost |
|---|---|---|---|---|
| W0 (solo) | **P1-W0 scaffold** | All root files, `.github/**`, `CLAUDE.md`, `docs/CONTRACTS.md`, `src/core/contracts.ts`, `src/main.ts`, `tools/size-guard.mjs`, `tests/e2e/smoke.spec.ts` | See list below. | $5 |
| W1 (A) | **P1-A engine** | `src/core/**` (except contracts), `src/render/**`, `src/camera/**`, `src/app/**`, `src/modules/_debug/**`, `tools/gen-bluenoise.mjs`, `tests/unit/{core,render,camera}/**`, `tests/e2e/engine.spec.ts` | See list below. | $10 |
| W1 (B) | **P1-B assets** | `tools/lib/**`, `tools/{fetch-assets,build-credits,build-solar-system,build-stars}.mjs`, `assets/manifest/{solar-system,stars}.json`, `public/{textures,data}/{solar-system,stars}/**`, `public/credits.json`, `CREDITS.md`, `docs/modules/data-formats.md`, `tests/unit/tools/**` | All P1 textures, `bodies.json`, `stars.bin`, `names.json`, Milky Way diffuse panorama, credits generator, data-format documentation, decoder round-trip tests | $6 |
| W2 (A) | **P1-C solar-system** | `src/modules/solar-system/**`, its tests and e2e | See list below. | $8 |
| W2 (B) | **P1-D stars + UI** | `src/modules/stars/**`, `src/ui/**`, their tests and e2e | See list below. | $8 |
| W3 | **R1 integrator/reviewer** | Integrator-owned files | See list below. | $3 |

**P1-W0 scaffold delivers:**
- All dependencies pinned.
- Vite with `base` taken from `GITHUB_REPOSITORY` (`/my-third-repo/`), `?raw` GLSL imports and ES workers.
- Playwright: `/opt/pw-browsers` locally, SwiftShader args, 480×270, 1 worker, 120 s timeout, `webServer` running `vite preview --port $E2E_PORT`.
- The full contracts file plus `CONTRACTS.md`.
- `ci.yml` and `deploy.yml`.
- A boot page with `__universe.ready()`.
- Pushed to `main`, and **the user enables Pages**.

**P1-A engine delivers:**
- **Core:** math64, frame tree (lowest-common-ancestor walk, re-anchoring), SimClock with ΔT and validity badges, photometry and blackbody LUT, comlink worker pool, asset loader, quality presets, ResourceBudget.
- **Render:** two scenes, HalfFloat render targets, log-depth chunk, ScreenPass host, pre-exposure with async readback, bloom, AgX and SMAA, GLSL chunks (`depth`, `rte`, `noise`, `blackbody`, `phase`, `shadows`). `shadows.glsl` handles up to 4 analytic sphere occluders using circle-overlap umbra and penumbra.
- **Camera:** free 6DOF and orbit modes, van Wijk-Nuij goto (ρ = 1.4, 3-12 s), distance-scaled speed, `GroundProvider` hook.
- **App:** URL hash state (`#f=&p=&q=&t=` or `#b=`), test API, `_debug` sphere module.

**P1-C solar-system delivers:**
- **Ephemerides and frames:** astronomy-engine `HelioState`, `GeoMoonState`, `JupiterMoons` and `RotationAxis`. A Kepler propagator using Celestia `.ssc` elements covers the other ~25 moons plus Pluto, Charon and Ceres. Frames cover the Sun, 8 planets, dwarf planets and moons.
- **Geometry and shading:** cube-sphere `SurfaceGeometryProvider` (priority 0). Default `SurfaceShading` uses albedo with Lommel-Seeliger for airless bodies and Lambert otherwise. Earth gets day/night and city lights. Eclipses use `shadows.glsl`.
- **Sun v1:** limb-darkened emissive disk plus glow.
- **Points and orbits:** photometric point LOD (planets below 2 px are points), Float64 orbit lines re-centred every frame.
- **Data:** bookmarks for every body, plus search and info providers. Facts such as gravity, day length and year length are computed from data.

**P1-D stars + UI delivers:**
- **Stars:** `stars.bin` decoded in a worker. Background point sprites use RTE double-single positioning, per-frame apparent magnitude, a Gaussian core plus 1/r² halo PSF, and colour from the B-V LUT. The Sun is excluded from the point cloud.
- **Panorama:** Milky Way diffuse panorama with its orientation checked against an overlay of the HYG mag < 2 stars.
- **UI:** a Preact shell with:
  - a `/` and Ctrl+K palette (fuse.js over bodies and named stars),
  - an info card,
  - a time bar (warp ladder, date picker, Now, validity badge),
  - a HUD (speed, distance, light-time, scale bar, breadcrumbs),
  - copy-link,
  - a decluttered labels overlay,
  - `?debug` lil-gui.

**R1 integrator/reviewer:**
- Merge, run the full unit and e2e suites, review the contact sheet, fix contract mismatches.
- Freeze the contracts.
- Push `main` and confirm Pages is live.
- Write `docs/demos/phase-1.md`.

**Verification.**
- **Unit tests:**
  - Precision: an object 1 m away stays below 1 mm error while the anchor is 1e22 m from the root.
  - Ephemeris parity with astronomy-engine within 1e-9 AU.
  - Moon periods match the `.ssc` data within ±0.5%.
  - Earth perihelion is about 0.9833 AU in early January 2026.
  - Sun magnitude −26.74 at 1 AU.
  - B-V of 0.65 gives about 5800 K.
  - Sirius is m = −1.46 ± 0.05.
  - From α Cen, the Sun is m ≈ 0.47 at RA ≈ 2h39m, Dec ≈ +60.8°.
  - Goto distance is monotonic in log space.
- **E2E bookmarks:** `earth-now`, `saturn`, `jupiter-moons`, `orion-from-earth`, `solar-system-overview`, plus a palette spec (type "Saturn", arrive within 12 s).
- **Budgets:** draw calls ≤ 150.

**Demo.** Open the live URL.
- You start above Earth's terminator at the current instant, with the Moon where it really is.
- Press `/`, type "Titan", and arc there.
- Warp at 1 day/s to watch the Galilean moons.
- Find Orion (Betelgeuse orange, Rigel blue).
- Fly out until the Sun is a star.
- Copy the link and open it in a new tab to land in the same view.
- The user checks spend: about $42 expected.

### Phase 2: "Worlds in immense detail" ($42)

**Goal.** Seamless orbit-to-walking terrain, physically based atmospheres and a hero Earth.

| Wave | Package | Owns | Deliverables | Cost |
|---|---|---|---|---|
| W1 (A) | **P2-A terrain** | `src/modules/terrain/**` and its tests and e2e | See list below. | $12 |
| W1 (B) | **P2-B atmosphere + earth** | `src/modules/{atmosphere,earth}/**` and their tests and e2e | See list below. | $11 |
| W2 (A) | **P2-C surfaces** | `src/modules/surfaces/**` (incl. `height/*.ts`), `tools/build-surfaces.mjs`, `assets/manifest/surfaces.json`, `public/data/surfaces/**`, `tests/fixtures/surfaces/**` | See list below. | $10 |
| W2 (B) | **R2a reviewer** | Read-only | Reviews the P2-A and P2-B diffs and screenshots against the look targets; writes a fix list | $3 |
| W3 | **R2b integrator** | Integrator files | See list below. | $4 |

**P2-A terrain delivers:**
- **Quadtree:** cube-sphere with 6 roots, 33×33 patches with skirts, maximum level 22.
- **Selection and culling:** screen-space-error split/merge with hysteresis (2 px on medium), ellipsoid horizon and frustum culling, per-frame split budget (lifted in test mode).
- **Generation:** comlink workers build each patch with a Float64 tile centre, Float32 local offsets and normals. `HeightSource` functions load through the worker glob.
- **Cache and detail:** LRU tile cache with per-preset caps; per-band Float64 noise origins for fragment detail.
- **Hand-off:** registers geometry at priority 10 when altitude < 3 R.
- **Walking:** CPU `GroundProvider` collision that is identical to the mesh; walk mode (G key, 1.7 m eye height, g = GM/R², jump).
- **Testing:** a default `fbm-craters-lite` height source.

**P2-B atmosphere + earth delivers:**
- **Hillaire LUTs:**
  - transmittance 256×64 and multiscatter 32×32 (rebuilt only when parameters change),
  - sky-view 192×108 every frame,
  - aerial perspective as 32 slices packed into a 1024×32 2D atlas.
- **Per-planet parameters:** Earth, Mars (dust Mie, giving blue sunsets), Venus, Titan, gas-giant limb haze.
- **Composite:** an `atmosphere` ScreenPass that applies sky, aerial perspective and background transmittance, so stars vanish in daylight. A TypeScript twin of the transmittance supports tests.
- **Earth shading override (priority 10):** GGX ocean glint using the specular mask, plus waternormals at low altitude; night lights gated by the terminator; a cloud shell (B channel of the packed map plus fBm detail) with cloud shadows.
- **Default start:** becomes `earth-dawn-400km`.

**P2-C surfaces delivers:**
- **Height maps:** Frankot-Chellappa Moon and Mars heights; Earth 16-bit height plus ocean mask.
- **Height sources:**
  - Earth: bicubic raster, band-limited ridged fBm and ocean floor.
  - Moon, Mercury, Callisto and Ceres: raster plus a crater field with size-frequency N(>D) ∝ D⁻², bowl, rim and ejecta, and central peaks above the simple-to-complex transition (15 km scaled by g_moon/g).
  - Mars: raster plus craters plus dunes.
  - Europa: Worley ridges.
  - Io, and a generic icy source.
- **Materials:** Lommel-Seeliger with opposition surge for airless bodies, Oren-Nayar for Mars, triplanar slope-based detail.
- **Streaming:** the Ultra 8k streaming flag, and the Earth Terrarium HD flag with Playwright fixtures.

**R2b integrator:** merge, apply the fix list and the P1 feedback, run performance gates, run the leak and jitter specs, deploy, write `docs/demos/phase-2.md`.

**Verification.**
- **Unit tests:**
  - Neighbouring patch edges have identical heights.
  - Screen-space error is monotonic.
  - Vertex error < 1 mm at level 20.
  - Collision matches the mesh within 1 cm.
  - Crater size-frequency slope is −2 ± 0.2.
  - Frankot-Chellappa on a synthetic sphere has RMS error < 2%.
  - Earth zenith transmittance at 550 nm is 0.85-0.90.
  - Mars sky near a low Sun has B/R > 1.1.
  - Terrarium tiles decode correctly.
- **E2E bookmarks:** `moon-low-orbit`, `apollo11-2m`, `mars-gale-sunset`, `earth-limb-400km`, `earth-himalaya-fixture`.
- **Special specs:**
  - Jitter: two renders 1 mm apart differ by < 1% mean.
  - Leak: fly Earth → Saturn → Earth and textures return to baseline ±5%.
- **Budgets on medium:** ≤ 400 draw calls, ≤ 3M triangles.

**Demo.**
- One continuous descent from orbit to the Apollo 11 site with Earth overhead; walk and jump.
- Blue sunset at Gale crater.
- Sunrise over Earth's limb from 400 km with ocean glint, city lights and cloud shadows.
- Optional: the "HD Earth terrain" flag on the user's own browser.

### Phase 3: "Grand Tour". Showpieces of the Solar System ($30)

| Wave | Package | Owns | Deliverables | Cost |
|---|---|---|---|---|
| W1 (A) | **P3-A giants + rings** | `src/modules/{giants,rings}/**`, `tools/build-giants-rings.mjs`, `public/data/rings/**` and their tests | See list below. | $10 |
| W1 (B) | **P3-B sun + small bodies + eclipses** | `src/modules/{sun,smallbodies,eclipses}/**`, `tools/build-smallbodies.mjs`, `public/data/smallbodies/**` and their tests | See list below. | $11 |
| W2 | **R3 integrator + review** | Integrator files | Merge, review both packages, apply P2 feedback, deploy, write `docs/demos/phase-3.md` | $5 |

**P3-A giants + rings delivers:**
- **Gas-giant shading (priority 10):** base texture plus curl-noise domain-warped flow with latitude-dependent zonal drift; Great Red Spot vortex, Saturn's hexagon, Neptune's dark spot; limb darkening.
- **Shadows on giants:** moon shadow transits via `OccluderProvider`.
- **Rings:**
  - Saturn and Uranus annuli at true radii (D ring 66,900 km to F ring 140,180 km).
  - Radial profile from the Celestia strip plus SSS alpha, with procedural ringlets.
  - Henyey-Greenstein phase (forward-scattering dusty rings, backscattering B ring).
  - Planet shadow on the rings (ray-sphere) and ring shadow on the planet (ray-plane, inside Saturn's shader).
  - Camera-cell instanced ice particles from 1 cm to 10 m, following a power law, within 2 km of the ring plane.

**P3-B sun + small bodies + eclipses delivers:**
- **Sun shading (priority 10):** Worley granulation over supergranulation, Neckel-Labs limb darkening, sunspots following the solar-cycle phase, a corona shell, prominences, and a lens flare that is occlusion-tested.
- **Shared API:** `public.ts` exports `starSurface(teff, radius, logg)` for use in P4.
- **Asteroid belt:** GPU Kepler with 4 Newton iterations; 20k bodies on potato, 150k on medium, 400k on ultra. Kirkwood gaps at 3:1, 5:2, 7:3 and 2:1; Hildas; L4/L5 Trojans; Kuiper belt and plutinos.
- **Named bodies:** dwarf planets and comets from the `.ssc` files. Comets get an ion tail and a curved synchrone dust tail, with activity ∝ r⁻².
- **Close-up and markers:** 300 rocks near the camera; markers for Voyager 1/2, New Horizons, and JWST at L2.
- **Eclipses:** an eclipse and transit finder whose "next eclipse" bookmark places you on the ground at greatest eclipse.

**Verification.**
- **Unit tests:**
  - The Cassini Division lies at 117,580-122,170 km.
  - The Kepler solver converges up to e = 0.97.
  - There is a gap at 2.50 AU.
  - The 2024-04-08 greatest eclipse is near 25.3°N, 104.1°W at about 18:17 UTC.
  - The 2027-08-02 eclipse is total near Luxor.
- **E2E bookmarks:**
  - `saturn-backlit-2013-07-19`: rings brighter than the planet's night side.
  - `saturn-ring-particles`, `jupiter-io-shadow`, `sun-closeup`, `asteroid-belt-3au`, `eclipse-2027-luxor`, `halley-1986`.

**Demo.**
- Backlit Saturn, then a fly-through of the Cassini Division.
- The Great Red Spot with Io's shadow.
- A granulated Sun with a prominence.
- At 1 yr/s, the Kirkwood gaps and Trojans become visible.
- Halley's tails.
- "Next eclipse": totality in Luxor.

### Phase 4: "The Galaxy". Stars, Milky Way and black holes ($42)

| Wave | Package | Owns | Deliverables | Cost |
|---|---|---|---|---|
| W1 (A) | **P4-A milkyway** | `src/modules/milkyway/**`, `public/data/milkyway/**` and its tests | See list below. | $12 |
| W1 (B) | **P4-B blackholes** | `src/modules/blackholes/**` and its tests | See list below. | $11 |
| W2 (A) | **P4-C starsystems + exoplanets** | `src/modules/{starsystems,exoplanets,stars}/**`, `tools/build-{starsystems,exoplanets}.mjs` and their data | See list below. | $10 |
| W2 (B) | **R4a reviewer** | Read-only | Physics and performance audit of P4-A and P4-B: constants against citations, step budgets | $3 |
| W3 | **R4b integrator** | Integrator files | Merge, fixes, P3 feedback, deploy, `docs/demos/phase-4.md` | $4 |

**P4-A milkyway delivers:**
- **GalaxyModel** (TypeScript twin plus GLSL twin, driven by `milkyway-model.json`):
  - thin disk h_R 2.6 kpc, h_z 0.3 kpc;
  - thick disk h_R 2.0 kpc, h_z 0.9 kpc, 12% normalisation;
  - boxy bulge plus a long bar of half-length 5 kpc at 27°;
  - Reid-2019 log-spiral arms (Norma-Outer, Scutum-Centaurus, Sagittarius-Carina, Local, Perseus);
  - dust with h_z 0.1 kpc on the inner edges of the arms;
  - HII clumps.
- **Rendering:**
  - Quarter-resolution raymarch with 24/48/96/160 steps, blue-noise jitter, and temporal accumulation (off in test mode).
  - Outside view: a background Renderable.
  - Inside view: a 256² sky cube re-baked one face per frame whenever the camera moves more than 1% of its galactocentric distance.
  - Crossfade with the panorama within 300 pc of the Sun.
- **Stars and clusters:**
  - Procedural star sectors in a worker using a Kroupa IMF. They only emit stars fainter than HYG's completeness limit within 300 pc.
  - Globular clusters from `globulars.dsc` as King-profile point clouds.
- A "You are here" marker.

**P4-B blackholes delivers:**
- **Reference integrator:** a CPU TypeScript integrator used by the tests.
- **Lensing pass:** a half-resolution `lensing` ScreenPass using Cartesian RK4 on `x'' = -1.5 h² x / r⁵` (r_s = 1). Steps are ∝ r, with 64/128/256 steps by preset. Disk-plane crossings are interpolated, so the photon ring emerges naturally.
- **Disk:** Novikov-Thorne from r_isco = 3 r_s; g-factor with I ∝ g⁴ and colour = blackbody(gT); Keplerian-sheared noise.
- **Far field and background:** weak lensing from an α(b) LUT; a 256² background cube captured at the black hole every 30 frames.
- **Catalogue:**

| Object | Mass / distance |
|---|---|
| Sgr A* | 4.30e6 M☉, at the `mw` origin |
| M87* | 6.5e9 M☉, 16.8 Mpc |
| Cyg X-1 | 21.2 M☉, 2.22 kpc, with HDE 226868 and a particle stream |
| Gaia BH1/2/3 | |
| V404 Cyg | |
| A0620-00 | |

- **Toggles and S-stars:**
  - A "Realistic" setting renders Sgr A* as a dim radiatively inefficient flow; an "Illustrative" setting shows a bright disk.
  - Physics toggles: lensing, beaming, redshift, disk.
  - S-stars (S2, S29, S55 and about 5 more) with Schwarzschild precession.

**P4-C starsystems + exoplanets delivers:**
- **Constellations:** 3D lines from Stellarium HIP polylines.
- **Proper motion:** in the stars vertex shader.
- **Star promotion:** a Float64 frame and Body for the target star, with its surface drawn by `sun/public.starSurface`.
- **Binaries:** α Cen AB with Proxima, and Sirius AB.
- **Exoplanets:** OEC systems with procedural planets by class (lava, rocky, ocean, ice, sub-Neptune, gas giant, hot Jupiter), shown via `SurfaceShading` and labelled "artist's impression"; habitable-zone ring; bookmarks for TRAPPIST-1, Proxima b, Kepler-186f and 51 Peg b.
- **Deep-sky objects:** markers from OpenNGC plus `nebulae.json` distances; Pleiades and Hyades built from HYG members.

**Verification.**
- **Unit tests:**
  - The Sgr A* direction from the Sun is RA 17h45m40s, Dec −29°00′28″.
  - The Milky Way band centroid stays within |b| < 3° of the `mw.json` outline.
  - Black holes: photon sphere at 1.5 r_s, b_c = 2.598 r_s, weak-field deflection 2r_s/b within 1% at b = 1000.
  - S2: period 16.05 yr, pericentre 2018.38.
  - Barnard's Star moves 10.3″/yr.
  - The exoplanet count is at least 4000.
- **E2E bookmarks:**
  - `mw-outside-100kpc`, `mw-band-from-earth`.
  - `sgra-lensing`: the centre has luminance < 0.02 and a ring is present.
  - `cygx1-disk`, `gaia-bh3-dormant`.
  - `orion-lines-from-earth`, `orion-from-200ly`.
  - `alpha-cen-sun-in-cassiopeia`, `trappist-1`.

**Demo.**
- Orion breaks apart as you leave.
- From α Cen, the Sun sits in Cassiopeia.
- A 100 kyr warp deforms the Big Dipper.
- The Milky Way barred spiral from 100 kpc.
- S2 at periapsis around a lensed Sgr A*, with the beaming toggle.
- Cyg X-1 feeding on its companion.
- TRAPPIST-1's seven worlds.

### Phase 5: "Cosmos & Showtime" ($34)

| Wave | Package | Owns | Deliverables | Cost |
|---|---|---|---|---|
| W1 (A) | **P5-A galaxies + cosmic web** | `src/modules/{galaxies,cosmicweb}/**`, `tools/build-{galaxies,cosmicweb}.mjs` and their data | See list below. | $12 |
| W1 (B) | **P5-B showtime UX** | `src/ui/**`, `src/app/onboarding.ts` (granted), `src/modules/{tours,photo,audio}/**`, `README.md` | See list below. | $11 |
| W2 | **R5 final QA integrator** | Integrator files | See list below. | $5 |
| — | Demo-fix slack | | | $4 |

**P5-A galaxies + cosmic web delivers:**
- **Catalogue:** `galaxies.bin` with 10,937 entries: f32 xyz in Mpc (supergalactic), type code, radius, absMag, int8×4 orientation quaternion, name index.
- **Galaxy LOD:**
  1. Points.
  2. Oriented impostors from a GPU-baked morphology atlas (16 Hubble variants at 256²: E Sersic n = 4, S0, Sa-Sd with pitch 6-25°, SB, Irr).
  3. Volumetric GalaxyModel re-parameterised for M31 (i 77°, PA 38°, 10 kpc ring), M33, LMC and SMC.
- **Cosmic web:** 250k tracers from `build-cosmicweb`, tiled with rotations and reflections. It fades in beyond catalogue completeness (about 100 Mpc). Named superclusters are labelled "approximate".
- **Cosmology:** Planck 2018 functions for lookback time and comoving distance readouts.
- **CMB:** a procedural shell labelled "statistical realisation".

**P5-B showtime UX delivers:**
- **Tours:** a tour DSL and player (goto, orbit, timeRate, wait, caption, speak). Four tours: Cosmic Zoom, Grand Tour of the Planets, Stellar Neighbourhood, Into the Black Hole. Optional speech narration.
- **Photo mode** (P key): hides the UI; FOV 5-120°; exposure control; PNG export with a credits watermark; 2× tiled super-resolution.
- **Audio:** a procedural soundscape with 6 scale zones, a whoosh ∝ log speed and wind ∝ ρv². A "vacuum silence" toggle is available. Audio stays muted until the first user gesture.
- **Onboarding:** a 20-second dawn intro with hint chips.
- **Quality:** auto-detect from a 30-frame benchmark plus `UNMASKED_RENDERER`; a dynamic-resolution PID loop (0.5-1.0).
- **Polish:** light-delay readout ("the Earth you see from here is from 1543"), `?` help overlay, credits page, reduced-motion support, README.

**R5 final QA integrator:**
- Full suite plus a contact sheet of every bookmark.
- Budgets checked on every bookmark.
- A Safari and Firefox manual checklist for the user.
- Deploy and final documentation.

**Verification.**
- **Unit tests:**
  - The galaxy count is 10,937.
  - M31 is at 0.77 Mpc ± 10%.
  - The age of the universe is 13.79 Gyr.
  - D_C(z = 1) is 3.40 Gpc ± 3%.
  - The FFT matches a direct DFT.
  - The P(k) slope is as expected.
  - The tour schedule is deterministic.
  - The PID loop converges.
  - Audio RMS is above 0 (via OfflineAudioContext).
- **E2E bookmarks:** `m31-approach`, `virgo-cluster`, `cosmic-web-500mpc`, `cmb-edge`, `tour-cosmic-zoom` (3 checkpoints), `photo-mode`.

**Demo.** Press "Cosmic Zoom": boot print → Earth → planets → the Sun as a star → the Milky Way → Andromeda → Virgo → the cosmic web → the CMB, and back home. Search any galaxy and arrive in about 8 seconds. Share URLs.

### Reserve ($50, not scheduled)

- **$10** is earmarked for real-GPU tuning from the user's demo feedback, in any phase.
- The rest absorbs overruns.
- If at least $25 is still unused after P5, add these "could" items in order:
  1. Kerr spin mode: Boyer-Lindquist geodesics plus a test of the Bardeen critical curve (about $9).
  2. Fall-into-the-black-hole mode (about $5).
  3. NASA GIBS daily Earth imagery behind a flag (about $5).
  4. Volumetric nebulae for Orion, Carina and the Crab (about $8).
  5. Boulder scatter (about $5).

**Spend gates.**
- **Gate 0, before P1.** The user checks what this planning run cost. The build cap is 240 minus that amount. If planning cost more than $10, apply cut-list items 1-3 to the plan up front.
- **After each phase.** The user reports actual spend and the orchestrator compares it with the cumulative plan ($42 / $84 / $114 / $156 / $190).
  - If spend is more than 15% over plan, the orchestrator applies the next cut-list items to the coming phase until the projected total is ≤ $200.
  - If cumulative actual spend reaches $215 or more, finish the current phase and ship.

---

## 6. Cut list (drop in this order; approximate savings)

1. CMB shell, 2× super-resolution photo, speech narration (−$3).
2. Runtime Earth Terrarium streaming and Ultra 8k streaming (−$3).
3. Ring particle fly-through, prominences, comet dust-tail curvature, spacecraft markers (−$3).
4. Procedural audio soundscape (−$2).
5. Procedural star sectors; keep HYG plus the volume render (−$3).
6. Procedural exoplanet surfaces; keep markers and orbits (−$3).
7. Frankot-Chellappa heights; replace with luminance-derived height plus procedural (−$2).
8. Volumetric close-ups of external galaxies; impostors only (−$3).
9. FFT-based cosmic web; replace with seeded Soneira-Peebles clustered points (−$3).
10. Tours other than Cosmic Zoom (−$2).
11. Venus and Titan atmospheres; keep Earth and Mars (−$2).

**Never cut:**
- Precision core, CI and Pages deploy.
- Solar System ephemerides and the HYG sky.
- Terrain on the Moon, Mars and Earth.
- Earth's atmosphere and Saturn's rings.
- The Milky Way volume and Sgr A* lensing.
- The galaxy catalogue.
- Search, goto and URL state.

---

## 7. Verification

**Unit tests (vitest, node environment, `pnpm test`).** These are GPU-free science acceptance tests, listed per phase above. In addition:
- **Conventions test:** every `ShaderMaterial` includes `depth.glsl`, and imports respect the cross-module boundary.
- **Contract test:** every module disposes cleanly and reports `memoryBytes`.
- **Decoder round-trips:** `stars.bin`, `galaxies.bin`, `web.bin`.

**Headless Playwright (1.56.1, chromium-1194 with SwiftShader).**
- **Launch args:** `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
- **URL contract:** `/?test=1&q=potato&b=<bookmark>&t=<ISO>&ev=<EV>&seed=1`, viewport 480×270.
- **Per-test flow:** `await __universe.ready()`, then `renderFrames(4)`, then a screenshot to `artifacts/<module>/<bookmark>.png`.
- **Assertions:** zero shader errors, semantic pixel probes (luminance ranges and colour ratios, never golden-image diffs), and `stats()` budgets.
- **Scope:** at most 4 bookmarks per module spec. Runs are serialized with `flock`, with a 120 s timeout per test.
- **Special specs:**
  - `compile-all`: every registered material through `renderer.compile`.
  - `jitter`: 1 mm camera move, diff < 1%.
  - `leak`: baseline ±5% after a round trip.
  - `precision-torture`: Moon at 1.7 m with the root at 1e22 m.
- **Visual review:** reviewers read the contact-sheet PNGs and compare them with each bookmark's `lookTarget` text.

**Performance budget checks.**
- **Deterministic gates** (`renderer.info` on medium): ≤ 400 draw calls, ≤ 3M triangles, ≤ 60 programs, ResourceBudget ≤ 512 MB.
- **Asset guard:** `public/` ≤ 60 MB, any file ≤ 15 MB, boot path ≤ 8 MB, main JS ≤ 600 KB gzip.
- **Real fps** cannot be measured headlessly. At each demo the user opens `?perf=1` (stats-gl) on 3 bookmarks. The target is at least 60 fps on medium at 1080p on Iris Xe, M1 or GTX 1650-class hardware. Misses go into the next fix list.

**CI and Pages.**
- **`ci.yml`** (every push and PR):
  - Job `verify`: `pnpm install --frozen-lockfile`, typecheck, vitest, build, size-guard.
  - Job `e2e-smoke` (needs `verify`): `pnpm exec playwright install --with-deps chromium`, then 3 scenes (`boot`, `earth-now`, `solar-system-overview`) in at most 4 minutes; uploads `artifacts/`.
- **`deploy.yml`** (push to `main` and `workflow_dispatch`):
  - Permissions: `contents:read`, `pages:write`, `id-token:write`. Concurrency group `pages`.
  - Steps: verify steps, `configure-pages`, `upload-pages-artifact` (`dist`), `deploy-pages` to the `github-pages` environment.
  - Deploy is gated on `verify`, not on e2e, so a flaky smoke test never blocks a demo.
- **One-time user action:** Settings → Pages → Source: "GitHub Actions". The repo must be public.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Budget overrun from Opus output and screenshot loops | Turn caps (150/50/80), at most 6 screenshots, CLAUDE.md under 2k tokens with a do-not-read list, dot reporters, the per-phase spend gate, the ordered cut list, and the $50 reserve. |
| SwiftShader is slow or times out on raymarch-heavy scenes | Potato preset at 480×270 with minimum steps; `renderFrames` stepping; temporal accumulation off; serialized e2e; 120 s timeouts; CPU twins prove the math (geodesics, galaxy density, transmittance, Kepler). |
| Float jitter or z-fighting across 30 orders of magnitude | Float64 frame tree with lowest-common-ancestor transforms, camera at the origin, RTE double-single for clouds, tile-local Float32, per-band noise origins, log depth, plus precision and jitter tests from P1 onward. |
| Two agents conflict | Disjoint ownership globs, glob discovery (no shared registry file), dependencies frozen, separate worktrees, distinct ports, Playwright `flock`, integrator-only pushes to `main`. |
| Contract churn | Contracts frozen after P1 and changed only by adding optional fields. Extension points P2-P5 need (SurfaceShading, SurfaceGeometryProvider, HeightSource, Occluder, ScreenPass, Tour) are designed in P1. Changes go through `docs/requests`. |
| Hallucinated constants | Numbers come from files (astronomy-engine, Celestia, HYG, OEC, OpenNGC) through scripts. Curated JSON carries a `source` per row. Invariant tests run. Reviewers R2a and R4a audit physics. The UI shows "approximate" or "simulated" labels. |
| Node's fetch ignores the proxy, or TLS fails | `tools/lib` uses curl for every download. If a Node HTTP call is ever needed, set `NODE_USE_ENV_PROXY=1` and `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. |
| An upstream asset disappears (third-party LFS repos) | Processed outputs are committed, so builds never re-download. sha256 values are recorded. Ultra streaming has a fallback. Every texture has a procedural fallback material. |
| Licensing | Generated credits; Pluto's NC licence flagged; GPL and CC BY-SA data kept in separate data directories with notices; app code MIT. |
| Browser variability (Safari, Firefox) | WebGL2 only; HalfFloat render targets with an RGBA8 RGBM fallback probe; no `clip_control` and no 3D render targets; timer queries optional; a manual checklist at each demo. |
| Runtime streaming cannot be tested here | Off by default behind a flag; Playwright fixtures for Terrarium tiles; timeouts and silent fallback; never on the critical path. |
| Pages base path or enablement | Base from `GITHUB_REPOSITORY`; all URLs go through `import.meta.env.BASE_URL`; the user enables Pages once in P1-W0 so deploy problems surface on day one. |
| Visual quality is not testable automatically | Look targets per bookmark, reviewer contact sheets, and the user's real-GPU demo feeding a fix list of at most 5 items into the next integrator. |
| GPU memory leaks and main-thread hitches | ResourceBudget with LRU eviction, `dispose` contract tests, the leak spec, workers with transferable buffers, texture uploads time-sliced to ≤ 2 ms per frame. |
| Tooling incompatibility (vite 8 / vitest 5) | The scaffold verifies both on day one and falls back to a vite 7.3 pin, recorded in CLAUDE.md. TypeScript is pinned to 5.9.3. |

---

## 9. Orchestrator protocol (per phase)

1. Create worktrees and branches for the wave's packages.
2. Launch at most 2 agents with briefs built from the template in section 3.6.
3. Wait for both. Then launch the next wave. A reviewer may run alongside a W2 implementer.
4. The integrator merges with `--no-ff`, runs the full suites, builds the contact sheet, pushes `main`, and confirms the deploy.
5. Write `docs/demos/phase-N.md`. It contains a bookmark link list (`https://gcvillar9-bit.github.io/my-third-repo/#b=<id>`), what to look at, the `?perf=1` check, and known gaps.
6. **Pause.** The user checks real spend and replies with feedback (at most 5 fixes). The orchestrator applies the spend gate, then starts the next phase.

### Critical files for implementation
- `/home/user/my-third-repo/src/core/contracts.ts`
- `/home/user/my-third-repo/src/core/frames.ts`
- `/home/user/my-third-repo/src/render/renderer.ts` (plus `src/render/chunks/depth.glsl` and `rte.glsl`)
- `/home/user/my-third-repo/CLAUDE.md`
- `/home/user/my-third-repo/tools/fetch-assets.mjs` (plus `assets/manifest/*.json`)
- `/home/user/my-third-repo/.github/workflows/deploy.yml`
