# Surfaces: real heights and materials (P2-C)

Real height data, procedural detail and surface materials for the terrain (P2-A). Code: `src/modules/surfaces/**`
(height module `height/surface.ts`), `tools/build-surfaces.mjs`, FFT Poisson solver in `tools/lib/fft.mjs`.
Public API: `src/modules/surfaces/public.ts`. Depends on solar-system, atmosphere and terrain.

## Build (`pnpm assets:build` runs `tools/build-surfaces.mjs`)

- Sources (`assets/manifest/surfaces.json`, sha256 recorded): Celestia `moon-normal.png`, `mars-normal.png`
  (4096x2048, GPL-2.0-or-later, LOLA/MOLA-derived, no `.license` sidecars upstream) and three-globe
  `earth-topology.png` (2048x1024 8-bit land relief) and `earth-water.png` (white = water).
- Moon, Mars: slopes `p = -nx/nz`, `q = -ny/nz` (G points down the image: the curl test prefers this sign 4-5x;
  craters come out as bowls, Olympus Mons as a mountain), box-averaged to 2048x1024, Frankot-Chellappa with y
  mirrored and a Tikhonov cutoff at a quarter circumference (`lambda = (2 pi / 512 px)^2`; 8-bit normals carry no
  long-wave signal and plain FC blew up the global range 2-3x). Scale: the 0.01-99.99 % relief range equals the
  published total relief (LOLA 19.91 km, MOLA 29.43 km). Cross-checks in the build log: Tycho depth 3.99 km
  (published 4.8), Olympus Mons relief 23.1 km (~22). Zero area-weighted mean; heights are relative to the
  reference ellipsoid. Mars' dichotomy and Tharsis bulge (long waves) are therefore missing.
- Earth: `h = 6000 m * (v / 250)^1.1` (power law fitted to Kansas, Denver, Mexico City, Greenland, Altiplano, Dome A
  and Tibet; 20 km pixels smooth Everest to ~5.5 km), Gaussian smoothing (sigma 0.75 px) against 8-bit terraces;
  ocean pixels get a bathymetry proxy (-100 m at the coast to -4.5 km, from a sigma 8 px blur of the mask).
- Outputs: `public/data/surfaces/{moon,mars,earth}_height_2k.png` (16-bit grey, `h = offsetM + v * stepM`),
  `earth_ocean_2k.png` (8-bit, 255 = water), the encodings in `src/modules/surfaces/rasters.json` (bundled), and the
  Terrarium fixture `tests/fixtures/surfaces/terrarium-fixture.png` (synthetic 256x256 tile). About 9.8 MB.

## Height sources (`specs.ts`, `heightfield.ts`, priority 5, worker module `/src/modules/surfaces/height/surface.ts`)

- Raster: Catmull-Rom bicubic on a box mip chain; the two mips whose texel brackets the quadtree vertex spacing are
  blended (band limit), rows past a pole continue on the opposite meridian, columns wrap. PNGs are fetched with
  `ctx.fetchBinary` and decoded with fast-png (only in the lazy height chunk).
- Craters (`craters.ts`): cumulative SFD `N(>D) = C D^-2` (D in m, per m^2) from octaves `[Dhi/2, Dhi]`; each octave
  is a 3D jittered grid of cell `S = 2.5 Dhi` with `18.75 C` points per cell kept within S/2 of the sphere (exact
  areal density), diameters drawn from the truncated power law. Profile: parabolic bowl (d/D 0.2), rim 0.04 D,
  ejecta `rim r^-3` to 2.5 radii; complex craters above `Dt = 15 km * g_moon / g` get `d = 0.2 Dt (D/Dt)^0.3`, a
  flat floor and a central peak. Per-crater degradation; `relaxD` flattens large icy craters. Craters fade in
  between 2 and 4 vertex spacings of diameter (same heights for the same direction and level).
- Per body (hand-set, approximate): Moon raster + craters (C 0.06, 1 m-16 km) + fBm; Mars raster + craters (C 0.02,
  more degraded) + fBm + dunes (250 m crests, 8 m, asymmetric profile, ripples, noise mask ~25 % cover); Earth raster
  - ridged fBm on land (`60 m + 0.16 h` at 15 km) with the sea held at 0 under the ocean mask; Mercury, Callisto,
    Ceres craters to 160/160/60 km + fBm; Europa Worley double ridges (40/10/2.5 km cells) + sparse craters; Io
    calderas (flat floors, 1.2 km deep, 5-100 km) + low fBm; generic icy (Ganymede, Saturn/Uranus moons, Triton,
    Pluto, Charon, Eris, Haumea, Makemake) relaxed craters + fBm. Seeds: FNV of the body id mixed with the app seed.
- `maxAbsHeight` is an analytic bound (`heightBound`), and heights are clamped to it.

## Materials (`shading.ts`, `glsl/surface.glsl`, priority 5)

- Wraps each body's solar-system default shading (shares its uniforms and `update`, so maps load once). Airless
  bodies: Lommel-Seeliger times a Hapke shadow-hiding surge `1 + B0 / (1 + tan(g/2)/h)` (Moon B0 0.4, h 0.06).
  Mars: Oren-Nayar (sigma 0.45), Sun through the atmosphere transmittance LUT. Earth keeps its priority-10 shading.
- Detail: a procedural tileable 256x256 RGBA texture (regolith fBm, rock blocks, mottling; `detail.ts`) sampled
  triplanar on the five Float64-anchored detail bands, each fading in by pixel footprint; slope (`s.slope` 0.06 to
  0.25) blends regolith into rock with a per-body albedo factor (brighter fresh rock on the Moon, darker on Mars).

## HD Earth terrain (`hd.ts`)

- Setting `surfaces.hdEarth` (Graphics, default on), off at potato quality and in test mode; `?hdterrain=1` forces
  it on (test mode and potato included), `?hdterrain=0` turns it off. Below 300 km the main thread fetches the 3x3
  Terrarium block (`z = clamp(round(log2(4e7 / (12 alt))), 5, 12)`) around the sub-camera point with an 8 s
  AbortController timeout, keeps the tiles as blob: URLs and registers an Earth spec at priority 6 naming them; the
  workers decode the blobs, replace the baked land relief inside the block (faded over the outer quarter tile) and
  add ridged detail below the tile pixel. If every tile fails: baked relief stays, one "HD layer unavailable" toast.
- Each block move swaps Earth's height function (life re-seats its objects), so the block keeps some
  hysteresis: the zoom stays until the altitude is 0.15 zoom levels (about 11 %) past a threshold
  (`HD_ZOOM_HYSTERESIS`; 1151 m, 2302 m, ...), and at the same zoom the block stays while the camera is within
  0.2 tile (`HD_TILE_MARGIN`) of its middle tile, so it is still at least 0.55 tile from the faded outer
  quarter.
- Blob URLs of a replaced or dropped block (quality to potato, setting off) are revoked 60 s later, after the
  worker builds still fetching them.
- Memory per block move stays flat: the 'surface' height module keeps its decoded base rasters per path (a new
  block decodes only its 9 Terrarium tiles, not the 2k PNGs again), and the terrain height-function cache keeps
  only the current and the loading spec per body (`terrain/height-modules.ts`).

## Bookmark and tests

- `earth-himalaya`: earth.fixed, 7.5 km over western Tibet (32.3 N 81.3 E) looking south across the Kailash range to
  Gurla Mandhata at 08:00 local time (2026-11-15T02:35Z), Sun from the left, fovY 35 deg, EV 14. The Everest massif
  sits under thick cloud in the static cloud map (earth.clouds at 6 km) and the 2k raster smooths its peaks below
  that deck, so the cloud-free stretch of the same orogen is used.
- Unit: FC on a synthetic sphere cap + bumps (RMS < 2 %); crater SFD slope -2 +- 0.2 and absolute density; crater
  profiles; batch independence, date-line/pole continuity and smooth neighbours; real rasters (Tycho depth, Olympus vs
  Hellas, Himalaya high / Pacific at sea level); specs; Terrarium decode of the fixture, tile maths, HD block
  sampling, HD block hysteresis (zoom thresholds, tile edges) and blob-URL revocation of a dropped block.
- E2E `tests/e2e/surfaces.spec.ts` (potato): apollo11-2m (@smoke), mars-gale-sunset and earth-himalaya check a
  non-smooth skyline (RMS about a quadratic > 0.6 px), ground contrast, zero errors and budgets; HD with `route()`
  fixtures (9 tiles requested, z9 block, no errors) and with refused tiles (fallback identical to the baked view).

## HD Earth terrain by default

The HD layer (`hd.ts`, AWS Terrarium near the camera below 300 km) is on by default outside test mode from low
quality up (setting `surfaces.hdEarth`, default true; `?hdterrain=0` or the setting turns it off, and switching to
potato drops the block). Test mode keeps it off unless `?hdterrain=1`, which also overrides potato and which e2e
routes to fixtures. This became possible with the terrain `softReset`
(`terrain/manager.ts`): when the 3x3 block moves, the drawn tiles and the CPU height function stay while the drawn
tiles are rebuilt for the new block and swapped in one by one, instead of all of Earth's tiles being dropped at
once. Terrarium is reachable from the build container now and was checked live (Himalaya).

## Known gaps

- FC heights lack long wavelengths (Mars dichotomy, Tharsis, lunar far-side highlands); 2k rasters are 5-20 km/px.
- Earth: no rendered sea floor (sea at 0 m; the bathymetry proxy is only used with `ocean.floor`) and coastlines are
  blobby at 20 km without the HD layer.
- Crater contributions are summed (no overprinting), and potato's 64-tile cap keeps close-up ground coarse.
- The Ultra 8k texture streaming flag (DESIGN 4.3) is not implemented.
