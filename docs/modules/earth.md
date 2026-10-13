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

## Known gaps

- Cloud shell has no volumetric thickness or self-shadowing; no specular on clouds.
- Ground receives no skylight (only direct sun), so the terminator is a little harsh.
- The 2k/4k brc cloud map is static (no cloud animation).

## R2b integration changes

- Maps load in tiers: 2k first; the 4k day/night/brc maps only on presets with a 512 MB GPU budget (high, ultra) while Earth is wider than 1200 px, released below 600 px (`earthTierFor`).
- Sea water normals start from the ellipsoid normal (`s.up`), so terrain relief never tilts the glint; the shading defines `SURFACE_DETAIL_MASK` / `surfaceDetailMask()` so the terrain detail bands apply on land only, never on the sea.
- Cloud shell: 64 segments on every preset.
- New fixed-instant bookmark `earth-sunrise-400km` (orbital sunrise over the Atlantic from 40N 80W, 2026-03-20, Sun 7.8° above the limb, EV 11). City lights are too faint for that exposure; see `earth-night-lights`.
- `earth-dawn-400km` is the default start (`src/app/boot.ts`); the 400 km views set `lookAt: 'earth'` so Earth is the HUD target.
