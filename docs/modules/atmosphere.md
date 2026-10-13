# Atmosphere (P2-B)

Physically based skies and aerial perspective after Hillaire, "A Scalable and Production Ready Sky and Atmosphere
Rendering Technique" (EGSR 2020), as one `atmosphere` stage ScreenPass. Cross-module API: `src/modules/atmosphere/public.ts`.

## Pipeline

| LUT                 | Size    | When                                         | Contents                                                                                                                                   |
| ------------------- | ------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Transmittance       | 256×64  | per body, only when the physics hash changes | `exp(-τ)` from (r, μ) to the top (Bruneton mapping, 40 steps)                                                                              |
| Multiple scattering | 32×32   | with the transmittance LUT                   | Ψ_ms = L₂/(1 − f_ms): 64 directions × 20 steps, isotropic phase, ground-albedo bounce                                                      |
| Sky-view            | 192×108 | every frame, camera inside the atmosphere    | Hillaire's non-linear horizon mapping, azimuth relative to the Sun                                                                         |
| Aerial perspective  | 1024×32 | every frame, camera inside                   | 32 slices of 32×32 froxels side by side (no 3D textures); slice i at depth `apMax·((i+0.5)/32)²`; rgb = in-scatter, a = mean transmittance |

All LUTs are HalfFloat RGBA with linear filtering and store radiance **per unit solar illuminance** (1/sr).
The composite multiplies by `E☉ = solarIlluminance(|body − Sun|) · SUN_RGB` and `uExposure`.

**Composite** (`glsl/composite.frag.glsl`) reads only the HDR scene colour and the log depth texture, so it works
over any geometry provider (sphere today, terrain from P2-A):

- camera inside: background pixels (and geometry beyond the atmosphere, e.g. the Sun or moons) get
  `sky-view + input · T_lut` (T = 0 if the ray hits the ground), so stars and the Milky Way vanish in daylight;
  geometry nearer than `apMaxKm` uses the aerial-perspective atlas (two-slice lerp, half-texel clamp per tile,
  linear fade in the first slice); farther geometry is raymarched;
- camera outside: per-pixel raymarch from the shell entry to min(depth, ground, exit), split at the closest
  approach to the centre with quadratic steps towards it (fine sampling where limb rays are densest);
- `out = input · T + L · E☉ · exposure`, clamped to 6e4. Bodies with `sunTransmittanceInPost` (all but Earth,
  whose shading applies it itself) also get their surface pixels multiplied by the Sun transmittance at the hit
  point, which makes the Gale ground dim and red at sunset.

**Atmosphere space.** Body-fixed axes with z scaled by a/c, so the ellipsoid becomes a sphere of the equatorial
radius; km units. The camera position comes from the float64 `view.toCamera(body)`; the camera height is passed
separately (float64) and all ground intersections use `h·(2R + h)` to avoid float32 cancellation 2 m above Mars.
Distances along a ray are converted with the length of the scaled direction, so they are exact for the scaled
geometry (≤ 0.6% from physical on Mars).

**Selection.** One atmosphere per frame: the one the camera is inside, else the largest shell on screen above
4 px (`space.ts`). The pass is inactive (skipped by the host) otherwise.

**Steps** from `knobs.atmosphereSteps` (8…64): sky-view `clamp(2k, 24, 64)`, aerial cap `clamp(k, 8, 32)`
(slice i uses `2(i+1)`), raymarch `clamp(k + 16, 24, 48)`.

## Parameters (`planets.json`, SI with `source` fields; `params.ts` converts to km)

| Body  | Model                                                                                                                                                      | Notes                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Earth | Rayleigh (5.802, 13.558, 33.1)e-6/m H 8 km; Mie 3.996e-6 sca / 4.44e-6 ext H 1.2 km g 0.8; ozone tent 25±15 km                                             | Hillaire 2020 defaults. Zenith T(550 nm) = 0.868                                                                            |
| Mars  | CO₂ Rayleigh scaled from Earth (density 0.00825, cross-section ×2.48), H 11.1 km; dust τ 0.6, SSA (0.97, 0.92, 0.80), Cornette-Shanks g (0.62, 0.68, 0.80) | `approximate`. The stronger blue forward lobe gives the blue sunset: twin B/R ≈ 1.76 at 5° from a 3° Sun, 0.46 away from it |
| Venus | CO₂ Rayleigh at the ~70 km cloud tops + thin sulfuric haze + weak blue absorber                                                                            | `approximate`; the sphere is the cloud deck                                                                                 |
| Titan | N₂ 1.5 bar Rayleigh + tholin haze τ ≈ 3–5, SSA (0.95, 0.85, 0.60), 600 km thick                                                                            | `approximate`; an orange haze ball                                                                                          |

Mie uses a per-channel Cornette-Shanks phase (`PHASE_GLSL`). Gas-giant limb haze is not modelled (optional item, skipped).

## TypeScript twin (`model.ts`)

Three-free mirror of `glsl/common.glsl`, function by function: medium, optical depth, LUT uv mappings (round-trip
tested), CPU transmittance and multiple-scattering LUTs with GPU-identical bilinear sampling, and `skyRadiance`.
Unit tests: Earth zenith T(550) in [0.85, 0.90]; Mars low-Sun sky B/R > 1.1 near the Sun and < 1 away from it;
Earth zenith sky blue with plausible luminance; LUT cache rebuild logic; sun-search; frame transform; selection.

## Public API

- `ATMOSPHERE_TRANSMITTANCE_GLSL`: `vec3 atmoSunTransmittance(float rKm, float mu)` (LUT × smooth planet shadow; 1
  until ready). Splice `atmosphereShadingUniforms(bodyId)` (uAtmoTransmittance, uAtmoRadii, uAtmoReady, shared by
  reference) into the material and call `requestAtmosphereLuts(bodyId)` so the LUT is built in `onBeforeFrame`.
- `getAtmosphereParams(id)`, `updateAtmosphereParams(id, patch)` (static LUTs rebuild only if the physics hash
  changes; source/flag edits do not), `ATMOSPHERE_BODY_IDS`, `MARS_GALE_SUNSET_ID`.

## Bookmark

`mars-gale-sunset`: `mars.fixed`, Gale crater 5.4° S 137.8° E, 2 m above the collision sphere (equatorial
radius, the camera's ground without a terrain provider), jd = first time after 2026-01-01T00:00Z (TT) that the Sun
sets through +3° (`sun-search.ts`, computed at init from the frame tree), looking at the Sun's azimuth pitched up
8° (Sun 5° below centre, horizon in the lower third), EV 12, mode free.

## Known gaps / decisions

- One atmosphere per frame (Titan in front of Saturn shows only Titan's).
- Aerial-perspective transmittance is grey (Hillaire's choice); colour comes from in-scatter.
- The sphere mesh sits up to ~1 km below the ellipsoid (chord sag) and the Gale site is ~180 m above the
  ellipsoid (sphere vs ellipsoid). Once terrain lands, the integrator should move `mars-gale-sunset` to walk mode or
  the ground height.
- No sun disk is added by the pass: the Sun sphere from solar-system is reddened and dimmed by `T`.
- Modules may not import `src/render/passes.ts`; `gpu/fullscreen.ts` is a private full-screen helper.

## R2b integration changes

- Sun transmittance in post applies to every surface pixel inside the shell (terrain reaches tens of km on Mars).
- A camera below the bottom sphere is lifted radially to bottom + 1 m for the LUT, sky-view and composite uniforms; aerial-perspective rays are no longer clipped at the bottom sphere.
- Outside views march `clamp(ceil(path / (thickness / 8)), 8, uSteps)` steps per pixel (the disc takes ~8, limb rays the full count).
- The composite replaces NaN/Inf input and output pixels with 0: one bad pixel near the Sun used to black out the whole frame through the bloom mip chain.
- `mars-gale-sunset` uses walk mode, so the eye stands 1.7 m above the drawn crater floor.
- `public.ts` also exports `findSunCrossing`, `sunElevation` and `siteDirection`.
