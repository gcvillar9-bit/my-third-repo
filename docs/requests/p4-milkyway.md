# Requests from P4-A milkyway

No contract changes. Requests for other packages and the integrator:

1. **stars: panorama brightness (the owner's "band is faint").** At `mw-band-from-earth` the panorama band towards
   (l, b) = (8, -2) deg measures about 1.0e-4 cd/m² (~22.3 mag/arcsec²). The Sagittarius star clouds are
   19.5-20.5 mag/arcsec² (1-2e-3 cd/m²), and the GalaxyModel gives 7e-4 at (5, -5). Removing the point stars seems
   to have taken most of the unresolved band light. Suggest raising `MILKY_WAY_LUMINANCE` by about 3 stops (x8),
   or calibrating it per texel against the model (`sunSkyLuminance` from `milkyway/public.ts`). This would make the
   band visible at the night auto-exposure (EV_NIGHT -5) and make the 200-400 pc crossfade with the GalaxyModel sky
   cube continuous (today the sky gets ~7x brighter as you fly out). The bookmark's EV could then go from -8.5 back
   to about -6.
2. **stars/public.ts: export the panorama fade.** Export `milkyWayFade`, `FADE_START` and `FADE_END`, or a
   `panoramaWeight(distFromSun)`, plus a gain setter if the integrator wants one. Today milkyway copies
   200/400 pc into `galaxy.ts` (`PANORAMA_FADE_START/END`) to crossfade.
3. **stars: unknown-distance stars from outside.** HYG stars with the 100 kpc distance placeholder show up as a
   speckle shell around the Galaxy in `mw-outside-100kpc`. Suggest hiding `FLAG_DIST_UNKNOWN` stars once the camera
   is more than ~1 kpc from the Sun.
4. **smallbodies (note):** the boosted asteroid-belt points run along the ecliptic through Sagittarius in every view
   from the inner solar system. `mw-band-from-earth` sits 0.2 pc out for that reason.
5. **render (note):** `RenderApi.captureCube` is not needed by milkyway. The sky cube is baked by its own march
   shader, one face per frame.
