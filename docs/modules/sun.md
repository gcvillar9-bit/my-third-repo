# Sun (P3-B)

Replaces the Sun v1 look. Cross-module API: `src/modules/sun/public.ts`. Hand-entered numbers live in
`src/modules/sun/sun-data.json` with their sources (all marked approximate).

## Photosphere (`shading.ts`, `glsl/photosphere.glsl`)

- `SurfaceShading` for `'sun'` at priority 10, drawn by the solar-system sphere provider.
- **Limb darkening:** the Neckel (2005) analytical 5th-order polynomial I(μ)/I(1) = Σ A_k μ^k at 650, 550 and
  450 nm (R, G, B). The disk-centre radiance I0 per channel is `L_mean · colour / (2 Σ A_k/(k+2))`, so the
  disk-averaged luminance equals `SUN_DISK_LUMINANCE` (about 1.9e9 cd/m²). The colour is `blackbodyRgb(teff)`.
- **Granulation:** a 3D Worley field on the body-fixed direction with about 1,000 km cells. Brightness
  `lane(F2 − F1) · (1 − 0.45 F1)` gives bright granules and dark lanes. Feature points orbit inside their
  cells with an integer number of cycles per day (lifetimes of about 8-13 min), so the animation is exactly
  periodic in `starTime(jd)` (sim seconds wrapped to a day). It follows sim time, so pause and warp work.
- **Supergranulation:** a second Worley field with about 30,000 km cells adds a faint bright network (±3%).
- Both fields are normalised to zero mean and unit rms with constants measured on the CPU twin
  (`photometry.ts`; a unit test keeps the GLSL `#define`s in sync). rms contrast is 14%. Each field fades out
  once one pixel's footprint (foreshortened by 1/μ) exceeds about one cell, so the disk mean is exact at every
  distance and there is no aliasing.
- `starSurface(teff, radius, { bodyId, priority, granuleM, contrast })` builds the same shading for any star.
  The mean luminance scales as the blackbody Y(teff)/Y(5772 K). The granule size scales as T/g at solar mass,
  `1,000 km · (teff/5772) · (R/R☉)²`, clamped to [100 km, R/20].

## Corona (`corona.ts`, `glsl/corona.glsl`)

- A back-faced shell of 8 R☉ in the transparent layer, with additive blending and depth test on (so the
  disk and the Moon occlude it). Each fragment takes its view ray's impact parameter p (solar radii) and
  outputs the Baumbach K+F brightness, `1e-6 · (0.0532 p^-2.5 + 1.425 p^-7 + 2.565 p^-17) · L_mean`, which
  is about 2,000-8,000 cd/m² at the limb.
- **Streamers:** value noise on the direction of closest approach, so every structure is radial. They are
  weighted towards the solar equator (pole from `sun.fixed`) and fall off more slowly there.
- The corona is physically pre-exposed, so it is invisible next to the photosphere or a daylight sky. It
  appears in totality (`eclipse-2027-luxor`) or at very low exposure. It is hidden once the shell is under a
  few pixels.
- The v1 aureole quad `solar-system.sun-glow` (2e-4 of the disk) is removed at init with
  `registry.removeRenderable`, because it would outshine the corona 100× in totality. Bloom provides the
  optical glare instead. See `docs/requests/p3-sun-smallbodies.md`.

## Activity model (`activity.ts`, simulated)

Nothing here is a real spot or prominence position: it is a procedural Sun whose statistics follow the cycle.
Everything is a pure function of the JD (seeded per day, per 24-day prominence bucket and per flare hour), so
pause, warp and tests are reproducible. All numbers live in `sun-data.json` with their sources (approximate).

- **Cycle:** smoothed sunspot number from the Hathaway, Wilson & Reichmann (1994) shape
  `x³ / (exp(x²) − 0.71)` fitted to the SILSO minima/maxima of cycles 22-26 (25's maximum and 26 are estimates;
  other cycles repeat a generic 11-year row). Overlapping cycles add.
- **Groups:** born per day as a Poisson draw with mean `SSN · 0.133 / mean life` (SSN = 10 G + N, so about SSN/7.5
  groups on the Sun), size `u²`, life 3-38 days (Gnevyshev-Waldmeier), growth then linear decay. Latitudes follow
  the butterfly diagram (Spörer: 28° · exp(−t / 90 months), σ 5°, limited to 3-40°, Hathaway 2011); Joy's-law
  tilt 0.5 × latitude; longitudes drift with Snodgrass (1983) differential rotation relative to `sun.fixed`.
- **Bipolar groups (`groupSpots`):** a compact leading spot (longest lived, always `spots[0]`), a following spot
  that decays first with 1-4 fragments around it, a satellite behind the leader (size > 0.22) and middle spots
  (size > 0.4). Umbra radii 2.5-12.5 Mm; below 1.6 Mm a spot has no penumbra (a pore). Many smaller pores are
  procedural in the shader (below). Spots carry a stable seed (outline and filament twist).
- **Packing:** up to 64 spots and 24 regions in uniforms; when a crowded Sun (near maximum) has more, the groups
  on the hemisphere facing the camera are packed first. Spot `w` = ±(seed + umbra radius in radii).
- **Flares:** per group and hour bucket, probability `0.008 + 0.1 size²`, 10 min to 3 h, fast rise and decay.

## Sunspots in white light (`glsl/photosphere.glsl`)

- **Outline:** penumbra and umbra boundaries are the circle times `1 + a·(harmonics 1-3 of the polar angle)`
  with per-spot amplitudes and phases: smooth, irregular, no petals. A 3.5% serration marks the filament ends.
- **Penumbral filaments:** value noise on circles of the polar angle (bundles 2.4 Mm apart at the edge, then
  2.13× finer up to four octaves), stretched along the radius and slightly twisted. Each octave fades once a
  pixel spans one, and the rest are renormalised with the finer ones weighted up, so the penumbra always shows
  the finest resolvable filaments. Bright grains sit at the inner filament heads. Mean penumbra 0.52 (darker
  than the measured 0.75-0.85 so it reads as grey next to the granulated photosphere after AgX).
- **Umbra:** `umbraIntensity` (0.15, 0.085, 0.05) of the photosphere, darker towards the core (0.45×) and
  lighter in small spots; faint umbral dots (~0.3 Mm) once resolved. Granulation is suppressed under the
  spot's coverage and continues right up to the penumbra.
- **Pores:** cells of ~3.5 Mm in each region's own frame, present with a density clustered at the two
  polarity centres (±0.5 region radii along the Joy axis, the following one wider), scaled by strength.
- **Faculae:** patchy brightening over the region, visible near the limb only (`(1 − μ)^1.5`).

## Prominences and filaments

- **Quiescent prominences:** two staggered series of 4-10 (more near maximum) re-form every 24 days at
  latitudes 15-55°, 10-120 Mm tall, drifting with the differential rotation. Loop systems (up to 8) sit over
  big groups. They ride on the corona shell near the limb (`promField`): a hedgerow of fine vertical threads,
  or several irregular loop strands (own footpoints, heights and lean, wiggling, thickness and brightness
  varying along the arch, brighter legs, faint coronal rain). An anchor behind the limb hides the base.
- **In totality** they are pink (`colour`, 4e-5 of the disk per unit field, about 10× the inner corona) and
  invisible next to the uneclipsed white-light disk (pre-exposed). At Luxor in 2027 the Moon covers ~55 Mm
  above the limb, so only the tallest show, as small pink specks at the Moon's edge.
- **Filaments:** the quiescent prominences seen against the disk (`filaments()`): long sinuous dark ribbons
  (half-length max(1.4 W, 2.2 H), ≤ 0.45 R), ragged width, barbs to one side, orientation within ±40° of
  east-west (`filamentAngle`, mirrored in GLSL). Active regions add a thin filament along the polarity
  inversion line (absent while flaring). Filaments are drawn in H-alpha only.

## H-alpha filter (setting `sun.filter`: Off / H-alpha, Settings > Sky)

- A look, not physical exposure: the disk is the filter colour (deep red-orange) with mild limb darkening
  `0.6 + 0.4 μ`, its mean luminance `0.28 ×` the white-light mean so the red channel does not clip into orange
  under AgX. On top: the supergranular network broken into mottles, dark fibrils, filaments, plage (bright
  patches over each region), flare ribbons, dark spots and pores. The white-light corona is hidden and
  prominences are lit relative to the H-alpha disk.
- Arriving at `sun-halpha-prominences` (URL, palette, tour) switches it on; it can then be switched off in
  Settings without being forced back on. `?sun.filter=off|halpha` overrides it at boot.

## Info card

The solar-system provider answers `sun`; the sun module wraps that provider in place (keeping the provider
order) and appends: the simulated-cycle sunspot number, the number of simulated groups, "Sunspots,
prominences, filaments: simulated (not real positions)" (all marked approximate) and the filter state, plus a
note in the description (`info.ts`).

## Bookmarks

- `sun-closeup`: 1.03 R☉ from the centre (21,000 km up), looking 50° off nadir, EV 32. Granules span 5-15 px
  at potato, and the limb with black space sits along the top. Unchanged by the activity work.
- `sun-sunspots`: 2024-10-10 12:00 UTC, straight down on the biggest simulated group, centred between its
  leading and following spots with the group axis horizontal and north up; the altitude (90-160 Mm) frames
  the whole group. EV 31.7.
- `sun-halpha-prominences`: 2024-10-19 12:00 UTC (picked offline as the richest view near the 2024 maximum),
  filter on. From 3.2 R with fovY 14°, a ≥ 40 Mm hedgerow sits exactly on the limb at the centre and the disk
  fills the lower half. At init `pickHalphaView` chooses the prominence and camera side whose frame shows the
  most active regions and filament length on the disk.

## Performance

Spots are culled per pixel by distance before any noise; pores (9 cells) and plage only run inside a region's
disc; penumbral octaves stop once a pixel spans one; the prominence loop culls by angle on the sky plane
before its `atan`. The extra cost is a small fraction of the two Worley fields of the granulation.

## Cut or not built

No occlusion-tested lens flare, no Wilson depression or light bridges, no magnetic polarity colours. The
`logg` parameter of DESIGN's `starSurface` is not taken: the radius stands in for g.
