# Earth (P2-B)

Hero Earth: a SurfaceShading override, a cloud shell and three bookmarks. Cross-module API:
`src/modules/earth/public.ts`. Depends on `solar-system` (maps, `CITY_LUMINANCE`) and `atmosphere`
(transmittance LUT).

## Shading (`shading.ts`, `glsl/shading-earth.glsl`, priority 10)

It uses only `SurfaceInput` plus its own `uEarth*` uniforms and the atmosphere's shared `uAtmo*` uniforms, so the
same GLSL serves the sphere provider and the P2-A terrain provider.

- **Maps:** the existing solar-system imagery (`textures/solar-system/earth_{day,night,brc}_{2k,4k}.webp`,
  `earth_spec_2k.webp`), loaded once at the preset tier the first time Earth exceeds 1.5 px, tracked for
  `ready()`, owned by `earth`. The P1 Earth v1 shading never loads its copies (only the winning shading updates).
- **Sunlight:** `E = sunIlluminance · shadow · T_sun · cloudShadow`, with `T_sun` from the atmosphere
  transmittance LUT at radius R + height and the geometric Sun zenith cosine (includes a smooth planet shadow).
- **Day:** Blue Marble as linear reflectance, Lambert. No clouds in the albedo (the shell draws them).
- **Cloud shadows:** cloud density sampled where the Sun ray from the point crosses the 6 km layer
  (`dirBody + sunDirBody · h/R / max(μ0, 0.08)`), shadow = 1 − 0.8·density.
- **Ocean glint:** GGX (F0 0.02, Schlick-GGX visibility) on the spec mask; roughness 0.06 → 0.25 as the pixel
  footprint grows from 2 to 20 m (unresolved wave slopes; about Cox-Munk at 7 m/s from orbit).
- **Water normals:** procedural and exactly tileable (`waves.ts`: 24 integer-wavevector cosine waves, analytic
  slopes, 256×256 RGBA8 DataTexture, built at init, no download and no manifest). Two scrolling layers (tiles of
  32 and 64 band units, which divide the 256 noise period) on the band-3 (10 m) detail domain
  `detailOrigin[3] + localPos/10`, triplanar on the body-fixed normal, faded in below ~6 m per pixel.
- **City lights:** night map × `CITY_LUMINANCE` × `1 − smoothstep(−0.15, 0.1, μ0)` (on from a Sun elevation of
  about +6° down to −9°), dimmed 80% under clouds. Physically invisible at daylight EVs.
- **City lights through time (`city-lights.ts`, `city-lights.json`):** `uEarthCityLuminance` is scaled each frame by
  `cityLightFraction(year)`: 0 before the first electric street lighting (~1880), then piecewise linear on world
  electricity generation as a proxy (1950 ≈ 4%, 1990 ≈ 52%) up to 1 at the night map's epoch (2012). Approximate (only the rendered brightness
  uses it; no value is shown in the UI); the map's geography stays modern (historical cities are a later phase). Dinosaurs no longer see Europe lit up.
- Aerial perspective is not applied here; the atmosphere pass adds it to every pixel.

## Cloud shell (`clouds.ts`)

A cube-sphere (32 segments per face on potato/low, 64 otherwise) at the ellipsoid + 6 km, transparent layer,
premultiplied alpha, depth test on and depth write off, `DEPTH_GLSL`. Density = brc.B shaped by gradient-noise fBm
at 8 km and 2 km wavelengths (eroding edges only), faded out when a pixel exceeds the wavelength. Lit by
`E☉ · T_sun(R + 6 km) · 0.85 · lit / π` with a softened terminator (clouds keep the light a little after ground
sunset). Front faces from above; back faces (darkened cloud base) from below. It fades with the same 1.5 → 3 px
sphere weight as the planet.

## Bookmarks (`bookmarks.ts`)

| Id                   | Frame           | View                                                                                                                                                       | EV   |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `earth-dawn-400km`   | `earth.sunview` | 400 km, 1° into the night side of the dawn terminator, looking north along it yawed 20° towards the Sun, pitched so the limb is 10° above centre; jd `now` | 13.5 |
| `earth-limb-400km`   | `earth.sunview` | 400 km, 30° from the subsolar point on the morning side, looking north, limb 10° above centre; jd `now`                                                    | 15.5 |
| `earth-night-lights` | `earth.fixed`   | 2000 km over 50° N 10° E looking straight down, north up, at 2026-01-01T00:00Z                                                                             | −1   |

The sun-view frame keeps the orbit views' lighting independent of the date; `earth-dawn-400km` is meant to become
the default start (integrator request).

## Tests

Unit (`tests/unit/earth`): water-normal periodicity and seamless wrap, bookmark geometry (400 km, limb above
centre, dawn nadir Sun elevation in (−3°, 0°), night view over Europe), no reserved uniform names in the shading,
map paths, cube-sphere, world-to-body matrix. E2E (`tests/e2e/earth.spec.ts`): dawn limb band b > r with black space
above and day right brighter than night left; warm city lights over Europe; limb band blue over sunlit Earth.

## HD imagery near the ground (`hd-imagery.ts`)

Below 1200 km above the ground, a 4 x 4 block of NASA GIBS Blue Marble Next Generation tiles (EPSG:4326 500m
matrix, 512 px tiles of 2.25 degrees at level 7, about 490 m per pixel against the base map's 10 km; public domain)
around the camera's sub-point is fetched in the browser, composited off-screen and blended into the day map
(`uEarthHd`, `uEarthHdRect`, `uEarthHdMix`; feathered edges; gradients taken outside the branch). The block
re-centres when the sub-point leaves its middle half, and the previous block stays until the new one is complete.
On from low quality up outside test mode (`?hdimagery=0` turns it off); test mode only with `?hdimagery=1`
(`tests/e2e/hd-imagery.spec.ts` routes the tiles to a magenta fixture and checks the refused-tiles fallback).

## Known gaps

- Cloud shell has no volumetric thickness or self-shadowing; no specular on clouds.
- Ground receives no skylight (only direct sun), so the terminator is a little harsh.
- The 2k/4k brc cloud map is static (no cloud animation).
- HD imagery is today's Blue Marble (2004 composite) at every date: in the ice ages and deep time the paleo hooks
  paint over it, but historical dates show today's land cover; level 7 (490 m) is the finest GIBS Blue Marble level.

## R2b integration changes

- Maps load in tiers: 2k first; the 4k day/night/brc maps only on presets with a 512 MB GPU budget (high, ultra) while Earth is wider than 1200 px, released below 600 px (`earthTierFor`).
- Sea water normals start from the ellipsoid normal (`s.up`), so terrain relief never tilts the glint; the shading defines `SURFACE_DETAIL_MASK` / `surfaceDetailMask()` so the terrain detail bands apply on land only, never on the sea.
- Cloud shell: 64 segments on every preset.
- New fixed-instant bookmark `earth-sunrise-400km` (orbital sunrise over the Atlantic from 40N 80W, 2026-03-20, Sun 7.8° above the limb, EV 11). City lights are too faint for that exposure; see `earth-night-lights`.
- `earth-dawn-400km` is the default start (`src/app/boot.ts`); the 400 km views set `lookAt: 'earth'` so Earth is the HUD target.

## Deep-time hooks (paleo)

- `glsl/shading-earth.glsl` declares `earthPaleoSurface` (called after the map samples, may change day, night and
  ocean) and `earthPaleoWater` (used by `surfaceDetailMask`) under `#ifdef EARTH_PALEO`. The paleo module's
  priority-20 wrapper defines them and sets the define; without it the shading is unchanged.
- `uEarthCloudZonal` (shared uniform, default 0): `earthCloudDensity` mixes today's cloud map with
  `uEarthCloudZonalMap` (shared R8 map of equatorial convergence, clear subtropics, storm tracks and
  continental-scale noise, baked once by the paleo module; a 1 x 1 placeholder until then) by this weight, so the
  cloud shell and the ground cloud shadows stay consistent in deep time. It is a texture lookup because the same
  noise evaluated per pixel cost about 15% of present-day Earth frame time on SwiftShader, even behind the
  uniform branch. See docs/modules/paleo.md.
