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
3. **The panorama at telescope magnification.** Near the Sun the stars panorama (8k Solar System Scope texture) holds
   a blurred M42 of its own: the nebula adds to it (the design keeps the nebula's opacity at 0 there, since the photo
   already contains M42's dust), so the Huygens region is counted twice and the 2.5° view in `m42-telescope` shows a
   bright, blocky bluish glow (μ ≈ 20 mag/arcsec²) that hides M42's faint wings. Suggested: fade the panorama with
   magnification (or blur it to its true resolution), or let a module cut a soft mask out of it (an optional
   `skyMask` hook in `stars/public.ts`), so the nebula can replace the panorama's M42.
4. **Optional `CustomStar` fields (landed in the grant).** `src/modules/starsystems/promotion.ts`: `hygIndex` (the HYG
   duplicate is hidden while promoted and `groupForIndex` maps it to the custom group), `bv` (sprite colour, default
   the HYG value) and `labelPriority` (default 45; the session-long Trapezium promotion uses 17-19 so the bright named
   stars keep their labels from Earth). `src/modules/stars/points.ts` `HIDE_MAX` 4 → 8; `stars.vert.glsl` takes the
   array size from a `HIDE_MAX` define (needed for the larger array).
5. **Perf budget for a Sun close-up** (from `docs/requests/sun.md`): added as `sun-sunspots` in
   `tests/e2e/perf-volumes.spec.ts` (29 calls, 36k triangles; the photosphere has no march, so the fragment-step
   budget does not see its procedural shading cost; a manual fps check on the M4 Pro is still needed).
