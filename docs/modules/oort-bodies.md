# Oort Cloud: bodies part

Real objects on the Oort Cloud's scale, the tracks of two passing stars and labelled distance shells:
`src/modules/oort/bodies/`, started by `initBodies(ctx, shared)` from `src/modules/oort/index.ts`. The cloud of
simulated comets is the other part (`src/modules/oort/cloud/`, not described here). Both read the per-frame
`OortShared` state (`src/modules/oort/shared.ts`).

## Data (hand-entered, bundled with the code, every value with a `source`)

| File           | Rows                                                                                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `objects.json` | Sednoids `sedna`, `2012-vp113`, `leleakuhonua`, `ammonite` (kind `dwarf`); `bernardinelli-bernstein` (kind `comet`, inbound barycentric orbit, aphelion 40,400 AU); interstellar `oumuamua`, `borisov`, `3i-atlas` (hyperbolic, with `vInfKms`). Elements in the shape of the comets module's `CometElements`. |
| `flybys.json`  | `gliese-710` and `scholz-star`: Gaia-era astrometry (position, parallax, proper motion, radial velocity) and published closest approaches; `trackHalfLengthAu` 250,000.                                                                                                                                        |
| `markers.json` | Six shells: heliopause 120 AU, solar gravity lens 550 AU, 1,000 AU, 10,000 AU, one light-year, 100,000 AU; Voyager facts.                                                                                                                                                                                      |

No value was changed from the integrator's tables. Ammonite's node and argument of perihelion are flagged unverified
in their source text.

## Model

- **Objects** (`objects.ts`): a `CometOrbit` per row (comets' `public.ts`), a frame with the row id (parent `sun`, or
  `ssb` for Bernardinelli-Bernstein) and a `Body` (`simulated: true`, influence radius 200 radii clamped to
  [1e6, 2e8] m). `objectState` propagates every orbit, bound or unbound, with `CometOrbit` (accurate millions of
  years from perihelion, as the flyby bookmarks need). Validity range `oort.objects`: element epochs ± 200 years,
  `beyond: 'approximate'`.
- **Passing stars** (`flybys.ts`): ICRS position and velocity from the astrometry
  (v_t = 4.74 μ d), straight-line motion `r(t) = r0 + v (t − t0)`, closest approach at `t* = −r0·v/|v|²`. Results:
  Gliese 710 at about 10,600 AU in 1.29 Myr, Scholz's Star at about 66,000 AU about 80,000 years ago. A frame
  `flyby:<id>` per star (parent `ssb`, influence radius 0) and no `Body` (the star catalogue has the stars).

## Drawing (lazy `import()` behind `assets.track`, four renderables)

- `oort.bodies.points` (transparent, one `Points`): each object as a photometric point,
  `E = E_sun(r) · p · πR² · Φ_Lambert(α) / (π Δ²)` tinted by `physical.tint`, physical (Sedna from Earth is about
  magnitude 21, so the points are invisible from afar, as in reality); crossfades with the sphere between 1 and 3 px.
  The same draw holds the two passing stars within 300,000 AU of the Sun: illuminance from `absMagV` and distance,
  blackbody colour of `teffK`, and an **artificial visibility floor**: the PSF peak is held at a display value of at
  least 0.12, so Scholz's Star (magnitude 11-12 at its closest) still shows as a faint dot.
- `oort.bodies.sphere` (opaque, created on first need): one sphere moved to the nearest resolved object. Lambert
  lighting with reflectance 1.5 p (so the full disc gives the point's flux), `E_sun(r)`, the row's tint, a gentle
  `NOISE_GLSL` albedo pattern, and `FACET_GLSL` to put fragments and depth on the true sphere.
- `oort.orbits` (transparent, `orbits.ts`): one line per object in the comets' style (display-referred colour,
  per-vertex alpha, camera-relative float64 vertices). Ellipses are sampled with three sets (uniform true anomaly,
  its mirror about the minor axis, uniform eccentric anomaly) so both the 11 AU perihelion and the 40,400 AU
  aphelion of Bernardinelli-Bernstein are smooth; hyperbolas uniform in F out to 150,000 AU per branch. Colours:
  sednoids red-orange, the Oort comet pale cyan, visitors violet. Hidden when small on screen, close to any body and
  edge-on; a gap of a few pixels around the object.
- `oort.markers` (transparent, one `LineSegments`): each shell as three great circles (ecliptic and the planes
  x = 0 and y = 0 of ecliptic axes) and each star's track within 250,000 AU of its closest point, with a radial tick
  there. A circle whose plane holds the camera fades out (it would be a line through the view).

## Fade rule (nothing new in inner Solar System views)

- Shells, tracks, star points, their labels and the orbit lines of unselected objects are multiplied by
  `shared.lineFade` (0 within 200 AU of the Sun and beyond 260,000 AU). Tracks and stars also follow the app-wide
  orbit-lines switch, shells the `oort.markers` setting.
- Shell alpha = `lineFade · markers · smoothstep(0.008, 0.03, R/d) · smoothstep(0.02, 0.2, d/R)`.
- Orbit alpha = `max(emphasis, lineFade) · orbitLines`; the selected or targeted object's line shows everywhere.
- The objects themselves are always drawn. The registry labels bodies of kind `dwarf` from any distance, so the
  four sednoid names appear in inner views as Pluto's does.

## UI

- Info cards: objects (designation, group, discovery, q, a and aphelion or e and v∞, period, inclination, perihelion
  date, size, albedo with sources; live distance from the Sun and Earth and speed), stars `gliese-710` and
  `scholz-star` (spectral type, distance today, this model's closest approach marked approximate, each published
  value with its source, live distance), shells `oort-shell:<id>` (opened by clicking a shell label).
- Search: the eight objects with aliases and subtitles ('Sednoid · inner Oort Cloud object', 'Oort Cloud comet',
  'Interstellar visitor'); the two stars, targeting their flyby bookmarks.
- Labels (only while `lineFade > 0`): object names the registry does not show at that distance, shell labels in
  their colours at spread ecliptic longitudes (alpha above 0.3), 'Voyager 1 · 171 AU' with live distance, and each
  star at its closest point ('Gliese 710 · closest in 1.29 million years', 'Scholz's Star · passed 80,000 years
  ago', relative to the simulation time).

## Bookmarks

| Id                              | View                                                                           | EV  |
| ------------------------------- | ------------------------------------------------------------------------------ | --- |
| `sednoid-orbits`                | 2,500 AU above the ecliptic, the four sednoid orbits and the inner shells      | −2  |
| `gliese-710-flyby`              | 40,000 AU out at the computed closest approach, star, track and 10,000 AU ring | −2  |
| `scholz-star-flyby`             | 185,000 AU out 80,000 years ago, track between the light-year and 100,000 AU   | −2  |
| `interstellar-visitors`         | 650 AU above the ecliptic, three hyperbolas, heliopause and 550 AU rings       | −2  |
| `bernardinelli-bernstein-orbit` | face-on view of the whole 40,400 AU ellipse                                    | −2  |
| `sedna`                         | Sedna from 1,100 km, gibbous, sunlit at about 84 AU                            | 3   |

## Tests

- Unit `tests/unit/oort/bodies.test.ts`: sources and orbits for every row; Sedna's aphelion and perihelion; the
  Bernardinelli-Bernstein aphelion; v∞ of the visitors; unbound states through `CometOrbit` a million
  years out; orbit sampling (closed, through q and Q, turning under 0.2 rad per sample); flyby closest approaches;
  past and future label wording; shell alpha (hidden at 1, 40 and 170 AU); line alpha with `lineFade` 0; edge-on
  circle fade; info cards; bookmarks.
- E2E `tests/e2e/oort-bodies.spec.ts` (`sednoid-orbits`, `gliese-710-flyby`, not `@smoke`; uses `ui=1` for the label
  anchors): shell lines at their label anchors, the 1,000 AU ring lit all round, red-orange orbit pixels, the star
  bright and orange at its label with the track on both sides, no errors, draw-call budget.

## Known gaps

- Bare nuclei: Bernardinelli-Bernstein, Borisov and 3I/ATLAS have no coma or tail here.
- Two-body orbits only (no planets, Galactic tide or passing stars); stellar motion is a straight line, so the
  model's closest approaches differ from the published ones (both are shown). The star catalogue still draws the
  stars at today's positions.
- The sphere is a smooth procedural ball, not a shape model; only one object can be resolved at a time.
