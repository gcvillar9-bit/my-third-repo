# Milky Way (P4-A, atlas)

The Galaxy as a ray-marched **GalaxyModel**, globular clusters as King-profile point clouds, a
"You are here" marker, and the **atlas**: about 16,500 real, named structures at their measured
positions, each with a search entry and a sourced info card (second half of this page). Module:
`src/modules/milkyway`. Cross-module API: `public.ts` (model twin, frame matrices, `OUTSIDE_SWITCH`,
`skyWeight`).

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
  Cygnus-Cassiopeia the model band sits up to ~3 deg south.
- **Warp and flare** (`warpHeight`, `thinFlare`, `thickFlare`, both twins): the disc components and the dust
  follow the measured Cepheid warp, z_w = 0.060 (R − 7.72)^1.33 sin(φ − 17.5°) kpc (Chen et al. 2019; north
  on the l = 90° side, about 0.8 kpc at R = 15 kpc), and the scale heights grow outwards after
  López-Corredoira & Molgó 2014 (thin disc 3.3 times thicker at 15 kpc) at constant surface brightness. Both
  apply outside the solar circle only: the warp is blended in over 1 kpc and the flare is normalised at the
  Sun, because z0 and the local scale heights are measured there (applied from its fitted onset inside the
  solar circle, the warp moved the band 0.3 deg further south at l = 75 and failed the band test).

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
- `mw-above-sun-1kpc` (EV -9, fovY 60 deg): 1 kpc above the Sun looking towards the centre; exercises the
  re-baked sky cube (the inside view), disc and bulge below a dark sky.
- `mw-band-from-earth` (EV -6, fovY 80 deg): Earth's sky towards (l, b) = (8, -2) deg, Galactic north up, seen
  from 0.2 pc on the Sagittarius side. From 1 AU the smallbodies module's boosted asteroid-belt points (far fade
  3000-30000 AU) streak along the ecliptic, right through Sagittarius. Phase 5 raised the panorama 8x
  (`MILKY_WAY_LUMINANCE` 2.4e-2), so this bookmark moved from EV -8.5 to -6 (no overexposure or visible 8-bit
  compression blocks); the wide field keeps the star halos small.

## Tests

- Unit (`tests/unit/milkyway`): JSON sources and Reid 2019 Table 2 values, Sun position, Sgr A* at RA 17h45m40s,
  Dec -29 00 28 via frames, bar at 27 deg with the near end at l > 0, pitch angles on both sides of each kink, scale
  heights and lengths, the 12% normalisation, dust, sky brightness, band centre against `mw.json`, twin constants,
  crossfade and steps; globular catalogue, King sampling, flux conservation, search and info.
- E2E (`tests/e2e/milkyway.spec.ts`): bright centre vs outskirts, bar elongation along vs across 27 deg, the cyan
  marker, dust lane edge-on, disc below a dark sky from 1 kpc up (sky cube), band vs off-band, zero errors,
  <= 400 draws.

## Atlas (`atlas/`, `guides.ts`, `atlas-bookmarks.ts`)

Real, named structures of the Galaxy at their measured positions. Loaded after startup by a dynamic import
(4.6 KB of startup code for the settings and bookmarks; about 5.6 MB of data, about 3.8 MB on the wire, fetched in the
background).

### Measured values and simulated styling

- **Measured:** `public/data/milkyway/atlas/`, written by `tools/build-milkyway.mjs` from
  `tools/milkyway/layers/*.mjs` (catalogue layers: many rows, one source per column) and
  `tools/milkyway/features/*.mjs` (features: few objects, a source on every fact). Schema and helpers:
  `tools/milkyway/lib.mjs`. Positions are parsecs from the Sun in ICRS axes.
- **Evidence rule, enforced by the build:** every value comes from a file fetched by the build and recorded
  with its URL and sha256 in `tools/milkyway/sources/<group>.json` (209 files). Hand-entered values live in
  `tools/milkyway/features/<group>.json`, each with a quote from the fetched page, and `checkQuote` fails the
  build when the quote is not on that page. A value that cannot be fetched is left out; an implausible one is
  rejected and counted in the build log.
- **Simulated:** `atlas/looks.json` (colours, symbols, label windows, label anchors of large structures, light
  per unit mass and colour of the Galactic-centre populations, a stand-in radius for the Arches and
  Quintuplet). Info cards say what is simulated for each kind of object.

| File                                      | Objects                                                                                                                                     | Source (licence)                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `open-clusters.json`, `cluster-stars.bin` | 6,978 open clusters and moving groups; 374,285 member stars (up to 82 per cluster, brightest first, bright-star-catalogue matches left out) | Hunt & Reffert 2023, 2024 (CC BY 4.0); names from OpenNGC (CC BY-SA 4.0)            |
| `cepheids.json`                           | 2,378 classical Cepheids with distances                                                                                                     | Skowron et al. 2019, OGLE (cited); brightness from the period, Benedict et al. 2007 |
| `masers.json`                             | 190 star-forming regions with radio parallaxes                                                                                              | Reid et al. 2019 (cited)                                                            |
| `hii-regions.json`                        | 1,855 ionised regions (611 photometric or parallax distances, the rest kinematic and marked approximate)                                    | Hou & Han 2014 (cited)                                                              |
| `clouds.json`                             | 94 molecular clouds                                                                                                                         | Zucker et al. 2020 (CC0 on Dataverse)                                               |
| `remnants.json`                           | 181 supernova remnants with a distance (of 310; 124 have none, 5 are too uncertain)                                                         | Green 2025; Ranasinghe & Leahy 2022 (cited)                                         |
| `pulsars.json`                            | 4,398 pulsars (357 parallax, 151 association, 3,890 dispersion-measure distances, the last marked approximate)                              | ATNF Pulsar Catalogue 2.9.0 (cited)                                                 |
| `satellites.json`                         | 69 satellite galaxies and candidates                                                                                                        | Local Volume Database, Pace 2024 (CC0)                                              |
| `associations.json`                       | 27 young associations within 150 pc                                                                                                         | Gagné et al. 2018 (cited)                                                           |
| `features-streams.json`                   | 141 stellar stream tracks                                                                                                                   | galstreams, Mateu 2023 (BSD-3-Clause)                                               |
| `features-magellanic.json`                | Magellanic Stream, Bridge, Leading Arm                                                                                                      | Nidever et al. 2008, 2010 and others (cited)                                        |
| `features-structure.json`                 | 7 arm segments of Reid et al. 2019, far 3-kpc arm, bar, bulge, discs, warp, flare, halo                                                     | papers (cited)                                                                      |
| `features-centre.json`                    | nuclear star cluster and disc, Central Molecular Zone, Arches, Quintuplet, 9 clouds and regions                                             | papers, SIMBAD positions (cited)                                                    |
| `features-bubbles.json`                   | Fermi and eROSITA bubbles                                                                                                                   | Su et al. 2010; Predehl et al. 2020 (cited)                                         |
| `features-local.json`                     | Local Bubble surface, Radcliffe Wave, Sco-Cen, Per-Tau shell, Gould Belt, Local Interstellar Cloud                                          | Pelgrims et al. 2020 and Alves et al. 2020 (CC0), papers                            |

`cluster-stars.bin` (MWCS v1, little-endian): header u32 magic `0x5343574d`, version 1, count N, 0; then
`cluster` u16 × N (row of `open-clusters.json`), `dx`, `dy` i16 × N (sky offset east and north in units of the
cluster's `rMem` / 32767 pc), `g` u8 × N (Gaia G = g × 0.08), `c` u8 × N (BP−RP = −0.6 + c × 0.02, 255 unknown).

### Light and guides

- **Light** (`points.ts`, one additive Points draw, background layer): what emits visible light is drawn
  photometrically like the HYG stars. Cluster members keep their measured sky position and Gaia brightness
  (so the dust towards them is included as seen from the Sun); only their depth inside the cluster is
  simulated. Cepheids get M_V from their period. Satellite galaxies and the Galactic-centre populations are
  Plummer clouds of simulated clumps that carry the measured total light, half-light radius, ellipticity
  and position angle; a clump has a physical radius and is drawn as a Gaussian of that size. Cepheids and
  the centre populations are dimmed and reddened by the model dust along the line of sight (closed-form
  integral in the vertex shader), so the nuclear star cluster is hidden from the Sun (A_V ≈ 30) and visible
  from close by. Per cluster 12/24/48/82/82 stars by preset.
- **Guides** (`guide-render.ts`, `labels.ts`): what is invisible to the eye or is a concept is a guide: symbol
  markers (pulsars, remnants as rings of their real size, clouds, star-forming regions), lines (stream
  tracks, arms: solid over the measured azimuth range, dashed 40° beyond it, Radcliffe Wave, Magellanic gas),
  shell outlines (bubbles, Local Bubble surface, Per-Tau shell) and labels. Guides output a fixed
  pre-exposed colour in the background layer (behind every body), 4 draws. Shell outlines fade out when
  the camera is closer than about 3 radii; arm lines fade out when the Galaxy is seen edge-on (they would
  fill the dust lane).
- **When guides show** (`guides.ts`, setting `milkyway.guides`, **Shift+B** toggles): `auto` (default) fades
  them in between 2.0 and 2.5 kpc from the Sun, so views near the Sun are as before; `on` shows them
  everywhere; both fade out between 1.0 and 1.5 Mpc from the centre. Six group switches
  (`milkyway.guides.<structure|halo|clusters|gas|compact|stars>`) and `milkyway.atlasLight`. All have URL
  overrides (`?milkyway.guides=on`, `?milkyway.guides.halo=0`, `?milkyway.atlasLight=0`).
- **Labels:** each class has a camera-distance window per rank 0 to 3 (`looks.json`), so famous objects are
  named from far away and minor ones from close by. At most 48 candidates per frame, chosen inside the view
  cone by rank and then by logarithmic distance, re-selected when the camera moves or turns.
- **Search and info:** ids `mw:<layer or group>:<id>`. Features and objects of rank 2 or 3 (about 2,000) are
  in the fuzzy index; the other catalogue rows answer prefix queries of three or more characters
  (`PSR J0534`, `OGLE-BLG-CEP`). An info card lists the distance and every fact with its citation, and says
  how the object is drawn.

### Other modules

- **galaxies:** `hideGalaxies` (galaxies `public.ts`) hides the catalogue rows that match an atlas
  satellite (within 2° and a factor 2 in distance): the classical dwarfs (Fornax, Sculptor, Draco, Carina,
  Sextans, Leo I, Leo II, Ursa Minor, Sagittarius) are drawn once, as star clouds. The Magellanic Clouds stay
  3D portraits there.
- **blackholes:** `tools/milkyway/extras/sstars.mjs` added 32 orbits of Gillessen et al. 2017 to
  `public/data/blackholes/blackholes.json` (41 stars now; S111 is unbound and left out).

### Bookmarks

`mw-bubbles` (edge-on from 75 kpc), `mw-halo-streams` (130 kpc out), `mw-radcliffe-wave` (3.5 kpc outside the
solar circle), `mw-galactic-centre` (570 pc from Sgr A*), `mw-local-bubble` (600 pc above the Sun),
`mw-pleiades-cluster` (14 pc from the cluster). The last three switch the guides on when they are the initial
view (`?b=` or `#b=`).

### Tests

- Unit `tests/unit/milkyway/atlas.test.ts`: a source on every value and a sha256 for every fetched file;
  Pleiades, Hyades, M67, Crab (nebula at its pulsar), Vela, Cas A, W51, Taurus, Fornax, LMC, GD-1, Orion on
  the Radcliffe Wave, centre features at Sgr A*; arms equal to the model's; warp and flare; star decoding,
  flux conservation of populations; the satellite matcher against the shipped galaxy catalogue; guide
  opacity, label selection, styles, search, info cards.
- E2E `tests/e2e/milkyway-atlas.spec.ts`: each view is rendered with a switch on and off and compared in
  16 px cells: violet bubble outlines on both sides of the disc (`@smoke`), green stream lines around the
  galaxy, the blue Local Bubble shell (absent in `auto`), extra member stars in the Pleiades.

### Limits

- The far side of the Galaxy is mostly unmapped: clusters, clouds and star-forming regions crowd the Sun's
  side. That is the state of knowledge, not a rendering choice.
- Distances along the Magellanic Stream are not measured (drawn at 50 kpc rising to 120 kpc at the tip, as
  Nidever et al. 2010 adopt); Galactic-centre objects sit at the distance of Sgr A* (their depth is unknown).
- Guides are drawn behind every body and are not occluded by the galaxy's dust.
- Dwarf satellites are fainter than the exposure of the far views shows: they appear as labels there and
  as star clouds from nearby.
