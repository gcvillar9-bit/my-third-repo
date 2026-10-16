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
  is about 2,000-8,000 cd/m² at the limb. The shell starts at p = 0.985, a little inside the limb: the
  tessellated disk's silhouette chords fall inside the true sphere, and the disk depth-occludes the shell
  wherever it does cover (no dark seam along the limb).
- **Structure** (all on the direction of closest approach, so every structure is radial): the cycle's
  Ludendorff flattening, `mix(0.2 + 0.8 cos⁸(lat), 1, SSN/200)` (streamers crowd the equator at minimum,
  rounder at maximum; pole from `sun.fixed`); helmet streamers over the prominence anchors (filament channels
  and active regions), broad at the base and narrowing outward, weighted by how close the anchor lies to the
  plane of the sky; fine rays at ±30%. Equatorial streamers fall off more slowly.
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
  `maxSsn · s((t − t0Year) / bYears) / max(s)`, `s(x) = x³ / (exp(x²) − 0.71)`. Each row's start `t0Year` and
  timescale `bYears` are least-squares fits to the SILSO annual means 1986-2025 and the smoothed minima (2.2 in
  Dec 2008, 1.8 in Dec 2019); `minYear`, `maxYear` and `maxSsn` are the SILSO smoothed extrema (display values;
  `minYear` also starts the butterfly). The model gives about 2 at both minima (the Sun is often spotless),
  14 in 2018, 158 in late 2024 and about 70 at the August 2027 eclipse. Cycle 25 after 2025 and cycle 26 are
  estimates; other cycles repeat a generic 11-year row. Overlapping cycles add.
- **Groups:** born per day as a Poisson draw with mean `SSN · 0.133 / mean life` (SSN = 10 G + N, so about SSN/7.5
  groups on the Sun), size `u²`, life 3-38 days (Gnevyshev-Waldmeier), growth then linear decay. Latitudes follow
  the butterfly diagram (Spörer: 28° · exp(−t / 90 months), σ 5°, limited to 3-40°, Hathaway 2011); Joy's-law
  tilt 0.5 × latitude; longitudes drift with Snodgrass (1983) differential rotation relative to `sun.fixed`.
- **Bipolar groups (`groupSpots`):** a compact leading spot (longest lived, always `spots[0]`), a following spot
  that decays first with 1-4 fragments around it, a satellite behind the leader (size > 0.22) and middle spots
  (size > 0.4). Umbra radii 2.5-12.5 Mm. Many smaller pores are procedural in the shader (below). Spots carry a
  stable seed 0-31 (outline, filament twist, light bridge).
- **Spot kinds (`classifySpots`):** within one polarity, a spot whose penumbra radius touches a bigger spot's
  and that is small (below 2.5 Mm) or already inside it becomes an umbra **embedded** in that penumbra (pulled
  inside it if needed), so a satellite never sits on the rim as a second disc. A big spot just outside keeps a
  **full** penumbra and the shader merges the two into one common penumbra. Lone spots get a full penumbra above
  2.5 Mm, a one-sided **partial** penumbra (a 120-200° sector) above 1.6 Mm, and none (a **pore**) below.
- **Packing:** up to 64 spots and 24 regions in uniforms; when a crowded Sun (near maximum) has more, the groups
  on the hemisphere facing the camera are packed first. Spot `w` = 32 · (kind + 4 · following) + seed + umbra
  radius in radii (`packSpotW`; the integer part stays below 256, so float32 keeps the radius to ~10 km).
- **Cost:** the activity is evaluated at the start of each sim minute (`activityJd`; spots drift ~2 km a
  minute), so it stays a pure function of the JD, and not at all while the Sun is under 2 px in radius (the
  uniforms then hold no spots, regions or prominences). Uniforms are written with indexed stores.
- **Flares:** per group and hour bucket, probability `0.008 + 0.1 size²`, 10 min to 3 h, fast rise and decay.

## Sunspots in white light (`glsl/photosphere.glsl`)

- **Common penumbrae:** the spots are merged with a smooth union of their normalised penumbra distances
  `s = (r − Ri) / (Ro − Ri)` (`sU = −log Σ exp(−6 s) / 6`, umbra the maximum over spots), so neighbouring
  umbrae of one polarity share one irregular penumbra with no circle seams. Its filaments come from the nearest
  umbra; where two systems meet they converge on a narrow soft seam (about 0.06 penumbra widths). Embedded
  umbrae carry a narrow penumbra of their own (1.35× their radius) that merges into the parent's.
- **Outline:** penumbra and umbra boundaries are the circle times `1 + a·(harmonics 1-3 of the polar angle)`
  with per-spot amplitudes and phases (30% for the penumbra) plus a little noise: irregular at large scale, no
  petals. At small scale the outer edge is ragged: some filaments run on up to 10% of the penumbra width into
  the granulation (fingers about 0.5 Mm wide) and brighter bundles reach a little further. Following spots with
  a full penumbra are elongated along the (roughly east-west) group axis by up to 1.4×.
- **Penumbral filaments:** thin bright filaments of constant physical width (FWHM ~0.25 Mm) on darker lanes,
  one per angular sector with a random centre, start and end, a slight wiggle, a small twist and brightness
  varying along the length. Level A (sectors 0.45 Mm apart at the umbra radius) starts at the umbra edge, level
  B (same count, half a sector over) switches in between 1 and 2 umbra radii and level C (twice the count)
  beyond 2, so the width stays put while their number grows outwards (~300 around an 8 Mm umbra) instead of
  widening into wedges. Each starts in a bright penumbral grain (wider, brightest); about a third of the level-A
  grains intrude into the umbra. Bundles (2D value noise a few sectors wide, ±30%) group them into brighter and
  darker streaks. Anti-aliasing: lines under ~1.5 px are widened at constant area, and each level fades to its
  analytic mean once under ~2 px per filament (bundles once under ~3 px per cell), so there is no shimmer
  while zooming or as spots rotate and an unresolved penumbra keeps its mean (measured 0.738 at potato
  480×270, 0.743 at 960×540, 0.72 at 1920×1080 in the bookmark).
- **Penumbra brightness:** radiance `uPenumbra · (0.66 + 0.76 f)` with `penumbraIntensity` 0.61 and the
  filament field `f` (mean ~0.42): dark lanes 0.40, the brightest filaments and grains 0.87 of the
  photosphere. Real penumbrae average ~0.75 with dark lanes ~0.6 and bright filaments ≤ 0.95, but the AgX tone
  mapping compresses ratios near the photosphere roughly as a 0.6 power, so the radiance sits lower to show the
  real ratios on screen. Measured on `sun-sunspots` (sRGB-linearised luminance over the local photosphere,
  leading spot, 1.15-2.2 umbra radii): mean 0.74, dark lanes 0.54-0.60 (p5), bright filaments 0.92-0.95
  (p95-p99 at 1920×1080), under 1% of pixels above the photosphere mean (granules and outline wobble).
- **Umbra:** `umbraIntensity` (0.095, 0.075, 0.062) of the photosphere, the 4000 K / 5800 K blackbody ratios
  softened because AgX saturates dark warm tones (target: a big-spot core around sRGB (40, 32, 28), the edge
  around (70, 56, 46)). Darker towards the core (`mix(0.4, 0.9, r/Ri)`), lighter in small spots (up to 1.3×);
  faint umbral dots (~0.3 Mm) once resolved. Some umbrae above 5.5 Mm radius are crossed by a granular, slightly
  curved light bridge. Granulation and the network are skipped where a spot covers the pixel fully.
- **Sub-pixel spots:** each spot's penumbra and umbra coverage is scaled by its area over the pixel's
  (`min(1, R² / aa²)`), as are the pores, so a distant Sun keeps its physical spot deficit (0.1-0.3%).
- **Pores:** irregular, 2-4 Mm across and darker than before (about 0.16 of the photosphere at the core), in
  cells of ~3.5 Mm in each region's own frame, with a density clustered at the two polarity centres (±0.5
  region radii along the Joy axis, the following one wider and denser) plus a few in the plage between them,
  scaled by strength. No pores outside a region.
- **Faculae:** patchy brightening over the region, visible near the limb only (`(1 − μ)^1.5`).

## Prominences and filaments

- **Quiescent prominences:** two staggered series of 4-10 (more near maximum) re-form every 24 days at
  latitudes 15-55°, 10-120 Mm tall, drifting with the differential rotation. Loop systems (up to 8) sit over
  big groups. They ride on the corona shell near the limb (`promField`): a hedgerow of fine vertical threads,
  or several irregular loop strands (own footpoints, heights and lean, wiggling, thickness and brightness
  varying along the arch, brighter legs, faint coronal rain). An anchor behind the limb hides the base.
- **Hedgerow:** three thread octaves (each faded out once a pixel spans one), a ragged top, tapered ends,
  tall dark gaps between thread bundles, a few bubbles low in the sheet, and legs (barbs) down to the
  chromosphere with arches between them.
- **In totality** they are pink-red (`colour` (1, 0.1, 0.24): H-alpha with H-beta and Ca II, little green;
  5e-6 of the disk per unit field behind a soft knee `1.6 (1 − exp(−f / 1.6))`, a few times the inner corona,
  so they never clip into a white bead or bloom onto the Moon) and invisible next to the uneclipsed white-light
  disk (pre-exposed). At Luxor in 2027 the Moon covers ~55 Mm above the limb, so only the tallest show, as small
  pink tongues at the Moon's edge.
- **Filaments:** the quiescent prominences seen against the disk (`filaments()`): long sinuous fuzzy ribbons
  (half-length max(1.4 W, 2.2 H), ≤ 0.45 R; 5-10 Mm wide with soft edges), ragged width, patchy darkness and gaps
  along their length, barbs to one side, orientation within ±40° of east-west (`filamentAngle`, mirrored in
  GLSL). Active regions add a thin filament along the polarity inversion line (absent while flaring). Filaments
  are drawn in H-alpha only.

## H-alpha filter (setting `sun.filter`: Off / H-alpha, Settings > Sky)

- A look, not physical exposure: the disk is the filter colour (deep red-orange) with mild limb darkening
  `0.6 + 0.4 μ`, its mean luminance `0.28 ×` the white-light mean so the red channel does not clip into orange
  under AgX. On top, a mottled chromosphere (total rms about 10%): dark mottles clumped along the supergranule
  borders, fibril rosettes radiating from the cell centres across the borders (cross-faded between the two
  nearest cells), sparse bright network points and low-contrast cell interiors; then filaments, plage (bright
  patches over each region), flare ribbons, pores, and spots with a dark umbra (0.35) and a moderately dark
  penumbra (0.7), both darkened further by superpenumbral fibrils that start inside the penumbra and radiate
  and curl (opposite twist in the two hemispheres) out to 2.6 penumbra radii, fading into the plage. The mottles and fibrils evolve slowly and exactly periodically over a sim day
  (no jump when `starTime` wraps). The white-light corona is hidden and prominences are lit relative to the
  H-alpha disk.
- Arriving at `sun-halpha-prominences` (URL, palette, tour) switches it on; it can then be switched off in
  Settings without being forced back on. Because the filter changes the physics (no corona, H-alpha-lit
  prominences), a filter switched on by arrival goes back off when the camera leaves the Sun (beyond 10 R☉) or
  arrives at another bookmark, unless the user changed it in the meantime. `?sun.filter=off|halpha` overrides
  it at boot and is never undone.

## Info card

The solar-system provider answers `sun`; the sun module wraps that provider in place (keeping the provider
order; a guarded temporary shim, see `docs/requests/sun.md` for the registry hook it waits for) and appends: the simulated-cycle sunspot number, the number of simulated groups, "Sunspots,
prominences, filaments: simulated (not real positions)" (all marked approximate) and the filter state, plus a
note in the description (`info.ts`).

## Bookmarks

- `sun-closeup`: 1.03 R☉ from the centre (21,000 km up), looking 50° off nadir, EV 32. Granules span 5-15 px
  at potato, and the limb with black space sits along the top. Unchanged by the activity work (pixel-identical).
- `sun-sunspots`: 2024-10-10 12:00 UTC, straight down on the biggest simulated group, centred between its
  leading and following spots with the group axis horizontal and north up; the altitude (90-160 Mm) frames
  the whole group. EV 31.7.
- `sun-halpha-prominences`: 2024-10-19 12:00 UTC (picked offline as the richest view near the 2024 maximum),
  filter on. From 3.2 R with fovY 14°, a ≥ 40 Mm hedgerow sits exactly on the limb at the centre and the disk
  fills the lower half. At init `pickHalphaView` chooses the prominence and camera side whose frame shows the
  most active regions and filament length on the disk.

## Performance

Spots are found in two passes: a cheap loop over all packed spots collects the (at most 8) whose reach covers
the pixel, and only those are shaded, so the costly body (outline, umbra, umbral dots, light bridge) runs as
often as the most crowded pixel of a SIMD group needs rather than once per packed spot (software rasterisers and
divergent GPU warps execute masked bodies). The penumbral filaments are shaded once per pixel after that loop,
for the nearest penumbra only, and only between its deepest grains and longest fingers; filament levels stop
once they are under a pixel. SwiftShader runs untaken `if` blocks too, so the costly optional parts (filaments,
light bridge, umbral dots, outline noise beyond 1.5 penumbra radii, one-sided sectors) are guarded by loop trip
counts instead, which it does skip. Pores (9 cells) and plage only run inside a region's disc; the prominence
loop culls by angle on the sky plane before its `atan`. Granulation and the network (two 27-cell Worley fields)
are skipped where a spot covers the pixel fully. Relative cost under SwiftShader at 960×540 medium (ms per
frame): `sun-closeup` 1430 → 1020, `sun-sunspots` 1600 → 930 (the constant-width filaments: ~925 vs ~912 before,
within the run-to-run noise), `sun-halpha-prominences` 1340 → 1400, `eclipse-2027-luxor` 530 → 545. The 60 fps
medium-preset target for Sun close-ups has not been measured on the target GPU (`docs/requests/sun.md`). On the
CPU the activity is recomputed at most once per sim minute and not at all for a Sun under 2 px.

## Cut or not built

No occlusion-tested lens flare, no Wilson depression, no magnetic polarity colours, no real (observed) spot
positions. The
`logg` parameter of DESIGN's `starSurface` is not taken: the radius stands in for g.
