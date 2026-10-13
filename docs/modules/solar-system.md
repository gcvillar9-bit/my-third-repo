# Solar System (P1-C)

The Sun, 8 planets, the Moon, 25 other moons, Pluto/Charon, Ceres, Vesta, Eris, Haumea and Makemake from
`data/solar-system/bodies.json` (format: `docs/modules/data-formats.md`). Cross-module API: `src/modules/solar-system/public.ts`.

## Ephemerides and frames (`ephemeris.ts`, `kepler.ts`, `frames.ts`)

| Bodies                         | Source                                                                         | Frame parent                                   |
| ------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| Sun                            | astronomy-engine `HelioState(SSB)` negated (= `BaryState(Sun)`)                | `ssb`                                          |
| Planets, Pluto                 | `HelioState` + the Sun's barycentric state (= `BaryState`, tested to 1e-9 AU)  | `ssb`                                          |
| Moon                           | `GeoMoonState`                                                                 | `earth`                                        |
| Io, Europa, Ganymede, Callisto | `JupiterMoons`                                                                 | `jupiter`                                      |
| Everything else                | `KeplerOrbit` from `elements` (Newton solver, residual < 1e-12 up to e = 0.99) | `elements.center` (`sun`, `ssb` or the planet) |

- All positions are ICRF axes, metres, float64. Time is clamped to J2000 ± 10 kyr (the engine's `core.planets`
  validity): beyond it every position and orientation is frozen.
- `<id>.fixed`: astronomy-engine `RotationAxis` for the Sun, Moon, planets and Pluto; IAU leading terms
  (`ra0 + raRate·T`, `dec0 + decRate·T`, `w0 + wdot·d`) for the rest. Body→ICRF = Rz(90°+α)·Rx(90°−δ)·Rz(W).
  Triton (locked, no pole): +x towards Neptune, +z along the orbit normal. Eris, Haumea, Makemake: ecliptic pole and
  spin from `periodHours`. Himalia, Nereid, Hyperion: ecliptic pole, no spin. All of these are approximate.
- `<id>.sunview` (bookmarked bodies only): origin at the body, +x towards the Sun, +z towards ecliptic north,
  `influenceRadius` 0. Bookmarks use it so their lighting does not depend on the date; the camera re-anchors to the
  body frame on arrival.
- `Body.influenceRadius` = Hill radius at pericentre, clamped to [20 R, a(1−e)/2]; the Sun uses 40 R☉.
  `Body.radius` is the equatorial radius; `oblateness` comes from the data.

## Rendering

- **Sphere provider** `'sphere'` (bodyId `'*'`, priority 0, `render/sphere.ts`): a tan-warped cube-sphere (32 segments
  per face on potato/low, 48 otherwise) scaled to (a, a, c) and oriented by the `.fixed` frame. It fills
  `SurfaceInput` (uv from the body-fixed direction, seam-safe `textureGrad`), takes up to 4 sphere occluders
  (parent, siblings and moons sunward of the body, plus registered `OccluderProvider`s) into `shadows.glsl`, and
  writes `min(L·uExposure·fade, 6e4)` (the clamp keeps the Sun under the half-float maximum). It wants a body once
  it is wider than 1.5 px.
- **Default shading** (`render/shading.ts`, priority 0). The albedo map is divided by its area-weighted linear mean
  (computed from a 64×32 canvas downsample), so the disk-integrated brightness matches the geometric albedo p that
  the point LOD uses. Airless bodies use Lommel-Seeliger, `E·c·(2p/π)·μ0/(μ0+μ)`. Venus, Earth, Mars, the giants and
  Titan use Lambert, `E·c·(1.5p/π)·μ0`. p is clamped to 1. Bodies without imagery are neutral grey.
- **Earth v1:** Blue Marble as linear reflectance; clouds = brc.B blended as an albedo-0.8 layer; a GGX glint (F0 0.02) on
  the specular mask; city lights at 0.3 cd/m² per white texel gated by `smoothstep(0.05, −0.1, μ0)` and dimmed under
  clouds. City lights are physically invisible at daylight EVs.
- **Sun v1:** emissive shading with linear limb darkening u = (0.50, 0.60, 0.72), normalised so the disk mean is
  `SUN_DISK_LUMINANCE`, and the granulation map at ±50%. The glow is a camera-facing quad out to 12 R☉ with radiance
  2e-4·L☉·(R/r)³, a stand-in aureole: the corona proper is P3. Both fade with the sphere weight.
- **Textures** load lazily the first time a body exceeds 1.5 px, at the preset's tier (4k when `maxTextureSize ≥ 4096`
  and a 4k file exists). They are tracked by `assets.track` (so `ready()` waits for them) and owned by
  `solar-system` in the ResourceBudget. E2E therefore renders one frame, waits for `ready()` again, then renders.
- **Photometric points** (`render/points.ts`): one vertex per body, at the near surface point. Illuminance at the
  camera is `planetPointIlluminance` (DESIGN flux formula, Lambert phase) or `solarIlluminance(Δ)` for the Sun, tinted
  by the map's mean colour once known. A 5 px sprite with a Gaussian PSF (σ = 0.75 px) normalised so that
  Σ L·Ω_px = E. The sphere weight is smoothstep(1.5 → 3 px); points get 1 − weight, so flux stays continuous.
- **Orbit lines** (`render/orbits.ts`): Kepler rows use their fixed conic; astronomy-engine bodies use the osculating
  ellipse of the current state (planets around the Sun, μ = GM_parent + GM_body), so the line passes through the
  body. 256 vertices are evaluated in float64 relative to the camera every frame. Opacity = apparent size
  (smoothstep 3 → 15 px) × edge-on fade (camera height over the orbit plane / a: 0.03 → 0.12) × visited-body fade
  (30 → 150 R) × local-scale fade (hidden when a > 100 × the distance to the nearest body), with per-vertex fade near
  the camera, and a 4 → 10 px gap around the body's own position (R1 review: the faint photometric moon points were
  buried under their lines in `jupiter-moons`). Colours are display-referred (not pre-exposed), like a HUD drawn in
  the scene.
- **Saturn's rings v1** (`render/extras.ts`): an annulus at the Celestia radii textured with `saturn_ring_sss.png`
  (sRGB colour, alpha = opacity). Lit face `E·c·|μs|/(|μs|+|μv|)/π`, unlit face 0.3·(1−α) of that, with Saturn's
  shadow from `shadows.glsl`.

## Bookmarks, search, info

- One bookmark per major body (ids equal the body ids, so `camera.goto('mars')` flies to a lit 3/4 view at 4 R).
  Bodies: Sun, Mercury, Venus, Earth, Moon, Mars, Jupiter, Io, Europa, Ganymede, Callisto, Saturn, Enceladus, Titan,
  Uranus, Neptune, Triton, Pluto, Charon, Ceres and Vesta.
- Special bookmarks: `earth-now` (default start, jd `now`, over the dawn terminator, Sun to screen-right, EV 15),
  `saturn` (7 R over the sunlit ring face, north up), `jupiter-moons` (60 R_J, 50° up, EV 7 exposed for the moons) and
  `solar-system-overview` (70 AU, 50° above the ecliptic, EV 10). Test EVs put the sunlit radiance near 0.35.
- Search: every body (name, id alias, "Moon of Saturn" subtitles). Info: radius, mass, surface gravity, escape velocity,
  sidereal day, year or orbital period, current distance and light-time from the Sun, distance from Earth, albedo.
  Approximate rows and rotations carry `approximate`.

## Known gaps

- No ring shadow on Saturn, no Uranus rings, no Earth normal/bump mapping, no cloud shell parallax (clouds are in
  the surface shader). Venus shows cloud tops only.
- astronomy-engine's Pluto is used as Pluto's centre (Charon's wobble of about 2,100 km is ignored).
- Mesh chord sag: with 48 segments the sphere sits up to about 3e-4 R inside the true radius (about 500 m on the
  Moon at the face centres). Close-range accuracy belongs to P2 terrain.
- Points are physical: faint moons are invisible at daylight EVs (by design).
