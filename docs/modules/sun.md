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

## Bookmarks

- `sun-closeup`: 1.03 R☉ from the centre (21,000 km up), looking 50° off nadir, EV 32. Granules span 5-15 px
  at potato, and the limb with black space sits along the top.

## Cut or not built (lean Phase 3)

There are no prominences, sunspots or solar-cycle phase, and no occlusion-tested lens flare. The `logg`
parameter of DESIGN's `starSurface` is not taken: the radius stands in for g.
