# Stars (P1-D)

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
- **Milky Way panorama:** `textures/stars/milkyway_diffuse_{2k,4k}.webp` (4k when `maxTextureSize ≥ 4096`), no
  mipmaps, mapped per fragment with `ICRS_TO_GALACTIC` (`src/core/frames.ts`): `u = 0.5 − l/2π`,
  `v = 0.5 + b/π`. It is sampled as **linear** data: the star-removed 8-bit panorama is very dark (median 0,
  99th percentile 9/255, galactic centre ~160/255), and its raw values then track surface brightness.
  `MILKY_WAY_LUMINANCE` = 3e-3 cd/m² per unit gives about 19.5 mag/arcsec² at the centre and about 22 in Cygnus.
  It fades out between 200 and 400 pc from the Sun (smoothstep).
- **Orientation check** (unit test): the b = 0 ring of the texture is > 4× brighter than b = ±60°, and at least
  24 of the 30 brightest HYG stars sit on local maxima (their removal residue) 2.5° around them.

## Decisions and notes

- Stars are not Bodies in P1. A search entry's target is a computed Bookmark 0.05 pc Sun-wards of the star, looking
  at it (stars without parallax: 1 AU from the Sun, looking at them). Promotion to a Float64 frame is P4.
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
