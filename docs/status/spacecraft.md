# Spacecraft status (branch `p-spacecraft`; docs: `docs/modules/spacecraft.md`)

## Done

- Eight craft as frames and bodies of kind `spacecraft`: `iss`, `hubble`, `jwst`, `voyager1`, `voyager2`,
  `newhorizons`, `pioneer10`, `pioneer11` (each with `<id>.fixed` for its attitude).
- Positions: probes on Lambert arcs between encounters and a JPL Horizons conic afterwards (within 0.03 AU of
  Horizons at 19 check epochs, 0.003 AU on the coast); ISS and Hubble on J2 circles from CelesTrak element
  sets; Webb on a halo fitted to Horizons (57,000 km worst in 2026). Nothing exists before its launch.
- Procedural low-poly models to scale (7,334 triangles in all), one sun-lit shader with Earth's shadow and
  Earth-shine, ISS arrays that track the Sun, finder markers, far labels, orbit rings, halo and probe paths.
- Info cards with live facts, approximate flags and sources; search aliases; setting `spacecraft.enabled`;
  validity range `spacecraft.positions`; bookmarks `iss-over-earth`, `hubble-over-earth`, `jwst-l2`,
  `voyager1-looking-back`, `new-horizons`.
- 28 unit tests, 4 e2e tests (ISS is `@smoke`); `pnpm verify` green.

## Gaps

- Low orbits: no SGP4, drag or reboosts (place along the orbit right only for days around 2026-11-09, the
  epoch's altitude at every date); no end of mission; the ISS is shown complete at every date.
- Flybys are heliocentric arcs through a point over the planet's pole; attitudes are illustrative.
- No cast shadows; the 8% fill light is not physical. `voyager1-looking-back` shows the craft's shadowed
  side, and at its exposure the app's Sun glow is a wide glare.
- `spacecraft.enabled` has no test (settings storage is off in test mode). No Parker Solar Probe.

## Requests

See `docs/requests/spacecraft.md`: walk mode should skip spacecraft; bookmark ids shadow body ids in
`camera.goto` (hence `hubble-over-earth`); an optional per-body label range.
