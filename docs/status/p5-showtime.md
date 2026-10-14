# P5-B showtime: status

**Done**

- tours: deterministic `TourPlayer` (compiled timeline; missing goto targets skipped with their stop), Cosmic Zoom
  (11 stops, ~3 min, factual captions), overlay (progress, Pause/Next/Exit, Esc), palette "Tour: Cosmic Zoom",
  ▶ Tour button, `?tour=<id>`, `?tourspeed=<k>`.
- photo: `P` / Photo button, UI hidden via `html[data-photo]`, FOV 5-120°, exposure ±, Save PNG with credits line.
- onboarding: first-visit hint card (localStorage flag, try/catch, never in test mode or with `?ui=0`).
- stars: `MILKY_WAY_LUMINANCE` 3e-3 → 2.4e-2 (8x); stars and milkyway e2e still pass.
- starsystems/ui: `LINE_BOOKMARKS` moved to starsystems `public.ts`; palette/labels/tours flights to those
  bookmarks switch the constellation lines on.
- README final; docs/modules/{tours,photo}.md.
- Tests: unit tours (schedule determinism, missing stops), photo state, onboarding flag, UI hooks; e2e
  tours.spec.ts and photo.spec.ts (@smoke). `pnpm verify` green; ui, starsystems, input, smoke, integration,
  milkyway and stars e2e green.

**Gaps**

- docs/modules/ui.md not updated (integrator-owned): P is photo, pause moved to K (see requests).
- Galaxy stops (m31-approach, virgo-cluster, cosmic-web-500mpc) are untested end to end until P5-A merges; the
  player skips them when absent (unit-tested).
- `mw-band-from-earth` fixed EV -8.5 now overexposes the brighter band (milkyway-owned bookmark).

**Requests:** docs/requests/p5-showtime.md.
