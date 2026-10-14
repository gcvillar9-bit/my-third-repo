# Galaxies (P5-A)

The Celestia galaxy catalogue as photometric points plus oriented morphology impostors, and the ten named
galaxies (search, info cards, labels, bookmarks). Source: `src/modules/galaxies/`. Data: `tools/build-galaxies.mjs`.

## Data pipeline

- Input: CelestiaContent `data/galaxies.dsc` (GPL-2.0-or-later; Steinicke's revised NGC/IC, Karachentsev
  CNG, RC3, NED-1D distances; sha256 in `assets/manifest/galaxies.json`). 10,937 entries; the Milky Way entry
  is dropped (the milkyway module draws it), leaving **10,936**.
- `pnpm assets:build` (or `node tools/build-galaxies.mjs`) writes `public/data/galaxies/galaxies.bin`
  (295 KB), `public/data/galaxies/names.json` (up to three designations per galaxy, row = `nameIdx`) and
  `src/modules/galaxies/named.json` (the ten named galaxies, bundled so bookmarks exist before the binary loads).
- Positions: RA/Dec (J2000) + `Distance` (ly) from the Sun → galactic (`ICRS_TO_GALACTIC`) → + `SSB_IN_MW`
  → supergalactic (`GALACTIC_TO_SUPERGALACTIC`), i.e. the `universe` frame (origin Milky Way centre), in Mpc.
  The tool keeps copies of the two matrices; the unit test cross-checks M31 against `src/core/frames.ts`.
- Orientation: Celestia's `Axis`/`Angle` live in its ecliptic "universal" axes (x_ecl, z_ecl, −y_ecl) and rotate
  a template whose disc normal is +y, applied as a rotation by **−Angle** (calibrated: the Milky Way entry
  then gives the north Galactic pole to 1e-3, M31 an inclination of 77.8°). Stored as galaxy-local →
  universe with the disc in local xy and normal +z. Orientations of other galaxies are Celestia's and approximate.
- M31 comes out at 0.789 Mpc (Celestia: 2.573 Mly), within 2.5% of the 0.77 Mpc reference.

## `galaxies.bin` (GALX v1)

Little-endian structure of arrays; reference decoder/encoder `src/modules/galaxies/format.ts` (pure TS, used by
the app and by the Node unit test, which re-encodes the shipped file byte for byte).

| Offset   | Field     | Type     | Meaning                                                                            |
| -------- | --------- | -------- | ---------------------------------------------------------------------------------- |
| 0        | header    | u32 × 4  | magic `0x584c4147` ('GALX'), version 1, count N, reserved 0                        |
| 16       | `pos`     | f32 × 3N | x, y, z in Mpc, `universe` frame (supergalactic axes, origin MW centre)            |
| 16 + 12N | `radius`  | f32 × N  | Celestia `Radius`, kpc                                                             |
| 16 + 16N | `absMag`  | f32 × N  | Celestia `AbsMag` (B band)                                                         |
| 16 + 20N | `quat`    | i8 × 4N  | x, y, z, w × 127, w ≥ 0: galaxy-local → universe (disc in xy, normal +z)           |
| 16 + 24N | `nameIdx` | u16 × N  | row of `names.json` `names` (0xFFFF = none)                                        |
| 16 + 26N | `type`    | u8 × N   | Hubble code: E0-E7 = 0-7, S0 8, Sa 9, Sb 10, Sc 11, SBa 12, SBb 13, SBc 14, Irr 15 |

Total 16 + 27N bytes. float32 Mpc is good to ~0.06 pc at 1 Mpc and ~40 pc at 660 Mpc.

## Rendering (`renderables.ts`, background layer, 2 draws)

- One `Points` draw (all galaxies) and one instanced-quad draw (instances compacted on the CPU each frame to the galaxies wider than 1.5 px, typically tens to hundreds, ~10k-iteration loop with no allocations; no draw when none qualify), both
  RTE in Mpc relative to the `universe` origin (camera split into float32 high/low without allocations).
- Points: m = M + 5 log10(d/Mpc) + 25, E = `LUX_MAG0`·10^(−0.4 m), spread over a 0.65 px Gaussian (as the stars),
  coloured by a type-dependent mix of 4300 K and 8500 K blackbody colours (approximate).
- Point → impostor crossfade at angular radius 1.5-3 px; impostors fade out again when the camera is closer than
  ~1.5 radii (no fly-through volume: the volumetric GalaxyModel for M31 was cut).
- Impostors: disc galaxies are drawn as their projected ellipse (major axis = line of nodes, minor axis × |n·v|,
  floored at 0.15 for edge-on discs) with the face-on sprite rotated into place; ellipticals are billboards
  with axis ratio 1 − n/10. Surface brightness L = E/Ω is distance-independent, so the quad carries the
  galaxy's integrated flux.
- Morphology atlas (`morph.ts`): six procedural sprites (E Sersic n = 4, S0, Sa(b), Sc, SBb, Irr) baked on the CPU
  at startup into a 3 × 2 RGBA8 atlas (128² tiles, 64² on potato): R = old light, G = young light, stored as
  sqrt(v/peak); `gains` restore a mean of 1 over the quad. No external images.
- Fading against the Milky Way: galaxies brighter than apparent magnitude 7 seen from the Sun (LMC, SMC, M31,
  M33, ...) are multiplied by milkyway's `skyWeight(dSun)`, so they are absent while the stars panorama (which
  already shows them) is up and fade in between 200 and 400 pc from the Sun. The Milky Way is never in this
  catalogue, so the milkyway volume and the M31 impostor never double-draw.

## Named galaxies, bookmarks, settings

- M31, M33, LMC, SMC, M87 (Virgo A), M81, M82, M104, M51, Centaurus A: search entries `gal:<id>` (fly to a
  view with the galaxy filling about half the width), info cards (distance in Mly and Mpc, light-travel time,
  Hubble type, diameter (approximate), absolute magnitude) and labels once the camera is > 30 kpc from the
  Galactic centre.
- Bookmarks (`universe` frame): `m31-approach` (from the Milky Way side, M31 spanning ~1/3 of the width, EV −12),
  `local-group` (1.3 Mpc above the supergalactic plane, MW + Magellanic Clouds and M31 + M33 in frame, EV −12),
  `virgo-cluster` (M87 from 5 Mpc on our side, fovY 50°, EV −15).
- Setting `galaxies.enabled` (group Sky).

## Gaps

- Search covers only the ten named galaxies; `names.json` is shipped for a catalogue-wide query (NGC/IC numbers).
- No `gal:<id>` frames are registered; bookmarks use the `universe` frame directly.
