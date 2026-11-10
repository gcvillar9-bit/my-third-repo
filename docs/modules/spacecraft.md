# Spacecraft

Real craft you can search for and fly to: `src/modules/spacecraft/`. Depends on `solar-system` (the `earth`
and `sun` frames). Data: `public/data/spacecraft/craft.json` (hand-entered, 14 KB, fetched at init, not on the
boot path). The models, shaders and renderables are a separate chunk loaded after boot.

| Id            | Craft                       | Kind    | Parent frame | Position model                                  |
| ------------- | --------------------------- | ------- | ------------ | ----------------------------------------------- |
| `iss`         | International Space Station | `leo`   | `earth`      | circle + J2, CelesTrak element set (2026-11-09) |
| `hubble`      | Hubble Space Telescope      | `leo`   | `earth`      | circle + J2, CelesTrak element set (2026-11-09) |
| `jwst`        | James Webb Space Telescope  | `l2`    | `ssb`        | astronomy-engine L2 + fitted halo ellipse       |
| `voyager1`    | Voyager 1                   | `probe` | `ssb`        | Lambert arcs, then a JPL Horizons conic         |
| `voyager2`    | Voyager 2                   | `probe` | `ssb`        | Lambert arcs, then a JPL Horizons conic         |
| `newhorizons` | New Horizons                | `probe` | `ssb`        | Lambert arcs, then a JPL Horizons conic         |
| `pioneer10`   | Pioneer 10                  | `probe` | `ssb`        | Lambert arc, then a JPL Horizons conic          |
| `pioneer11`   | Pioneer 11                  | `probe` | `ssb`        | Lambert arcs, then a JPL Horizons conic         |

## Data and sources

Every row and every position block of `craft.json` has a `source`; `approximate` flags reach the info card.

- **Probe coast states:** JPL Horizons (API, vector table, geometric, heliocentric ICRF, km and km/s) at
  2026-Jan-01 00:00 TDB for objects -31, -32, -98, -23 and -24, copied on 2026-11-10. The Pioneer
  trajectories are themselves extrapolations (no tracking since 2003 and 1995).
- **Encounters:** launch and closest-approach times and distances from the NSSDCA master catalogue and the
  JPL and APL mission timelines (rounded). One waypoint for Pioneer 11 (Horizons, 1977-Jan-01), see below.
- **ISS and Hubble:** one CelesTrak GP element set each (NORAD 25544 and 20580, epoch 2026 day 313).
- **Webb:** halo ellipse fitted for this project to 25 Horizons geocentric vectors of object -170 through 2026.
- **Facts** (operator, mass, size, dates): NASA, ESA, JPL and APL fact sheets, rounded; uncertain ones flagged.
- Check values in `tests/unit/spacecraft/horizons.ts` are other Horizons epochs of the same trajectories.
  They are not model inputs.

## Position models and their limits (`trajectory.ts`, `kepler.ts`)

All positions are pure functions of the TT Julian date. Sun and planet positions come from the app's frame
tree (astronomy-engine in the unit tests).

- **Probes.** Between two encounters the path is the heliocentric conic through both bodies' positions at the
  published times (a Lambert arc, universal variables); each node sits at the closest-approach distance over
  the body's ecliptic north pole, because the real flyby geometry is not modelled. After the last flyby the
  path is the conic through the Horizons state, propagated about the Solar System barycentre with the mass of
  the Sun and planets (far outside the planets that is the fixed focus). The mismatch at the last flyby
  (0.005 to 0.06 AU) is blended away over 400 days.
  - Against Horizons: within 0.03 AU on every leg and during the blend, within 0.003 AU on the coast ten
    years before the reference epoch.
  - Pioneer 11 flew from Jupiter to Saturn across the far side of the Sun (a 180° arc, where the Lambert plane
    is undefined), so that leg passes through one published waypoint.
  - Flagged **approximate**: from launch until 400 days after the last flyby, more than 100 years from the
    reference epoch, and always for the two silent Pioneers.
  - Not modelled: the true flyby hyperbolas, trajectory corrections, the pull of single planets on the coast.
- **ISS and Hubble.** A circle with the semi-major axis, inclination, node and argument of latitude of the
  element set, the node regressing and the argument of latitude advancing at the secular J2 rates (ISS: node
  -4.95° a day, nodal period 92.89 min, 419 km above the equatorial radius). No eccentricity, drag or reboosts:
  the plane stays right for months, the place along the orbit only for days, and the altitude is that of the
  epoch at every date (Hubble: 469 km in November 2026; it was about 540 km in 2020 and 610 km in 1990).
  Always flagged approximate.
- **Webb.** The L2 point of the Sun and the Earth-Moon barycentre from astronomy-engine `LagrangePoint`, plus
  an ellipse in the rotating frame (period 181.5 d). Residual against Horizons through 2026: 38,000 km RMS,
  57,000 km worst. The real orbit is steered every few weeks, so the phase drifts away from 2026. Between
  launch and arrival (2022-01-24) the craft follows a stand-in line from Earth. Always flagged approximate.
- **Existence.** A craft is registered (Body, anchoring, marker, label) only from its launch on. Before that
  its frame is parked at Earth with influence radius 0. All craft are hidden beyond J2000 + 10 kyr, where the
  planet ephemerides fold. Validity range `spacecraft.positions` (`beyond: 'hidden'`) shows this in the time bar.
  No end of mission is modelled: the ISS and Hubble keep flying after their re-entry dates.
- **Attitude** (`<id>.fixed` frames, illustrative): the ISS flies local-vertical (+x flight direction, +z
  nadir); Hubble turns its panels to the Sun and its aperture to the north ecliptic pole; Webb turns its hot
  side to the Sun and looks at the north ecliptic pole; the probes point their dish at Earth.

## Bodies and camera

Bodies are `kind: 'spacecraft'`, `simulated: true`, with a collision radius of about half the main structure
(ISS 55 m, Hubble 7 m, Webb 11 m, Voyager 4 m, Pioneer 3 m, New Horizons 2 m) and an influence radius of
10 km (ISS), 5 km (Hubble), 100 km (Webb) or 1000 km (probes): inside it the camera anchors to the craft's
inertial frame and rides along.

## Models and rendering (`models/`, `render.ts`, `glsl/`)

- Procedural low-poly models to scale, built in code from boxes, cylinders, dishes, sheets and lattice booms
  (`models/kit.ts`): ISS 2,532 triangles, Voyager 1,746, Pioneer 1,034, Hubble 792, New Horizons 686, Webb 544
  (440 KB of vertex data in all; the two Voyagers and the two Pioneers share geometry).
- The ISS has two parts: the hull, and the outboard truss with the eight array wings, which turns about the
  truss to face the Sun (alpha joints; the beta gimbals are not modelled).
- One shader (`craft.*.glsl`): Lambert sunlight in cd/m² times the shared exposure, a soft highlight on foil,
  Earth's shadow on the low-orbit craft (`shadows.glsl`), light reflected by Earth below (albedo 0.3), and a
  fill light of 8% of direct sunlight so faces turned from the Sun keep their shape. The fill is not physical.
  There are no cast shadows; the parts of Webb above its sunshield are flagged as always shaded.
- Models are drawn above 0.7 px. Below about 10 px a **marker** (teal ring with a dot, 9 to 15 px, display-
  referred, not light from the craft) shows where the craft is, with a label from the module's label source
  (the UI labels spacecraft bodies itself only within 3000 radii). Markers, labels and lines appear once the
  craft's surroundings span about 20 px: low orbits near Earth, Webb from within about 0.2 AU of Earth, the
  probes from anywhere inside the Solar System.
- **Trajectories** (one LineSegments draw, vertices in float64 relative to the camera each frame): the orbit
  rings of the ISS and Hubble, Webb's halo ellipse, and each probe's path from launch to where it is now. They
  follow the `solar-system.orbits` setting when it exists.
- Setting `spacecraft.enabled` (group Sky, default on, persisted) removes the craft entirely.

## Discovery

- Search entries with aliases (ISS, Zarya, HST, JWST, Webb, Voyager, NH…) flying to the body.
- Info cards: operator, launch, mass, size, a paragraph, and live facts for the clock's date (distance from
  the Sun and Earth, speed, one-way light time, flyby dates; altitude, period and inclination for the low
  orbits) with `approximate` flags and sources. Before launch the card says the craft is not shown.
- Bookmarks (each sets a 2026 date and an `ev`): `iss-over-earth`, `hubble-over-earth`, `jwst-l2`,
  `voyager1-looking-back`, `new-horizons`. A bookmark must not share an id with a body: `camera.goto`
  resolves bookmark ids first.

## Tests

- Unit `tests/unit/spacecraft/spacecraft.test.ts` (28 tests): data rows and sources; propagator and Lambert
  solver; probes against Horizons and against well-known facts (Voyager 1 one light-day from Earth in
  November 2026, the Pale Blue Dot distance, New Horizons at Pluto and Arrokoth, Pioneer asymptotes); ISS
  period, altitude, inclination and attitude; Webb's distance, direction and halo; nothing before launch;
  approximate flags; info cards; search aliases; bookmarks; model geometry (finite, to scale, winding
  consistent with normals).
- E2E `tests/e2e/spacecraft.spec.ts`: four bookmarks at 480x270 on potato with pixel probes, zero errors and
  draw budgets; the ISS test is `@smoke`.

## Not built

Element-set propagation (SGP4), altitude history and end of mission for the low orbits; station assembly
stages; Parker Solar Probe and other craft; cast shadows; articulated Hubble or Webb.
