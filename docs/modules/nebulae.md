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
   dome inside the clipped plateau: log Y += g·(d − d²/2dMax), d the depth inside the plateau. A feathered weight of
   the plateau (smoothstep of the signed distance to its edge over `photo.coreBlendArcmin` = 1') marks where the
   steps below treat the core differently.
5. **Hubble core** (`orion-core.webp`, 1024² over ±13'): registered by a similarity fit on the Trapezium (flux-weighted
   θ¹ Ori A-E, unresolved), θ² Ori A and NU Ori in the blue-excess image (max residual 1.5 px, 1.389"/px, −0.9°),
   de-starred (including diffraction spikes) and turned into a luminance detail ratio. Outside the plateau the ratio
   is against a blur at the resolution of the resampled Stellarium image (~16" FWHM); inside it, where the photo has
   no structure at all, against a 60" (σ) blur, so the Orion Bar and the dark zone beyond it, the bright ridges and
   the edge of the Fish's Mouth (20"-3') come from Hubble (blended in log space with the plateau weight; the
   numerator is smoothed by σ 1.7" so the JPEG copy's grain does not show at inside magnifications). Stored as
   0.5 + log2(ratio)/6 (×1/8 to ×8, the Bar's ×3-5 contrast fits). If the registration fails the build writes
   `core: null` and the runtime skips it.
6. **Calibration.** L = a · sinh(p · v) with v the display-encoded photo luminance, the inverse of the asinh stretch
   of astro images, with p = 8, measured **with the core ratio applied** (decoded from the written WebP and averaged
   over each emission pixel, `coreGainOnGrid`), so what the runtime shows has the catalogue values: the dome slope g
   is set by the ratio of the core (16.5 mag/arcsec² for the brightest 0.5'-radius disk) to the total (V = 4.0
   inside 30' of θ¹ Ori C, OpenNGC NGC1976, M43 excluded), and a by the total. M43 is the independent check: V 8.44
   inside 4' of NU Ori against OpenNGC's 9.0 (±0.7). (Fitting p on M43 as well is ill-conditioned: M43's flux depends
   on how NU Ori's remnant is treated.) The dome peaks at ×1.7 (the Hubble ratio now carries the rest of the peak).
7. **Colours.** Linear photo RGB is unmixed into three components (Hα+[NII], [OIII]+Hβ, scattered light) with a typical
   camera response per component (`photo.cameraResponse`), each kept as luminance. Inside the plateau the photo is
   white, which would unmix to a pink-white (Hα 24%, [OIII] 57%, scattered 18%); there the sourced core mix
   (`photo.coreMix`: [OIII]+Hβ 0.70, Hα+[NII] 0.17, scattered 0.13, from Esteban et al. 2004 line ratios weighted by
   V(λ)) replaces it, blended over the plateau edge: the Huygens region reads teal-white. `orion-emission.webp`
   (near-lossless, so no chroma subsampling mixes the components) stores the observed column radiance of the three
   components as (L / lRef)^(1/4).
8. **Maps** (`orion-maps.webp`, 512², lossless; a separate texture rather than the emission's alpha channel, because
   browsers may premultiply image alpha on decode and lose the colour where τ is small): R = dust optical depth τ_V,
   G = z displacement (high-passed log brightness), B = thickness noise (seeded fBm). τ is defined in calibrated
   linear light: τ = ln(L_env / L) − 0.5 for lane pixels (L_env the upper envelope of L over ~1.5', only in brown-red
   or dark pixels inside nebular light), so behind a lane the de-reddened light S·e^τ is the envelope, not a dark
   hole. Next to the core, where the photo is clipped, the **Dark Bay** (`geometry.darkBay`, NE of θ¹ Ori C within
   5') gets τ = ln(azimuthal envelope at the same radius / L): it is extinction in the Veil, and the radio continuum
   shows the gas continuing behind it (O'Dell & Yusef-Zadeh 2000). Max τ_V 4.5 (A_V up to ~4-5 in the Dark Bay).

Shipped size: ~0.78 MB (`orion-emission.webp` 553 KB, `orion-maps.webp` 173 KB, `orion-core.webp` 48 KB).

## Depth model (`model.ts` + GLSL twin `model.glsl`)

Local frame `nebula:m42` (pc): origin θ¹ Ori C at 400 pc, x east, y north, z away from Earth. A column is an Earth ray
(ξ, η) = (x, y)/(400 + z); every column holds the observed radiance of the three components and its maps. Along the
column the emission sits in layers whose profiles (3/4 (1 − u²), u = (z − zc)/hw) integrate to 1, so the view from
Earth is the photo whatever the depth model does:

- **Sheet** (the ionization front): a bowl 0.2 pc behind θ¹ Ori C, concave towards Earth
  (z = 0.2 − 1.6 (1 − exp(−ρ²/2·1.5²)) pc), with the Orion Bar escarpment 0.23 pc to the SE (PA 60°, rising
  0.25 pc towards us; half-length 1.2 pc). 0.03 pc thick near the core (the bright emission's emission measure fits
  in a few 0.01 pc; a thin layer also shortens the extrusion of the 2.5D model seen from inside), 1 pc beyond 4 pc,
  ±40% thickness noise and a z displacement of half the thickness from the map. Within 5-20 pc of θ¹ Ori C the
  layer is sheared sideways through its depth (up to 1.5 half-thicknesses at its faces, direction from the noise
  map), so a texel is not extruded straight along its Earth column into a radial streak; from Earth there is no
  shear.
- **M43**: a 0.6 pc ball around NU Ori takes the emission of its columns (weight 1 inside 0.42 pc, 0 beyond 0.6 pc).
- **Veil**: an absorber ~2 pc in front (always 0.3 pc in front of the emission) with the lanes' and the Dark Bay's τ
  plus A_V = 0.8 within 2 pc (τ_V at most 4.5). The emission behind it is de-reddened by the same τ (A_λ/A_V = 0.8, 1.1, 1.15 for R_V ≈ 5.5), so the
  product seen from Earth is the photo, and from inside the nebula the hidden light shows.
- **OMC-1**: an opaque slab (τ_V = 8 inside 3 pc, fading by 6 pc) just behind the emission: it hides the Galaxy behind
  the nebula and the nebula from behind.

Every layer integral over a ray segment uses (P(u_b) − P(u_a))/(u_b − u_a), exact for any step size along an Earth
ray; absorbers in front of an emitter inside the same segment dim it fully (layer centres are ordered). Unit tests
check column conservation within 3% at 24/48/96 steps, layer ordering, the bowl and the Bar, M43, determinism and that
every `NEB_*` constant of the GLSL comes from `nebulaGlslDefines()`.

## Rendering (`render.ts`, `march.glsl`, `display.glsl`)

A background-layer Renderable modelled on `milkyway/galaxy.ts`:

- The eight corners of the box (±ξmax·(D + zMax) ≈ ±6.3 pc, z from −4.0 to 2.45 pc, a conservative bound of every layer) are projected; the march covers only that
  screen rect (the whole screen when the camera is inside the box or the box straddles the camera plane). Below 4 px
  on screen nothing runs.
- The 8-bit emission and core textures are copied once (first visible frame) into linear-light HalfFloat targets
  with their own mip chains (`linearise.glsl`, ~11 MB each): coarse levels average light, not encoded values (the
  v⁴-encoded mips lost 0.2-1.4 mag at wide views, more at low resolutions). The 8-bit sources are then freed.
- Reduced-resolution march into a HalfFloat target: radiance of the three components (cd/m² × 1000) and the V-band
  opacity of the background. The target never exceeds the 1280×720 texel budget of the preset (`marchSize`: the
  divisor grows past 1280×720), so the owner's 2268×1240 marches the same ~102k texels on medium as 1280×720. Re-marched only when the view changes; while still, 8 jittered frames are averaged
  (constant-alpha blending; never in tests).
- Sheet tracing: the vertical gap to the nearest emitting layer sets the step (0.35-3 × the uniform step), the last
  segment always reaches the far side, early exit below 0.3% transmittance. Texture LOD follows the ray footprint:
  the pixel cone, or the ray's sideways travel across the columns per step if larger (grazing rays from inside the
  nebula), so detail between samples is averaged instead of aliasing into a mottled texture.
- Steps and divisor per preset: potato 24 / 4, low 32 / 3, medium 48 / 3, high 96 / 2, ultra 128 / 1. The work is
  reported through `uSteps` and `material.userData.marchSteps` (scaled to the marched sub-rect).
- The composite is a quad over the rect at renderOrder −7.5 (after the panorama and the Galaxy, before the star
  points), premultiplied: the dust dims the Galaxy behind, stars drawn later stay undimmed.
- **Near the Sun** the stars panorama holds a blurred M42 of its own. While the volume is drawn, the module cuts it
  out (`setPanoramaHole`, 1.0° inner, 1.4° outer, membrane from a 1.6° ring), so the calibrated nebula is not added
  on top of that copy. The nebula's opacity stays scaled by 1 − milkyWayFade there: near the Sun the panorama stands
  for the whole sky glow around M42 (including the 8x display boost), and letting OMC-1 black it out would leave a
  dark disc ~1° across around the nebula; from 200-400 pc out the volume's dust dims the Galaxy fully.
- Distant views (> 30-100 pc, Earth included) get full-resolution detail: the ratio of the sharp texel to its
  march-resolution blur where the view ray meets the plane through θ¹ Ori C, for the emission and for the Hubble
  core ratio. Nothing is allocated per frame.

Budgets (`tests/e2e/perf-volumes.spec.ts`, medium 1280×720): the inside view marches the whole screen at 1/3
resolution, 4.9M fragment steps (design limit 8M); the telescope view 1.5M; the inside view at 2268×1240 stays
within the same budget (the texel cap).

## Photometry and display styles (`display.ts`)

- **Realistic** (default): each component in its true colour (CIE 1931 colour of Hα 656.3 / [NII] 658.4 nm, of
  [OIII] 500.7 / 495.9 with Hβ 486.1 nm, and an 11 000 K continuum, brought into the sRGB gamut by adding white, which
  keeps the luminance). Output is physical: the core is 0.027 cd/m², below LIT_FLOOR (0.05), so eye adaptation and
  star brightness are unaffected from outside the nebula.
- **Astrophoto** (display only, no re-march): magenta-red Hα, teal [OIII], blue-white scattered light; an asinh
  stretch of the **physical** luminance against the calibrated core, Y_s = 0.55 · L_ref · asinh(Y / (0.015 · L_ref))
  / asinh(1 / 0.015) with L_ref = 0.027 cd/m², then saturation ×1.6, then the exposure. The stretched field does not
  depend on the exposure, so the eye adaptation cannot undo it (on pre-exposed luminance it settled ~4 stops darker
  inside the Veil and dimmed every star); at the night EV −5 the core lands at ~0.4 pre-exposed, in AgX's colourful
  range instead of white, and light at ~21 mag/arcsec² is lifted ~3 stops.

## Stars

θ¹ Ori A-E, θ² Ori A and NU Ori are promoted for the whole session through `starSystems().promoteCustom` at 400 pc
along their catalogue directions with absMag = V − 8.01, so the view from Earth keeps their positions and V. HYG has
θ¹ Ori A, C and D at its 100 kpc no-parallax placeholder, θ² Ori A at 474 pc and NU Ori at 444 pc, and lacks θ¹ Ori B
and E; the HYG duplicates are hidden (`CustomStar.hygIndex`; `HIDE_MAX` 16, as many as starsystems' sprites, so
nearby promotions can never push these session-held duplicates out and bring θ¹ Ori C's 100 kpc placeholder back).
`CustomStar.ownInfo` keeps the generic 'Star (promoted)' card off them (θ¹ Ori B and E have no HYG row), so the
sourced nebula card shows. Their labels have a low priority (17-19) so the bright named stars keep theirs in Orion.
Known limit: absMag = V − 8.01 keeps the line-of-sight extinction (A_V ~1.5-2.5 for θ¹ Ori A, C, D and E) while Teff
and radius are intrinsic, so within ~70 AU, where the sphere replaces the sprite, θ¹ Ori C brightens by ~2 mag, and
inside the Veil the stars stay reddened while the gas is de-reddened. All stars are drawn after the nebula, so seen
from behind the cloud the Trapezium shines through OMC-1 undimmed.

## UI

- Frame `nebula:m42` (anchoring radius 12 pc). Search: `neb:m42` (Orion Nebula, M42, NGC 1976, Great Orion Nebula),
  `neb:m43` (De Mairan's Nebula, M43, NGC 1982), `neb:trapezium` (Trapezium Cluster, θ¹ Orionis). Info cards for the
  three and for every promoted star (sources and approximate flags). Labels: Orion Nebula, M43, Trapezium.
- Settings (group Sky): **Nebulae** (`nebulae.enabled`, `?nebulae.enabled=0`) and **Nebula style**
  (`nebulae.style`: realistic / astrophoto, `?nebulae.style=`). Arriving at `m42-astrophoto` switches Astrophoto on;
  a style switched on by arrival goes back to Realistic beyond 60 pc from θ¹ Ori C or on arrival at another bookmark,
  unless the user changed it; an arrival that finds Astrophoto already chosen does not claim it, so leaving never
  undoes the user's own choice (the Sun filter pattern, `style.ts`, unit tested). Debug: `nebulae.gain`.
- Bookmarks: `m42-telescope` (from Earth, 2.5° field, EV −5), `m42-from-20ly` (EV −5), `trapezium-inside` (EV −1.5:
  inside the Huygens region the whole sky glows at ~0.05 cd/m², four stops above the night sky, which is where the eye
  adaptation settles; at EV −5 the frame is white), `m42-astrophoto` (EV −5, 3.2 pc out only 3° off the Earth
  line: the Veil 2 pc in front shifts its lanes by 2 pc · tan(tilt), so at the former 28° the Dark Bay and the lane
  between M42 and M43 moved ~9' off the emission), `m43-close` (search target). `m42-telescope` stays at EV −5: a
  longer exposure lifts the (8x display-boosted) panorama glow around Orion with the wings and merges the Orion Bar
  into the blown core.

## Tests

- Unit (`tests/unit/nebulae`): registration (corners map to (s·W, (1−t)·H) with the pinned `textures.json` entry in
  `tests/fixtures/nebulae/`, north up and east left, the build's star predictions reproduced, the homography and the
  gnomonic projection, imported from the build), calibration measured on the decoded WebPs with the core ratio
  applied (V 4.0 ± 0.1, core 16.5 ± 0.3, M43 9 ± 0.7), bowl and Bar geometry, layer order, column conservation, the
  layer shear (off from Earth), determinism, TS/GLSL sync, display styles (the Astrophoto stretch scales linearly
  with exposure), the march texel cap, the auto-off state machine (including a user's own Astrophoto choice), the
  Trapezium absMag and HYG matching, bookmarks (the Astrophoto parallax bound) and cards. `tests/unit/starsystems`:
  a custom star's HYG duplicate stays hidden among a dozen nearer promotions.
- E2E (`tests/e2e/nebulae.spec.ts`, potato 480×270): the nebula's own light SW of the Trapezium against the Dark Bay
  NE (a flipped registration fails), the core from 20 ly, the lit inside view, the Astrophoto switch.

## Known limits

- The calibration makes the outer wings faint (μ ≈ 22-24 at 10-20'): from Earth they sit below the Milky Way
  panorama's (8x display-boosted) glow around Orion, so in Realistic M42 shows ~20-25' across; Astrophoto shows the
  wings.
- Inside the nebula the 2D column structure still shows where the sheet is seen at grazing angles (shorter and sheared
  since the thinner layer and the warp).
- Dust lanes render dark purple-maroon rather than brown: reddening is in the photo's colours, and a brown tint by
  the march opacity would brown the whole core too (OMC-1 behind it is opaque), so it needs the Veil's τ in front as
  a separate march output (not done).
- The depths of the stars inside the cluster are unknown: all sit at 400 pc.
- The licence of `m42.png` is CC BY 3.0: Stellarium's `CREDITS.md` §4.41 lists "Images of M33, M42, NGC253,
  NGC5566, LBN782, the Pleiades from HG731GZ" under CC BY 3.0 Unported, and `textures.json` credits m42.png to
  HG731GZ.
