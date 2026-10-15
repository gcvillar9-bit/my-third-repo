# Stars (P1-D, P4-C)

The HYG sky: `src/modules/stars/`. Data formats: `docs/modules/data-formats.md`.

## What it registers

| Kind                          | Id                                                                                                              | Notes                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Renderable (background)       | `stars.points`                                                                                                  | 119 625 HYG point sprites, one draw call; first `knobs.pointBudget` stars (sorted brightest first). |
| Renderable (background)       | `stars.milkyway`                                                                                                | Milky Way diffuse panorama on a unit sphere, galactic orientation; added when the texture loads.    |
| SearchProvider / InfoProvider | `stars`                                                                                                         | 3 443 named rows of `names.json`. Ids are `hip:<HIP>` (or `star:<index>` without a HIP).            |
| LabelSource                   | `stars.labels`                                                                                                  | Proper-named stars brighter than m 2.5 **as seen from the camera** (priority 30 − 4m).              |
| Bookmarks                     | `orion-from-earth`, `sun-from-alpha-cen`                                                                        | Both in `ssb`, EV −4, fovY 40°.                                                                     |
| Settings                      | `stars.points`, `stars.milkyWay`, `stars.labels` (persisted); debug: `stars.gain`, `stars.milkyWayGain` (stops) |                                                                                                     |

`public.ts` also exports (P4-C) `hideStars(indices)` / `hiddenStars()` (up to `HIDE_MAX` = 4 star indices skipped by
the point shader via `gl_VertexID` and by the label source, for promoted stars), `createStarSprites` (the same
photometric sprite material for a few camera-relative positions), `yearsSinceJ2000` and `PM_PC_PER_KMS_YR`.

`public.ts` exports `starCatalog()` (a promise of the decoded `StarCatalog`: positions with proper motion,
`appMag` from any viewpoint, names, `findByHip`, `teff`), `galacticUv`, `raDec`, `spectralClass` and the flag constants.

## Rendering

- **Decode:** `stars.bin` is fetched with `assets.binary`, decoded by `decode.worker.ts` (comlink, transferred
  buffers; main-thread fallback), tracked so `ready()` waits. Init awaits the catalogue because the α Cen bookmark
  is computed from it.
- **Positioning:** the cloud origin is the Sun, approximated by the `ssb` origin (< 0.01 AU off), with ICRS axes.
  GPU positions stay in pc (f32) and the camera position (pc, float64) arrives as an RTE high/low pair
  (`rte.glsl`). Velocity (f16, km/s) adds linear proper motion, `uYears` clamped to ±1 Myr (validity
  `core.stars.proper-motion`). Stars are projected as directions (at infinity), background layer, no depth.
- **Photometry per vertex and frame:** `m = M + 5 log10(d/10 pc)` from the camera, `E = 2.54e-6 lux · 10^(−0.4 m)`,
  one-pixel radiance `I1 = E · exposure · gain / pixelAngle²`. Fragment PSF = Gaussian core (σ = 0.65 px, unit
  integral) + `HALO_K / (1 + r²)` halo cut where it falls below `HALO_FLOOR`; sprite radius 2-48 px. Stars whose
  core peak is below `MIN_PEAK` (2e-4 pre-exposed) are culled in the vertex shader.
- **Colour:** B-V → Teff (Ballesteros, same formula as `bvToTeff`) → `blackbodyColor` from the shared LUT.
  Unknown B-V uses 0.65. Betelgeuse uses the BSC B-V of 1.85 (build override).
- **The Sun is not in the cloud** (HYG excludes it). Seen from outside the Solar System it must come from the
  solar-system module (photometric point); `sun-from-alpha-cen` relies on that.
- **Milky Way panorama:** `textures/stars/milkyway_diffuse_{2k,4k}.webp` (4k when `maxTextureSize ≥ 4096`),
  mapped per fragment with `ICRS_TO_GALACTIC` (`src/core/frames.ts`): `u = 0.5 − l/2π`, `v = 0.5 + b/π`. The
  upstream 8-bit values are treated as **linear** light: the star-removed panorama is very dark (median 0, 99th
  percentile 9/255, galactic centre ~160/255), and its raw values then track surface brightness. The tiers store
  those linear values **sRGB-encoded** (box-downsampled in float, WebP q90; the GPU decodes them back), so the dark
  sky keeps sub-DN precision instead of a few DN and the encoder no longer leaves flat chroma blocks (follow-up 4:
  the 4k tier was 36 KB and showed 100-150 px teal/navy/maroon blocks at the 2.5° `m42-telescope` field). Mipmapped:
  trilinear when minified, a 4-tap cubic B-spline when magnified (no texel blocks at telescope fields).
  `MILKY_WAY_LUMINANCE` = 2.4e-2 cd/m² per unit (P5-B's 8x display boost). It fades out between 200 and 400 pc from
  the Sun (smoothstep).
- **Panorama hole** (`setPanoramaHole` in `public.ts`): a module that draws an object itself can cut a soft hole in
  the panorama around it so the panorama's own blurred copy is not added on top. Inside `inner` the panorama is
  replaced by a membrane through 8 taps on a ring of radius `ring` (their mean plus the first two angular harmonics,
  scaled like a harmonic function inside a disc), fading back by `outer`. The nebulae module uses 1.0° / 1.4° /
  1.6° around θ¹ Ori C while the Orion Nebula volume is drawn.
- **Orientation check** (unit test): the b = 0 ring of the texture is > 4× brighter than b = ±60°, and at least
  24 of the 30 brightest HYG stars sit on local maxima (their removal residue) 2.5° around them.

## Decisions and notes

- **Velocity overrides (P4-C):** `overrides.json` rows (with sources) patch decoded velocities at load. HYG v4.1
  clips Barnard's Star's pmdec at 9 999.99 mas/yr (10.03″/yr); the Gaia DR3 values give 10.39″/yr. The real fix
  belongs in `tools/build-stars.mjs` (request in `docs/requests/p4-starsystems.md`).

- Stars are not Bodies by default. A search entry's target is a computed Bookmark 0.05 pc Sun-wards of the star,
  looking at it (stars without parallax: 1 AU from the Sun). Arriving there promotes the star (starsystems).
- Info cards: distance (ly, pc), apparent magnitude from the Sun and from the camera, absolute magnitude,
  spectral class estimated from Teff, V-band luminosity (no bolometric correction), colour temperature, B-V,
  RA/Dec, designation, HIP, variable/multiple. Derived values are flagged `approximate`.
- Exposure: at the engine's `EV_NIGHT` (−2) and 480×270 only stars brighter than about m 3 are clearly visible
  and the Milky Way is invisible; a dark-adapted look needs about EV −5 to −6. The bookmarks use EV −4 so the
  Betelgeuse/Rigel colour probe is not saturated. Tuning `EV_NIGHT` is an integrator call.
- Search aliases include Greek and Latin Bayer forms (`α CMa`, `Alpha CMa`), Flamsteed, `HIP n`, and a few
  common names (Alpha Centauri, North Star) listed in `catalog.ts`.

## Tests

- Unit (`tests/unit/stars/stars.test.ts`): decoder, Sirius m = −1.46 ± 0.05 from Earth, Sun from α Cen
  (m 0.47, RA 2h39m, Dec +60.8°), proper motion, Betelgeuse vs Rigel Teff, panorama orientation and fade,
  providers and bookmarks.
- E2E (`tests/e2e/stars.spec.ts`, `?ui=1` for label positions): `orion-from-earth` (Betelgeuse upper left of
  Rigel, both lit, Betelgeuse redder) and `sun-from-alpha-cen` (Schedar lit, α Cen A behind the camera).
