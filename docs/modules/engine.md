# Engine (P1-A)

Core services, render pipeline, camera and app shell. Contracts: `src/core/contracts.ts`. This page lists what module authors need and the decisions P1-A made where the design was silent.

## Frames and precision (`src/core/frames.ts`, `math64.ts`)

- Boot creates `universe` > `mw` (galactic axes, Sgr A* origin) > `ssb` (ICRF). Modules add `<body>` under `ssb` and `<body>.fixed` under `<body>`.
- `ssb` sits R0 = 8.178 kpc from Sgr A* along the **observed** Sgr A* direction (RA 266.41684°, Dec −29.00781°), so Sgr A* lands at its true sky position. Z0 = 20.8 pc (`units.Z0_GALACTIC`) is the height above the physical mid-plane, which is tilted against IAU b = 0; P4 uses it for the Milky Way model.
- `mw` → `universe` uses the de Vaucouleurs supergalactic axes (pole l = 47.37°, b = 6.32°).
- World axes = `ssb` axes everywhere (`orientation`, `toWorldDir`, `toCamera`).
- `positionAt`/`orientationAt` must be pure functions of jd: results are cached per jd and evaluated lazily.
- Per frame: `object.position = view.toCamera(frame, local)`; orient body-fixed meshes with `view.frameQuat(frame)`. A frame without `orientationAt` keeps its parent's axes, so a child of `universe` has supergalactic axes: convert directions with `frameQuat` (see `_debug`).
- Anchoring: the camera re-anchors each frame to the deepest frame whose influence sphere contains it (leaving needs 1.1 × radius). In free and orbit modes `.fixed` frames are skipped so the camera does not co-rotate; walk mode may anchor to them.

## Time (`src/core/time.ts`)

- `SimClock` holds JD TT as float64; UTC ↔ TT uses astronomy-engine ΔT (Espenak-Meeus, about 75 s in 2026).
- Warp: `warpStep(±1)` walks the signed ladder −1e13 … −1, 0, 1 … 1e13. The clock is clamped to J2000 ± 1e9 yr.
- Boot registers `STANDARD_VALIDITY` (`core.planets` ±10 kyr then frozen, `core.stars.proper-motion` ±1 Myr, `core.galactic-rotation`). `validityBadges(clock.validity())` gives badge text and state for the time bar.
- Test mode: time defaults to `2026-01-01T00:00:00Z` (`TEST_DEFAULT_TIME`) unless `?t=` is set; a bookmark `jd: 'now'` is ignored under `?test=1`.

## Photometry (`src/core/photometry.ts`)

- `illuminanceFromMag`, `apparentMag`, `distanceModulus`, `solarIlluminance(r)` (M☉ = 4.83, so −26.74 and about 1.26e5 lx at 1 AU), `planetPointIlluminance`, `bvToTeff` (Ballesteros), `SUN_DISK_LUMINANCE` (about 1.9e9 cd/m²).
- Blackbody colour: Planck × CIE 1931 2° (10 nm table) → linear sRGB with D65 white and **no chromatic adaptation**, normalised to luminance 1. The Sun (`SUN_RGB`) is therefore slightly warm. For sunlight use `sunIlluminance = solarIlluminance(r) · SUN_RGB`.
- LUT: `render.uniforms.uBlackbodyLut`, 256 entries, log-spaced 1000-40000 K. Sample it with `blackbodyColor(teff)` from `chunks/blackbody.glsl`.

## Shaders (`src/render/chunks`, import from `src/render/chunks/index.ts`)

| Chunk | Use |
| --- | --- |
| `DEPTH_GLSL` | Include in **both** stages of every ShaderMaterial. Call `LOG_DEPTH_VERTEX();` after `gl_Position` and `LOG_DEPTH_FRAGMENT();` at the end of the fragment. `linearFromLogDepth(d)` decodes the depth texture (background = far). Opt out only with a `cosmos:no-depth (reason)` comment (background layers, full-screen passes). The conventions test enforces this. |
| `RTE_GLSL` | `rteRelative(p)` / `rteRelative2(hi, lo)` with uniforms from `createRteUniforms()` / `setRteCamera(u, camRelOrigin)`. Keep `object.position` at 0 and set `object.quaternion` from `view.frameQuat(cloudFrame)`. |
| `SHADOWS_GLSL` | `sunVisibility(p)` for up to 4 sphere occluders (exact circle overlap: umbra, penumbra, annular). Uniforms from `createShadowUniforms()` / `setShadowUniforms()`, all camera-relative. |
| `NOISE_GLSL` | Integer hashes, `pnoise(p, period)` periodic gradient noise, `pfbm`. |
| `PHASE_GLSL` | Rayleigh, Henyey-Greenstein, Cornette-Shanks, Lambert sphere, Lommel-Seeliger. |

- Output `L[cd/m²] · uExposure`; splice `render.uniforms.uExposure` (shared by reference).
- `background` renderables get `depthTest = depthWrite = false` forced on add. Opaque and transparent renderables share the main scene; transparent sorting is three.js's.
- `src/render/passes.ts`: `fullscreenMaterial` and `FullscreenPass` for ScreenPass implementations. The host hands each pass a HalfFloat `input`, the float `depth` texture and an `output`.

## Exposure (`src/render/exposure.ts`)

- exposure = 1 / (1.2 · 2^EV100). The meter averages log luminance over pixels brighter than 0.05 cd/m² (32×32 cells, 16 taps each) and reads back asynchronously every 4 frames. When less than about 0.2% of the screen is lit (stars only), the target is `EV_NIGHT` = −2. Adaptation uses τ = 0.5 s towards brighter and 2 s towards darker.
- `compensation` is added to the EV, as the contract says, so a positive value darkens the image.
- Test mode: fixed EV from `?ev=`, then the bookmark's `ev`, then 12. `?ev=auto` keeps eye adaptation on under `?test=1`, which the engine spec uses to cover the meter.

## Camera (`src/camera`)

- Free: W/S, A/D, R/F (Space/C), Q/E roll, drag or arrows to look, wheel or `[` `]` for k in [0.1, 5]. Speed = k · altitude above the nearest body surface, clamped to [0.5, 1e27] m/s and smoothed by a critically damped spring on log v.
- Orbit (`setMode('orbit')` with a target): drag or A/D/R/F to circle, W/S or wheel to zoom the altitude.
- Walk: deferred to P2. It currently flies like free mode with a 1.7 m floor and may anchor to `.fixed` frames.
- `goto(body)` ends at altitude 3R, biased towards the Sun-lit side when that keeps the approach monotonic. `goto(bookmark)` uses its pos and quat (or `lookAt`), and boot applies its jd, rate and ev (ev only in tests). Flights follow van Wijk-Nuij u(s) with ρ = 1.4 along a straight line in the target's frame, take 3-12 s, and move key presses cancel them.
- Collision applies to stars, planets, dwarfs, moons, minor bodies, comets and spacecraft (not galaxies or black holes). Ground comes from `addGroundProvider`; with no provider the ground is the sphere.

## App (`src/app`)

- Boot order: env, quality, budget, frames, renderer, registry, clock, assets, workers, camera, `mountUi(root, uiCtx)`, blue noise, discovery and init, initial view, loop.
- A failing module is reported to `errors()` and its dependents are skipped.
- Initial view: `?b=` (tests), then `#b=` or `#f=&p=&q=&t=`, then bookmark `earth-now`, then an overview of the ssb.
- The URL hash follows the view (replaceState at most once per second). Share links via `shareUrl()`/`copyLink()` drop test parameters.
- `window.__universe` exists with `?test=1` or in dev. `ready()` waits for tracked assets and worker calls. `stats().calls` counts every draw in the last frame (background, main, passes and post).
- The `_debug` module (only with `?test=1` or `?debug`) adds frame `debug` 1e22 m from the root, body `debug-sphere` (R = 1000 km) and bookmark `debug-sphere` (EV 15, lit from screen-left).
- `tools/gen-bluenoise.mjs` regenerates `public/data/render/bluenoise64.png` (void-and-cluster, deterministic) → `render.uniforms.uBlueNoise` (nearest, repeat).
