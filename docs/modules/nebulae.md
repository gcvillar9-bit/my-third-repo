# Nebulae: the Orion Nebula

The Orion Nebula (M42), De Mairan's Nebula (M43) and the Trapezium as a ray-marched 2.5D "blister" volume built from
a registered, de-starred and photometrically calibrated photograph. Module: `src/modules/nebulae` (depends on
`stars` and `starsystems`). Cross-module API: `public.ts` (ids only). The design is "Follow-up 4, Step C" of the
project plan. The module is written so another nebula can be added with its own JSON rows, build outputs and frame.

## Data pipeline (`tools/build-nebulae.mjs`)

Inputs (sha256-pinned in `assets/manifest/nebulae.json`, fetched by `pnpm assets:fetch`): the Stellarium M42 image
(HG731GZ, CC BY 3.0, 1024² over 3.2°) with its sky corners from Stellarium's `textures.json`, and the Hubble
heic0601a mosaic (1280 px copy, 1.39"/px). Hand-entered rows live in `src/modules/nebulae/orion.json`, each with a
`source`. The build is deterministic.

1. **Registration.** A homography between the gnomonic projection of the four corners and the texture coordinates
   (Stellarium's (0, 0) is the bottom-left corner). Checked on 8 catalogue stars (Hipparcos positions, measured as
   background-subtracted centroids of the ring-shaped star remnants): the build fails if any residual exceeds 3 px.
   Today the worst is 2.8 px (`orion-meta.json` records every residual).
2. **Star removal.** Halo rings left by Stellarium's own star removal (difference-of-Gaussians blobs at 3/9 px that are
   bluer than their surroundings, plus the registration stars) and residual compact cores are masked and inpainted
   (a mask-weighted blur pyramid refined into a harmonic fill of the hole's boundary). The Huygens region (< 4') and
   the heart of M43 are excluded from detection; NU Ori's bright halo ring in the middle of M43 is scattered starlight
   (keeping it makes M43 ~1.2 mag too bright) and is replaced by a smooth fill.
3. **Resampling** to a 1024² gnomonic square centred on θ¹ Ori C, ±0.9° (12.6 pc), north up, east left (6.3"/px).
   The sky background (darkest 3%) is subtracted.
4. **Clipped core.** The photo is clipped over the whole Huygens region (~8' across). Its brightness is rebuilt as a
   dome inside the clipped plateau: log Y += g·(d − d²/2dMax), d the depth inside the plateau.
5. **Calibration.** L = a · sinh(p · v) with v the display-encoded photo luminance, the inverse of the asinh stretch
   of astro images, with p = 8. The dome slope g is set by the ratio of the core (16.5 mag/arcsec² for the brightest
   0.5'-radius disk) to the total (V = 4.0 inside 30' of θ¹ Ori C, OpenNGC NGC1976, M43 excluded), and a by the
   total. M43 is the independent check: V 8.67 inside 4' of NU Ori against OpenNGC's 9.0. (Fitting p on M43 as well
   is ill-conditioned: M43's flux depends on how NU Ori's remnant is treated.) The dome peaks at ×1.9. The resulting
   profile: μ ≈ 16.7 within 1', 18.3 at 3-4', 21.6 at 8-10', 24 at 15-20'; 65% of the light is within 4'.
6. **Colours.** Linear photo RGB is unmixed into three components (Hα+[NII], [OIII]+Hβ, scattered light) with a typical
   camera response per component, each kept as luminance. `orion-emission.webp` (near-lossless, so no chroma
   subsampling mixes the components) stores the observed column radiance of the three components as (L / lRef)^(1/4).
7. **Maps** (`orion-maps.webp`, 512², lossless): R = dust optical depth τ_V of the lanes (6 × the photo's local
   log-deficit against its upper envelope over ~1.5', above 0.12, only in brown-red or dark pixels inside nebular
   light; max 2), G = z displacement (high-passed log brightness), B = thickness noise (seeded fBm).
8. **Hubble core** (`orion-core.webp`, 1024² over ±13'): registered by a similarity fit on the Trapezium (flux-weighted
   θ¹ Ori A-E, unresolved), θ² Ori A and NU Ori in the blue-excess image (max residual 1.5 px, 1.389"/px, −0.9°),
   de-starred (including diffraction spikes) and turned into a luminance detail ratio against its own blur at the
   resolution of the resampled Stellarium image, stored as 0.5 + log2(ratio)/4. If the registration fails the build
   writes `core: null` and the runtime skips it.

Shipped size: ~0.86 MB (`orion-emission.webp` 538 KB, `orion-maps.webp` 181 KB, `orion-core.webp` 138 KB).

## Depth model (`model.ts` + GLSL twin `model.glsl`)

Local frame `nebula:m42` (pc): origin θ¹ Ori C at 400 pc, x east, y north, z away from Earth. A column is an Earth ray
(ξ, η) = (x, y)/(400 + z); every column holds the observed radiance of the three components and its maps. Along the
column the emission sits in layers whose profiles (3/4 (1 − u²), u = (z − zc)/hw) integrate to 1, so the view from
Earth is the photo whatever the depth model does:

- **Sheet** (the ionization front): a bowl 0.2 pc behind θ¹ Ori C, concave towards Earth
  (z = 0.2 − 1.6 (1 − exp(−ρ²/2·1.5²)) pc), with the Orion Bar escarpment 0.23 pc to the SE (PA 60°, rising
  0.25 pc towards us). 0.1 pc thick near the core, 1 pc beyond 4 pc, ±40% thickness noise and a z displacement of
  half the thickness from the map.
- **M43**: a 0.6 pc ball around NU Ori takes the emission of its columns (weight 1 inside 0.42 pc, 0 beyond 0.6 pc).
- **Veil**: an absorber ~2 pc in front (always 0.3 pc in front of the emission) with the lanes' τ plus A_V = 0.8
  within 2 pc. The emission behind it is de-reddened by the same τ (A_λ/A_V = 0.8, 1.1, 1.15 for R_V ≈ 5.5), so the
  product seen from Earth is the photo, and from inside the nebula the hidden light shows.
- **OMC-1**: an opaque slab (τ_V = 8 inside 3 pc, fading by 6 pc) just behind the emission: it hides the Galaxy behind
  the nebula and the nebula from behind.

Every layer integral over a ray segment uses (P(u_b) − P(u_a))/(u_b − u_a), exact for any step size along an Earth
ray; absorbers in front of an emitter inside the same segment dim it fully (layer centres are ordered). Unit tests
check column conservation within 3% at 24/48/96 steps, layer ordering, the bowl and the Bar, M43, determinism and that
every `NEB_*` constant of the GLSL comes from `nebulaGlslDefines()`.

## Rendering (`render.ts`, `march.glsl`, `display.glsl`)

A background-layer Renderable modelled on `milkyway/galaxy.ts`:

- The eight corners of the box (±ξmax·(D + zMax), z from −3.4 to 1.8 pc) are projected; the march covers only that
  screen rect (the whole screen when the camera is inside the box or the box straddles the camera plane). Below 4 px
  on screen nothing runs.
- Reduced-resolution march into a HalfFloat target: radiance of the three components (cd/m² × 1000) and the V-band
  opacity of the background. Re-marched only when the view changes; while still, 8 jittered frames are averaged
  (constant-alpha blending; never in tests).
- Sheet tracing: the vertical gap to the nearest emitting layer sets the step (0.35-3 × the uniform step), the last
  segment always reaches the far side, early exit below 0.3% transmittance. Texture LOD follows the ray footprint.
- Steps and divisor per preset: potato 24 / 4, low 32 / 3, medium 48 / 3, high 96 / 2, ultra 128 / 1. The work is
  reported through `uSteps` and `material.userData.marchSteps` (scaled to the marched sub-rect).
- The composite is a quad over the rect at renderOrder −7.5 (after the panorama and the Galaxy, before the star
  points), premultiplied: the dust dims the Galaxy behind, stars drawn later stay undimmed. The opacity is multiplied
  by 1 − milkyWayFade: near the Sun the panorama photo already holds M42 and its dust.
- Distant views (> 30-100 pc) get full-resolution detail: the ratio of the sharp texel to its march-resolution blur
  where the view ray meets the plane through θ¹ Ori C.

Budgets (`tests/e2e/perf-volumes.spec.ts`, medium 1280×720): the inside view marches the whole screen at 1/3
resolution, 4.9M fragment steps (design limit 8M); the telescope view 1.5M.

## Photometry and display styles (`display.ts`)

- **Realistic** (default): each component in its true colour (CIE 1931 colour of Hα 656.3 / [NII] 658.4 nm, of
  [OIII] 500.7 / 495.9 with Hβ 486.1 nm, and an 11 000 K continuum, brought into the sRGB gamut by adding white, which
  keeps the luminance). Output is physical: the core is 0.027 cd/m², below LIT_FLOOR (0.05), so eye adaptation and
  star brightness are unaffected from outside the nebula.
- **Astrophoto** (display only, no re-march): magenta-red Hα, teal [OIII], blue-white scattered light; an asinh
  stretch of the pre-exposed luminance (softening 0.015, Y = 1 unchanged) and saturation ×1.6.

## Stars

θ¹ Ori A-E, θ² Ori A and NU Ori are promoted for the whole session through `starSystems().promoteCustom` at 400 pc
along their catalogue directions with absMag = V − 8.01, so the view from Earth keeps their positions and V. HYG has
θ¹ Ori A, C and D at its 100 kpc no-parallax placeholder, θ² Ori A at 474 pc and NU Ori at 444 pc, and lacks θ¹ Ori B
and E; the HYG duplicates are hidden (`CustomStar.hygIndex`, `HIDE_MAX` 8). Their labels have a low priority (17-19)
so the bright named stars keep theirs in Orion.

## UI

- Frame `nebula:m42` (anchoring radius 12 pc). Search: `neb:m42` (Orion Nebula, M42, NGC 1976, Great Orion Nebula),
  `neb:m43` (De Mairan's Nebula, M43, NGC 1982), `neb:trapezium` (Trapezium Cluster, θ¹ Orionis). Info cards for the
  three and for every promoted star (sources and approximate flags). Labels: Orion Nebula, M43, Trapezium.
- Settings (group Sky): **Nebulae** (`nebulae.enabled`, `?nebulae.enabled=0`) and **Nebula style**
  (`nebulae.style`: realistic / astrophoto, `?nebulae.style=`). Arriving at `m42-astrophoto` switches Astrophoto on;
  a style switched on by arrival goes back to Realistic beyond 60 pc from θ¹ Ori C or on arrival at another bookmark,
  unless the user changed it (the Sun filter pattern, `style.ts`, unit tested). Debug: `nebulae.gain`.
- Bookmarks: `m42-telescope` (from Earth, 2.5° field, EV −5), `m42-from-20ly` (EV −5), `trapezium-inside` (EV −1.5:
  inside the Huygens region the whole sky glows at ~0.05 cd/m², four stops above the night sky, which is where the eye
  adaptation settles; at EV −5 the frame is white), `m42-astrophoto` (EV −5), `m43-close` (search target).

## Tests

- Unit (`tests/unit/nebulae`): registration residuals, calibration measured on the decoded WebP (V 4.0 ± 0.1, core
  16.5 ± 0.3, M43 9 ± 0.7), bowl and Bar geometry, layer order, column conservation, determinism, TS/GLSL sync,
  display styles, the auto-off state machine, the Trapezium absMag and HYG matching, bookmarks and cards.
- E2E (`tests/e2e/nebulae.spec.ts`, potato 480×270): the nebula's own light SW of the Trapezium against the Dark Bay
  NE (a flipped registration fails), the core from 20 ly, the lit inside view, the Astrophoto switch.

## Known limits

- Near the Sun the panorama (stars module) holds a blurred M42 of its own and is bright and blocky at telescope
  magnification; the nebula adds to it (see `docs/requests/nebulae.md`).
- The calibration makes the outer wings faint (μ ≈ 22-24 at 10-20'): seen from Earth or from 20 ly only the Huygens
  region stands out in Realistic; Astrophoto shows the wings.
- Inside the nebula the 2D column structure shows as radial streaks where the thin sheet is seen at grazing angles.
- The depths of the stars inside the cluster are unknown: all sit at 400 pc.
