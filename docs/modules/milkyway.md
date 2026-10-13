# Milky Way (P4-A)

The Galaxy as a ray-marched **GalaxyModel**, globular clusters as King-profile point clouds, a
"You are here" marker and three bookmarks. Module: `src/modules/milkyway`. Cross-module API:
`public.ts` (model twin, frame matrices, `OUTSIDE_SWITCH`, `skyWeight`).

## GalaxyModel

- Parameters: `milkyway-model.json`; every row has a `source` (approximate values say so).
- **TypeScript twin** `model.ts` (`armField`, `components`, `dustKappa`, `skyLuminance`, `sunSkyLuminance`) and
  **GLSL twin** `armfield.glsl` + `galaxy.glsl`. Both read the same constants: `modelGlslDefines()` turns the JSON
  into `#define`s and constant arrays, and a unit test checks that every `MW_*` symbol is defined and used.
- **Model frame** (kpc): origin Sgr A*, the `mw` frame (IAU galactic axes) tilted by asin(z0/R0) so the Sun sits at
  (-R0 cos θ, 0, z0) with R0 = 8.178 kpc, z0 = 20.8 pc. `MW_TO_MODEL`, `WORLD_TO_MODEL` (from ICRS world axes).
- Components (emissivity in Lsun(V) pc^-3, colour from `blackbodyRgb(teff)`):
  thin disc (hR 2.6, hz 0.3 kpc, j0 = 0.03 so 2 j0 hz = 18 Lsun/pc^2 locally; depleted inside 3 kpc), thick disc
  (hR 2.0, hz 0.9, 12% of the thin disc at the Sun), boxy bulge (Gaussian in a super-ellipse radius), long bar
  (half-length 5 kpc at 27 deg, near end at l > 0), Reid 2019 log-spiral arms (Norma, Outer, Scutum-Centaurus,
  Sagittarius-Carina, Local, Perseus; kinked pitch angles of Table 2, render ranges extrapolated), a young blue arm
  population, hashed HII clumps on the arms (one per 0.5 kpc cell) and dust (hR 5 kpc, hz 0.1 kpc, extra dust on the
  inner arm edges, R:V:B reddening 0.75:1:1.32).
- The planar arm field (young, old, dust, HII) depends only on (x, y), so the GPU bakes it once into an RGBA16F texture
  (512² potato/low, 1024² otherwise, covering ±20 kpc) and the march samples it: one texture fetch plus a few `exp`
  per step.
- Ray march: bounding cylinder R < 20 kpc, |z| < 4 kpc; quadratic step spacing when the camera is inside, exact
  per-segment emission/absorption, early exit when the transmittance drops below 1e-3. Sky luminance in cd/m²
  via 3.56e28 lm per Lsun.
- Calibration (unit tested): ~4e-5 cd/m² at the Galactic poles (Pioneer 10: ~30-40 S10), ~7e-4 towards the
  Sagittarius clouds, A_V ≈ 30 mag to Sgr A*, ~1.3 mag/kpc in the local mid-plane, face-on centre > 10x the solar
  circle. The band centre agrees with the d3-celestial `mw.json` outline within 3 deg for |l| <= 60; towards
  Cygnus-Cassiopeia the model band sits up to ~3 deg south (no warp; tried and removed because it pushed the
  third-quadrant band south of the outline).

## Rendering (cheap by default)

| Preset | Steps | Outside target (per axis) | Sky cube | Arm field |
| ------ | ----- | ------------------------- | -------- | --------- |
| potato | 16    | 1/4                       | 128²     | 512²      |
| low    | 24    | 1/4                       | 128²     | 512²      |
| medium | 48    | 1/4                       | 128²     | 1024²     |
| high   | 96    | 1/2                       | 256²     | 1024²     |
| ultra  | 160   | 1/2                       | 256²     | 1024²     |

Steps are also capped by `knobs.volumeSteps`. Blue-noise jitter (`uBlueNoise`). Targets store cd/m² x 1e4 in
HalfFloat, so cached results do not depend on exposure.

- **Near the Sun (< 200 pc):** nothing is drawn or baked. The stars panorama is the sky (zero cost).
- **200 pc to 2 kpc (`milkyway.sky`):** a sky cube in model axes, crossfaded against the panorama with the
  panorama's own smoothstep (200-400 pc, copied constants, see requests). It is re-baked into a back buffer one face
  per frame only when the camera moved more than 1% of its galactocentric distance (all six at once for the first
  bake and in tests), then swapped.
- **Beyond 2 kpc (`milkyway.outside`):** a per-pixel march into the reduced-resolution target, composited by a
  full-screen triangle in the background layer. It re-marches only when the camera position, orientation, fov,
  size or step count changes; while still, with `knobs.temporal` (never in tests) it averages up to 8 jittered
  frames, then stops (idle cost: one textured triangle).
- Draws: at most 2 offscreen + 1 composite per frame for the galaxy, 1 for globulars, 1 for the marker.

## Globular clusters

`tools/build-milkyway.mjs` turns CelestiaContent `data/globulars.dsc` (Baumgardt et al. 2023 parameters,
GPL-2.0-or-later; manifest `assets/manifest/milkyway.json`) into `public/data/milkyway/globulars.json`
(194 clusters: name, aliases, RA/Dec, distance, core and tidal radius, M_V). Each cluster becomes 48/64/128/256/384
points (by preset at boot) drawn from King's (1962) 3D density; together they carry the integrated magnitude, so
clusters are faint fuzzy dots from afar and resolve when you fly in. RTE positions in pc from the ssb, one draw.
Search entries (`gc:<name>`, kind `cluster`) fly to 6 tidal radii; info cards list distance, M_V, rc, rt and c.

## Marker, settings, bookmarks

- "You are here": a cyan ring (overlay layer) and a label at the Sun once the camera is > 2 kpc from it.
- Settings: `milkyway.galaxy` (model on/off), `milkyway.globulars`, `milkyway.gain` (debug, stops).
- `mw-outside-100kpc` (EV -10.5, fovY 30 deg): face-on-ish from above the north pole, Sun-centre line up.
- `mw-edge-on` (EV -9.5): 60 kpc out towards l = 90 deg, 1 kpc above the plane; dust lane across the bulge.
- `mw-band-from-earth` (EV -8.5, fovY 80 deg): Earth's sky towards (l, b) = (8, -2) deg, Galactic north up, seen
  from 0.2 pc on the Sagittarius side. From 1 AU the smallbodies module's boosted asteroid-belt points (far fade
  3000-30000 AU) streak along the ecliptic, right through Sagittarius. The panorama band is ~10x fainter than
  the GalaxyModel predicts (see requests), so this bookmark needs EV -8.5 to read; the wide field keeps the star
  halos small.

## Tests

- Unit (`tests/unit/milkyway`): JSON sources and Reid 2019 Table 2 values, Sun position, Sgr A* at RA 17h45m40s,
  Dec -29 00 28 via frames, bar at 27 deg with the near end at l > 0, pitch angles on both sides of each kink, scale
  heights and lengths, the 12% normalisation, dust, sky brightness, band centre against `mw.json`, twin constants,
  crossfade and steps; globular catalogue, King sampling, flux conservation, search and info.
- E2E (`tests/e2e/milkyway.spec.ts`): bright centre vs outskirts, bar elongation along vs across 27 deg, the cyan
  marker, dust lane edge-on, band vs off-band, zero errors, <= 400 draws.
