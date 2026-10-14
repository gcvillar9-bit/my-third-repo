# Requests from P5-B showtime

No contract changes. For the integrator and other packages:

1. **docs/modules/ui.md (integrator):** keys changed in `src/ui`: `P` is now photo mode (photo module) and pause/play
   moved to `K` (`K` pauses the tour while one runs). New topbar buttons ▶ Tour and Photo; palette entries of kind
   `tour` start the tour; flying to a `LINE_BOOKMARKS` bookmark (palette, labels, info card, tours) switches the
   constellation lines on. `src/ui/actions.ts` exposes `uiActions.openHelp()` for the onboarding card.
2. **milkyway (bookmark):** the panorama is now 8x brighter (`MILKY_WAY_LUMINANCE` 3e-3 → 2.4e-2). As the P4-A
   request suggested, `mw-band-from-earth` could move its fixed EV from -8.5 to about -6: at -8.5 the band is now
   overexposed and the 8-bit panorama's compression blocks show in the e2e screenshot (tests still pass).
3. **galaxies / cosmic web (P5-A):** Cosmic Zoom flies to `m31-approach`, `virgo-cluster` and `cosmic-web-500mpc`
   (the DESIGN ids) and skips any that are not registered when the tour starts. Keep those ids, or tell the
   integrator to update `src/modules/tours/cosmic-zoom.ts`.
4. **boot (integrator, optional):** `startOnboarding(ui, env)` is unchanged; it now shows a dismissible hint card
   once per browser instead of a toast.

**Resolved by R5 (final integration):** 1 docs/modules/ui.md updated (keys, topbar, photo rule, actions.ts);
2 `mw-band-from-earth` moved to EV -6 (e2e band 0.056, >10x the off-band sky); 3 P5-A kept the DESIGN ids and a new
e2e test plays the whole tour through m31-approach, virgo-cluster and cosmic-web-500mpc back to earth-now; 4 no
boot change needed.
