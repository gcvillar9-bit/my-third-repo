# Comets

Famous comets as real objects: `src/modules/comets/`. Depends on `solar-system` (the `sun` and `earth` frames).
Cross-module API: `src/modules/comets/public.ts`. Data: `public/data/comets/comets.json` (17 KB, built by
`tools/build-comets.mjs`, fetched at init).

## Data

Ten comets: `halley`, `encke`, `pons-brooks`, `67p`, `swift-tuttle`, `hale-bopp`, `hyakutake`, `mcnaught`,
`neowise`, `tsuchinshan-atlas` (these are the frame, body and search ids).

| What                                            | Source                                                                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orbits, radius, albedo, rotation period, mass   | Celestia `comets.ssc` (GPL-2.0-or-later; JPL SBDB / Horizons osculating elements near each apparition)                                                                      |
| Hale-Bopp's orbit                               | Stellarium `ssystem_minor.ini` (GPL-2.0-or-later): the 1997 elements. Celestia ships the 2022 orbit, whose two-body perihelion is 2.5 days early and 0.02 AU too close      |
| 12P/Pons-Brooks (not in Celestia)               | hand-entered row in `catalog.json` (JPL SBDB 2024 apparition, rounded), `approximate`                                                                                       |
| Tsuchinshan-ATLAS perihelion time               | hand-entered override (2024-09-27.74 TT): the mean anomaly of the Celestia row puts the passage 9.5 days early. The elements block becomes `approximate`                    |
| Brightness law H, K per comet                   | hand-entered in `catalog.json`, fitted to widely reported visual peak magnitudes, `approximate`                                                                             |
| Nucleus shapes, tail weights, display constants | hand-entered in `catalog.json` (Halley: Giotto, 67P: Rosetta, others generic), `approximate`; the weights are appearance parameters of a procedural model, not measurements |

`src/modules/comets/catalog.json` is the only hand-edited file. Every block in it carries a `source` and
`approximate: true`, which the build tool and a unit test enforce. The build tool converts Celestia's (a, e, M at
epoch, period) into perihelion-based elements: `q` (AU), `e`, `i`, `node`, `argPeri` (degrees, ecliptic J2000), `tp`
(JD TT of the perihelion nearest the epoch), `epoch`, `periodDays`, and `center` (`sun`, or `ssb` for the inbound
barycentric solutions of McNaught and Tsuchinshan-ATLAS).

## Orbit model and its limits (`orbit.ts`)

- Two-body motion, solved in universal variables measured from perihelion: `√μ·Δt = e·χ³·S(z) + q·χ`, `z = αχ²`,
  `α = (1 − e)/q`, with the Stumpff functions C and S. One formula covers ellipses, parabolas and hyperbolas and has
  no cancellation as e approaches 1 (five rows have e > 0.999). The left side is increasing and convex over half a
  revolution, so Newton's iteration from an upper bound converges monotonically; the unit tests reach rounding error
  for e from 0 to 3.
- GM comes from each row's own period and semi-major axis, so the catalogued period is reproduced exactly. Periodic
  comets wrap to within half a period of perihelion.
- Each comet is a frame (parent `sun`, or `ssb` for barycentric rows; influence radius 2 million km, so coma-scale
  views travel with the comet) and a `Body` of kind `comet` (radius = longest semi-axis of the nucleus,
  `simulated: true` because the appearance is procedural). `positionAt` is a pure function of the date.
- Limits: one set of osculating elements per comet. Planetary perturbations and outgassing are not modelled, so a
  position is good near the element epoch (the famous apparition) and degrades away from it; Halley's 2061 return
  comes out about seven months late (February 2062 instead of July 2061). The validity range `comets.orbits` (earliest epoch − 15 yr to latest + 15 yr, beyond:
  `approximate`) drives the time-bar badge, and the info card flags live distances as approximate more than 15 years
  from a comet's epoch.

## Brightness and rendering

One number drives everything: the coma's luminous intensity `I` (cd) from `m = H + 5 log Δ + K log r`, faded to
zero between 3.5 and 5 AU from the Sun. All shaders output cd/m² × `uExposure`, include the log-depth chunk, and are
additive without depth writes (the nucleus is opaque).

- **Photometric point** (`glsl/point.glsl`): the unresolved head, illuminance `I/Δ²` plus the bare nucleus
  (`planetPointIlluminance`), with the same Gaussian PSF as the planets. It crossfades with the coma volume while
  the coma grows from 1 to 3 pixels, so the total light is continuous.
- **Coma** (`glsl/coma.glsl`): the back faces of a sphere of three coma radii. Each fragment integrates a steady
  outflow (density ∝ 1/ρ²) along its ray in closed form, `(π/2 + atan(t₀/b))/b`, which is π/b from outside and
  stays valid with the camera inside the coma. An exponential cut-off at the coma radius normalises the column to
  `I`; the 1/b rise levels off at 1.3 nucleus radii; the sunward side is up to twice as bright as the far side. The
  coma radius is 100,000 km for an H = 5 comet at 1 AU, scaling as r^0.8 and 10^(−0.08 (H − 5)). Colour mixes
  sunlit dust with green gas emission by the row's `gas` weight.
- **Ion tail** (`model.ts` `ionTail`, `glsl/tail.glsl`): one camera-facing ribbon exactly along the Sun-comet line,
  blue, with three wandering rays and knots. Length 0.35 AU × 10^(−0.06 (H − 5)) / r, at most 1.2 AU: 74 million km
  for Halley at 0.82 AU.
- **Dust tail** (`dustTail`): syndynes. Grains of seven radiation-pressure ratios β from 0.03 to 1.4 are released
  from the nucleus over the past 45 days (fewer for light grains, which reach the length limit sooner) and
  integrated (RK4) under solar gravity reduced by 1 − β. Each β gives a curve that leaves the nucleus anti-sunward
  and bends back along the orbit, in the orbital plane. Their light is split between a thin ribbon along each curve
  and a sheet between neighbouring curves (`glsl/sheet.glsl`, brightened by 1/cos when seen at a slant), so the fan
  is smooth, keeps faint striae, has soft edges and does not vanish edge-on. The curves are recomputed only when the
  date moves by 0.02 days.
- **Tail brightness** is an empirical surface-brightness law on that geometry, not a dust-production calculation:
  the reference level is `I` spread over the comet's 1 AU coma disk, times the row's `dust` or `ion` weight and
  `display.tailGain` (4), falling as `(1 + s/R_coma)^−0.5` along the tail (ion: −0.65), with more light where the
  grains were released closer to the Sun. The gain is chosen so that great comets read at the app's night exposure
  (EV −5) about as the Milky Way panorama does, which the app also shows several times brighter than the real sky.
  The head's magnitude is physical; the integrated light of the tails is therefore overstated.
- **Nucleus** (`nucleus.ts`, `glsl/nucleus.glsl`): an icosphere (642 vertices on potato and low, 2,562 above) shaped
  by one or two ellipsoidal lobes (67P has two) and value noise, scaled so the body radius is its longest extent
  (the collision sphere encloses it). Lommel-Seeliger shading with the catalogued albedo, a noise bump, and a slow
  spin with the catalogued period about a made-up axis. No self-shadowing.
- **Orbit lines** (`orbits.ts`): one `LineSegments` for all comets in the planets' style, shown only for comets that
  are active or targeted, hidden close to any body, and following the app-wide `solar-system.orbits` switch
  (missing counts as on). Near-parabolic orbits are drawn out to 45 AU.
- Cost: nothing is built for a dormant comet. An active comet in view adds 5 draw calls (coma, ion ribbon, dust
  ribbons, dust sheet, plus the nucleus when it spans a pixel) and about 1,000 triangles; the points and orbit lines
  are one call each. GPU memory is about 150 KB per active comet.

## UI hooks

- Setting `comets.enabled` (Sky, boolean, default on).
- Search entries for every comet with names, designations and aliases ("Halley", "1P", "Great Comet of 1997"...).
- Info card: designation, period, perihelion distance, eccentricity, inclination, last and next perihelion, live
  distances from the Sun and Earth, estimated magnitude from Earth, model coma and tail sizes, nucleus size,
  rotation and albedo; estimates and extrapolations are marked approximate.
- Label source: a comet is labelled while it is active and either brighter than magnitude 9 from the camera or
  within 3 AU (the automatic body labels stop at 3000 radii).

## Bookmarks

| Id                 | View                                                                                                            | EV   |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ---- |
| `halley-1986`      | Halley on 1986-03-08 from 0.42 AU above its orbital plane: both tails to the upper right, Sun out of frame left | −6   |
| `hale-bopp-1997`   | Hale-Bopp on 1997-04-05 from 0.8 AU, from the other side of its orbital plane                                   | −4.5 |
| `halley-nucleus`   | Halley's nucleus from 25 km at the Giotto flyby (1986-03-14 00:03 UTC), sunlit from the right, inside the coma  | 12.8 |
| `neowise-2020-sky` | NEOWISE on 2020-07-14 from 60,000 km out from Earth, tails up, among the stars                                  | −5.5 |

## Tests

- Unit `tests/unit/comets/comets.test.ts` (22 tests, GPU-free): Stumpff functions; solver convergence for e from 0 to
  3; agreement with the eccentric-anomaly solution; energy and angular momentum on every catalogued orbit; an unbound
  orbit; Halley's perihelion on 1986-02-09 at 0.587 AU and nine other perihelia; Hyakutake's 1996 close approach;
  activity monotonic and zero beyond 5 AU; peak magnitudes; the ion tail on the Sun-comet line; grain integration;
  the dust tail in the orbital plane, behind the comet and separated from the ion tail; nucleus mesh; info cards;
  search aliases; bookmarks with the Sun out of frame; sources on every data block.
- E2E `tests/e2e/comets.spec.ts` (4 bookmarks, `halley-1986` is `@smoke`): head position from the comet's label,
  bright head, tails on the anti-sunward side only, ion tail bluer than the dust tail, nucleus day side against its
  night side, no errors, draw-call and triangle budgets.
