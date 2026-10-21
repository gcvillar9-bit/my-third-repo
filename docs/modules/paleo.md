# Deep-time Earth (paleo)

Earth's surface follows the clock into the past: ice-age sea levels and ice sheets over today's imagery, and a
synthetic surface baked from the PALEOMAP maps in deep time (drifting continents, seas, deserts, forests, bare rock
before land plants). Cross-module API: `src/modules/paleo/public.ts`. Depends on `earth` (it wraps its shading),
`solar-system` and `atmosphere` (bookmarks). Everything is approximate and labelled so.

## How it plugs in

- `index.ts` registers one priority-20 `SurfaceShading` for Earth that wraps the earth module's priority-10 shading
  (`shading.ts` `createPaleoShading`): base glsl + `glsl/paleo-surface.glsl`, base defines + `EARTH_PALEO`, base
  uniforms + `uPaleo*`, `update` delegates to the base. It is registered once (a new winning shading recompiles the
  material); all changes go through uniforms.
- The earth shading declares two hooks under `#ifdef EARTH_PALEO` (`earthPaleoSurface` after the map samples and
  `earthPaleoWater` in `surfaceDetailMask`); without the define it is exactly today's Earth.
- Clouds: `uEarthCloudZonal` (earth-common.glsl, shared by the shading and the cloud shell) fades today's cloud map
  into zonal weather bands (equatorial convergence, clear subtropics, storm tracks) as the synthetic surface takes
  over, so clouds no longer trace today's continents. The bands are baked once by the worker
  (`zonal-clouds.ts`, a port of `gnoise`) into `uEarthCloudZonalMap` (1024×512 R8) before the first bake: one
  lookup per pixel instead of noise, so present-day Earth costs the same as before this module.
- City lights fade out before electric lighting in the earth module itself (`earth/city-lights.ts`).
- Climate for other modules (`public.ts` `paleoClimate(jd)`, `sampleClimate`): a 720×360 RGBA map (surface kind,
  temperature, moisture, elevation) from the same per-cell model as the bake (`biome.ts` `climateMap`), so the life
  module's animals stand on the painted land. Since 2.6 Ma it uses today's maps and observed moisture, cooled with
  the ice-age sea level (6 C at the LGM). `biome.ts` `iceAgeOverlay` matches the shader's half-points: sea and sea-ice
  cells whose seabed is shallower than the drop become `SURFACE.shelf` (land for every purpose; it is kept apart
  because today's terrain has no bathymetry and cannot tell the bared seabed from the sea; it takes the
  temperature and moisture of the nearest coast, breadth-first, not the sea's), and cells whose ice
  threshold the drop passes by 4 m (`ICE_HALF_M`, half of the shader's 8 m blend) become land ice. The drop is
  rounded to 5 m for the cache, so the edges can sit up to 2.5 m of drop off the drawn ones. Cached per era.

## Looks by age (`climate.ts` `regimeAt`, years before 1950)

| Age               | What is shown                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| up to ~3.5 ka     | Today's Earth (uniforms 0)                                                                                                                                                                                                      |
| 3.5 ka – 3 Ma     | Today's imagery; sea level from Bintanja & van de Wal (2008) exposes today's shelves (seabed depth from ETOPO5, coloured by `land_fill_1k.webp`) and grows ice sheets (`quaternary.png` G) as sea level falls (−121 m at 21 ka) |
| 2.6 – 5 Ma        | Cross-fade from today's imagery to the synthetic surface                                                                                                                                                                        |
| 5 – 540 Ma        | Synthetic surface from the two PaleoDEM maps around the date, re-baked when the blend moves by 1/16 of a 5 Myr step                                                                                                             |
| older than 540 Ma | Held at 540 Ma (`paleo.geography` validity: `frozen`)                                                                                                                                                                           |

## Synthetic surface (`biome.ts`, baked in `bake.worker.ts`)

- Land or sea from the blended signed coast distance of the two maps (`fields.ts`), so coasts move continuously
  instead of continents shrinking during a blend; a small noise warp gives sub-degree coastlines. Sea colour by
  depth (deep ocean to shelf); sea ice below about −8 °C.
- Temperature: an equator-to-pole profile whose area mean is the era's global mean temperature (PhanDA, Judd et al.
  2024); the gradient narrows in warm eras (polar amplification, floor 20 K); −5 K/km of altitude (less than the
  free-air 6.5 K/km, so high plateaus such as Tibet are not ice sheets). Land ice below about −10 °C.
- Moisture: a logistic model of latitude belts, distances to the sea (nearest coast, along the row to the west and
  east), mountains in between (rain shadow) and cold. It is fitted when the worker starts to today's Earth:
  `modern_moisture.png` holds each land cell's moisture from its Blue Marble colour (soft nearest biome), so every
  era's rainfall pattern is calibrated against today's (about 60% class agreement today; it tells rainforest from
  desert, not field from forest).
- Vegetation stage (`data/vegetation.json`): bare rock and soil before land plants (~470 Ma), low plants before
  forests (~385 Ma), shrub before grasslands (~20 Ma).
- Colours: biome samples of the Blue Marble day map (sRGB, `index.json` `biomes` with their boxes), hillshade from
  the elevation gradient, light noise. Output: 1024×512 RGBA8 sRGB, rows from the south, alpha = open water.

## Data (`tools/build-paleo.mjs`, `assets/manifest/paleo.json`)

Run `node tools/fetch-assets.mjs paleo && node tools/build-paleo.mjs && pnpm credits` (never the full
`pnpm assets:build`). Formats are in `docs/modules/data-formats.md`. Total about 2.7 MB, nothing on the boot path;
everything loads the first time the clock is in the past.

- PALEOMAP PaleoDEMs (Scotese & Wright 2018, CC BY 4.0, Zenodo 10.5281/zenodo.5460860): 109 maps, 0–540 Ma.
- ETOPO5 (NOAA, public domain): today's seabed for exposed shelves.
- Bintanja & van de Wal (2008): global sea level 0–3 Ma. Judd et al. (2024) PhanDA: global mean temperature per stage
  (medians only; the repository states no licence, so only the cited numbers are used).
- Natural Earth (public domain): today's ice. LGM ice-sheet outlines: hand-entered, coarse, approximate
  (`data/lgm-ice.json`, after Batchelor et al. 2019, Hughes et al. 2016, Dalton et al. 2020, Ehlers et al. 2011; the
  Batchelor shapefiles on OSF state no licence, so they are not redistributed).

## Bookmarks (`bookmarks.ts`, sites in `sites.json`)

Numeric JDs in `earth.fixed`; each date is moved by whole fold periods onto a season, and the Sun is placed with the
folded ephemeris. Sites are on the maps' grid, which is in PALEOMAP paleo-coordinates (at 90 Ma North America lies about
30° east of today), so a site names a place on the old globe.

| Id                    | View                                                                                                                                                | EV  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `earth-pangaea-250ma` | Whole disc centred on 22.5 S 9.5 W at midday: interior Pangaea where the South Atlantic is today                                                    | 15  |
| `earth-seaway-90ma`   | Whole disc centred on 40.5 N 63.5 W (paleo-coordinates): the Western Interior Seaway between Laramidia and Appalachia (closed in the 65/70 Ma maps) | 15  |
| `earth-lgm-21ka`      | Whole disc centred on 58 N 88 W: the Laurentide ice sheet, exposed shelves                                                                          | 15  |
| `earth-dusk-66ma`     | On the ground (walk) facing the Sun 8° up, time at 1 h/s: the Sun sets within a few seconds                                                         | 12  |

## Tests

Unit (`tests/unit/paleo`): map count and sources, bracketing, sea level at 21 ka, climate and vegetation, regimes,
field decoding and symmetric coast distances, bookmark sites against the maps, the moisture fit (Amazon/Congo wet,
Sahara/Australia dry), bake orientation and water alpha, the wrapper (defines, uniform names, idle today), fold
alignment. E2E (`tests/e2e/paleo.spec.ts`): Pangaea land redder than the ocean around it, the seaway brighter than
the land either side, the LGM ice dome brighter than the disc around it, and the 66 Ma sunset going dark with no city lights;
all with no errors, at most 150 draw calls and 60 programs.

## Known gaps

- Continents cross-fade between 5 Myr maps rather than sliding (true plate motion is plan Step 8).
- Terrain heights stay today's: walking in deep time is on today's relief under the paleo colours (plan Step 9).
- 1° maps are soft up close; there is no Messinian dry Mediterranean (5.96–5.33 Ma) or Green Sahara (14.5–5 ka).
- Day length, the Moon's distance and the star field are today's in deep time.
- The moisture model is a fit at 1° and misses monsoons and some rain shadows (South China, Patagonia).
- LGM ice outlines are hand-entered and coarse; Southern Hemisphere ice beyond Patagonia and Antarctica is not drawn.
