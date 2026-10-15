# Requests from the nebulae module (Orion Nebula)

No contract changes. Each item below is shimmed inside `src/modules/nebulae/` or noted as a follow-up.

1. **Surface-brightness helpers in core.** `src/modules/nebulae/photometry.ts` has `luminanceFromMu` and
   `muFromLuminance` (mag/arcsec² ↔ cd/m², 16.5 mag/arcsec² = 0.027 cd/m²). They belong next to
   `illuminanceFromMag` in `src/core/photometry.ts`; the nebulae module would import them from there.
2. **HYG search for θ¹ Ori C (and A, D).** HYG has θ¹ Ori A, C and D at its 100 kpc no-parallax placeholder, θ² Ori A
   at 474 pc and NU Ori at 444 pc. The nebulae module promotes them at 400 pc and hides the HYG points, but the stars
   module's search entries and info cards for `hip:26220`, `hip:26221`, `hip:26224` and `hip:26235` still use the HYG
   distances (θ¹ Ori C: "distance unknown", flying to it looks at it from the Sun). Suggested: let the stars search and
   info provider defer to a promoted star with the same HYG index (or add a distance override row for these HIP ids
   in `tools/build-stars.mjs`).
3. **The panorama at telescope magnification (done in follow-up 4, integrator-approved stars change).** The stars
   panorama is now stored sRGB-encoded at WebP q90 (no flat chroma blocks), mipmapped and B-spline filtered when
   magnified, and `stars/public.ts` exports `setPanoramaHole()`, which the nebulae module uses to cut the panorama's
   own blurred M42 out (1.0°/1.4°, a harmonic membrane through a 1.6° ring) so it is not counted twice. Left open:
   the panorama's 8x display boost (P5-B) puts the sky around Orion at ~20.4 mag/arcsec², brighter than M42's
   calibrated wings.
4. **Optional `CustomStar` fields (landed in the grant).** `src/modules/starsystems/promotion.ts`: `hygIndex` (the HYG
   duplicate is hidden while promoted and `groupForIndex` maps it to the custom group), `bv` (sprite colour, default
   the HYG value) and `labelPriority` (default 45; the session-long Trapezium promotion uses 17-19 so the bright named
   stars keep their labels from Earth), `ownInfo` (no generic 'Star (promoted)' card; follow-up 4).
   `src/modules/stars/points.ts` `HIDE_MAX` 4 → 8 → 16 (follow-up 4: as many as starsystems' sprites, so the
   session-held nebula duplicates are never un-hidden); `stars.vert.glsl` takes the array size from a `HIDE_MAX`
   define.
5. **Extinction of promoted stars (open).** The Trapezium keeps absMag = V − 8.01 (line-of-sight extinction baked in)
   with intrinsic Teff and radius: an optional `CustomStar` extinction callback evaluated in `Promoter.update`
   (dimming the sprite only while the camera is in front of the Veil) would let the stars use their intrinsic
   absMag, match the sphere close up and shine de-reddened inside the nebula.
6. **Perf budget for a Sun close-up** (from `docs/requests/sun.md`): added as `sun-sunspots` in
   `tests/e2e/perf-volumes.spec.ts` (29 calls, 36k triangles; the photosphere has no march, so the fragment-step
   budget does not see its procedural shading cost; a manual fps check on the M4 Pro is still needed).
