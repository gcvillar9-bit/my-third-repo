# Galaxies (P5-A)

The Celestia galaxy catalogue as photometric points plus oriented morphology impostors, and the ten named
galaxies (search, info cards, labels, bookmarks). Source: `src/modules/galaxies/`. Data: `tools/build-galaxies.mjs`.

## Data pipeline

- Input: CelestiaContent `data/galaxies.dsc` (GPL-2.0-or-later; Steinicke's revised NGC/IC, Karachentsev
  CNG, RC3, NED-1D distances; sha256 in `assets/manifest/galaxies.json`). 10,937 entries; the Milky Way entry
  is dropped (the milkyway module draws it), leaving **10,936**.
- `pnpm assets:build` (or `node tools/build-galaxies.mjs`) writes `public/data/galaxies/galaxies.bin`
  (295 KB), `public/data/galaxies/names.json` (up to three designations per galaxy, row = `nameIdx`) and
  `src/modules/galaxies/named.json` (the ten named galaxies, bundled so bookmarks exist before the binary loads)
  and `src/modules/galaxies/gallery.json` (`GALLERY`: those ten plus 44 more, each row also carrying `key`, its
  catalogue designation).
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

## Rendering (`renderables.ts` 2 draws + `portrait.ts` up to 8 draws, background layer)

- One `Points` draw (all galaxies) and one instanced-quad draw (instances compacted on the CPU each frame to the galaxies wider than 1.5 px, typically tens to hundreds, ~10k-iteration loop with no allocations; no draw when none qualify), both
  RTE in Mpc relative to the `universe` origin (camera split into float32 high/low without allocations).
- Points: m = M + 5 log10(d/Mpc) + 25, E = `LUX_MAG0`·10^(−0.4 m), spread over a 0.65 px Gaussian (as the stars),
  coloured by a type-dependent mix of 4300 K and 8500 K blackbody colours (approximate).
- Point → impostor crossfade at angular radius 1.5-3 px; impostors fade out again when the camera is closer than
  ~1.5 radii. The 54 gallery galaxies are drawn as 3D portraits instead when they are among the 8 largest on
  screen (see below); every other galaxy, including gallery galaxies not drawn as portraits that frame, keeps
  its impostor.
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

## Galaxy portraits (`portrait*.ts`, `portrait.glsl`, `looks.json`, `facts.ts`)

- What: a 3D emission/absorption model per gallery galaxy, raymarched per pixel inside a back-face box (one
  draw each), so a galaxy keeps rendering up close, from any angle, inside its bounding box and inside the
  disc. It replaces the impostor from the same crossfade (angular radius 1.5-3 px against the point), with
  no near fade-out, and follows the same panorama-fade rule (`PANO_MAG`, `skyWeight`).
- Per frame the 8 largest portrait galaxies on screen (`PORTRAIT_MAX_DRAWS`) are drawn as portraits;
  `select(view)` hands the impostor pass a per-catalogue-row mask, so a gallery galaxy that is not drawn as a
  portrait (or whose map is not baked yet) stays an impostor and nothing vanishes.
- Model (galaxy-local kpc, disc in xy): thin disc slab (old, young and HII light with exponential vertical
  profiles integrated exactly per ray interval) + oblate Sersic-like bulge/halo (exact line integral from a
  baked cumulative table) + dust (face-on optical depth × vertical profile, reddening 0.78/1/1.32 relative to
  V; dust only removes light) + one optional polar feature (bipolar cones or a one-sided jet, analytic).
  Per-pixel steps = `quality.volumeSteps`, concentrated in the dust slab.
- Individuality lives in a face-on map baked on the CPU (RGBA half float: old, young, dust τ_V, HII; 128² on
  potato, 256² otherwise; mipmapped; 8 resident): arms (count, pitch, phase, sharpness by arm class,
  flocculence), bar (+ dust lanes on its leading edges, arms rooted at its ends), rings, lopsidedness, dust
  lanes on the inner arm edges, dust patches, HII knots and named giant HII regions, tidal tails (one or two,
  with a radial map warp g(r) = Rc·asinh(r/Rc) so 65 kpc tails fit beside a 7 kpc disc), a second body for
  mergers, a bright nucleus and a disc warp. The shader adds gradient-noise detail below the map resolution.
- Photometry: each component is normalised from the CPU twin (`portrait-model.ts`, mirrored by the shader),
  so with dust off the integrated flux equals the catalogue's (E = `LUX_MAG0`·10^(−0.4 m)); the unit tests
  check this to a few % from several directions.
- Parameters (`derivePortraitParams`, pure): Hubble type code, radius and absolute magnitude from the
  catalogue; measured inputs from `gallery-facts.json` via `facts.ts` (stage T, B−V, RC3 bar family (falling
  back to the bar flag), S4G bulge-to-total, bar radius / (30·D25), pitch angle, ring radius, jet length,
  outflow extent, tail length), sanity-checked (rejected: B/T > 0.5 at T ≥ 4, B−V outside 0.1-1.3;
  clamped: bar radius fraction to 0.5); then `looks.json` (simulated styling chosen by eye, plus stand-ins
  for measured keys where no measurement exists); then seed-varied type defaults (seed = catalogue index).
  HyperLEDA's inclination is not used (it is an axis-ratio estimate); orientation is the catalogue's unless
  `looks.json` sets an `inclinationDeg` stand-in (M82, M104, Centaurus A, M102).
- Loading: `portrait.ts` (with `looks.json` and `gallery-facts.json`) is a dynamic import after the
  catalogue, tracked with it so `ready()` waits in tests; info cards load the facts on demand. A zero-area
  mesh with the portrait program stays in the scene for the first frames so the program links before the
  first portrait. Maps bake synchronously (one per frame outside tests, ~20-70 ms at 256²).
- Bookmarks: `whirlpool` (M51), `sombrero` (M104), `m87-jet`, `inside-m31` (3 kpc above the disc),
  `pinwheel` (M101), `ngc-1300`, `needle` (NGC 4565), `centaurus-a`, `cigar` (M82), `antennae`.
- Limits: the 3D shapes are simulated (no photographs); the NGC 5195 bridge is aimed at its sky direction
  (catalogue distances put it 130 kpc behind M51); the merger's second body is flat (in the disc map); boxy
  bulges are not modelled; one polar feature per galaxy.

## Named galaxies, bookmarks, settings

- `GALLERY` (`gallery.json`, 54 galaxies; the first ten are the original `NAMED` list that `named.json`,
  `galaxyBookmarks()` and `NAMED_GALAXIES` still cover): search entries `gal:<id>` (fly to a view with the
  galaxy filling about half the width), info cards and labels. The ten original galaxies (M31, M33, LMC, SMC,
  M87, M81, M82, M104, M51, Centaurus A) are labelled (priority 5) once the camera is > 30 kpc from the
  Galactic centre; the 44 additions get priority 4 and are labelled only within 6 Mpc of the galaxy.
- Info cards: the catalogue facts (distance in Mly and Mpc, light-travel time, Hubble type, diameter
  (approximate), absolute magnitude), then measured facts from `gallery-facts.json` for that id when present
  (`sources` keyed by citation, `galaxies.<id>` rows `{key, label, value, unit?, source, approximate?}`; keys
  starting with `_` are skipped). The 3D appearance is always marked simulated.
- The Antennae are one entry anchored on NGC 4038: the catalogue places NGC 4039 at twice the distance, so
  the pair is not adjacent in 3D. Companions have independent catalogue distances, so pairs (M51 and
  NGC 5195, M32 and M31, ...) can be separated along the line of sight.
- Bookmarks (`universe` frame): `m31-approach` (from the Milky Way side, M31 spanning ~1/3 of the width, EV −12),
  `local-group` (1.3 Mpc above the supergalactic plane, MW + Magellanic Clouds and M31 + M33 in frame, EV −12),
  `virgo-cluster` (M87 from 5 Mpc on our side, fovY 50°, EV −15).
- Setting `galaxies.enabled` (group Sky).

## Gaps

- Search covers only the 54 gallery galaxies; `names.json` is shipped for a catalogue-wide query (NGC/IC numbers).
- No `gal:<id>` frames are registered; bookmarks use the `universe` frame directly.
