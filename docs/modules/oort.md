# Oort Cloud (oort)

The Oort Cloud around the Solar System, in two parts that share one per-frame state (`shared.ts`: camera
relative to the Sun in ecliptic axes, the near and far fades, the settings). This page covers the cloud part
(`src/modules/oort/cloud/`). It is a statistical model, not a catalogue: no Oort Cloud body has ever been
observed in place. Elements are generated at runtime from `?seed=` (deterministic, mulberry32), so nothing is
downloaded. The model and its sources are in `cloud/model.json`, and every value there is marked approximate.

## The model (`generate.ts`, three-free, float64)

| Step            | Model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semi-major axis | dN/da is a continuous piecewise power law over 250, 2,000, 50,000 and 100,000 AU with slopes 1.5, −1.5 and −3.5 (Duncan, Quinn & Tremaine 1987: n(r) ∝ r^−3.5). Points are drawn from the flatter law 0.5, −1, −2 (inverse CDF) and carry `w = true / sampling` (both 1 at 2,000 AU, so w ≤ 1: 0.125 at 250 AU, 0.2 at 50,000, 0.07 at 100,000). This gives the thin outer cloud a third of the points.                                                                                                                                  |
| Eccentricity    | A smooth blend in ln a from 1,500 to 12,000 AU, `e = (1 − T)·e_det + T·e_th`: detached orbits with perihelion uniform in 38-90 AU (sednoid-like) close in, thermal orbits f(e) = 2e up to e = 1 − 38/a far out (Heisler & Tremaine 1986).                                                                                                                                                                                                                                                                                                |
| Orientation     | A smoothstep in ln a from 8,000 to 25,000 AU picks isotropic orbits. The rest form a disc near the ecliptic: inclination Rayleigh with σ 12°, node and perihelion argument uniform.                                                                                                                                                                                                                                                                                                                                                      |
| Galactic tide   | Orbit-averaged vertical tide: the node precesses about the north Galactic pole at −(ν²/2n) cos i_G (1 + 1.5e²)/√(1 − e²), with ν² = 4πGρ₀ (ρ₀ = 0.1 M☉/pc³, 5.65e−15 yr⁻²) and \|rate\| capped at n/2. The rate uses the typical eccentricity at that semi-major axis (not the orbit's own) with 15% log-normal scatter. Over 4.5 Gyr the twist is about 0.2 rad at a = 1,000 AU, 0.85 rad at 3,000 AU and keeps turning steadily out to about 11,000 AU. That twists the inner disc into the S-shaped spiral of Nesvorný et al. (2025). |
| Phase           | Mean anomaly at J2000 is uniform.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Assumed, not sourced: the rise below 2,000 AU, the cut-off beyond 50,000 AU, the eccentricity blend and the
isotropic transition range, e and i_G frozen at their initial values under the tide, and the tide rate taken
from the typical eccentricity at each semi-major axis (under the tide an orbit's eccentricity and inclination
oscillate together, so its long-term rate is closer to the population's than its present eccentricity
suggests). Passing stars are left out of the
dynamics (their effect is folded into the isotropic outer cloud). Each point draws exactly 8 random numbers,
so any prefix of the cloud is the same for any count and any batching.

**Density (`density.ts`):** a cloud-in-cell histogram in ln r of a 40,000-point sample (distances at
J2000), normalised so the points with a > 20,000 AU add up to 1.5 × 10¹² comets larger than 1 km (Boe et al.
2019). The whole model then holds about 10¹³ comets. n(r) falls as r^−3.6 between 5,000 and 40,000 AU;
the mean spacing n^−1/3 is about 6 AU at 30,000 AU. The profile is built on the first info-card request, not
at boot.

## GPU propagation (`cloud.ts`, `glsl/cloud.vert.glsl`)

- **Attributes** (40 bytes per point, 16 MB on ultra): `aEl0` (a in AU, e, M at the GPU epoch, n in
  rad/kyr), `aQuat` (perifocal to ecliptic at the GPU epoch, tide included) and `aEl1` (tide rate in rad/kyr,
  weight). The CPU keeps float64 masters (M at J2000, n, rate) and the J2000 quaternion in float32.
- **Shader:** M = M_base + n·uDt (uDt in kyr since the epoch), wrapped; Kepler is solved with Mikkola's
  starter plus 5 Newton steps (CPU twin `kepler.ts`). The perifocal position is rotated by `aQuat`, then about
  the Galactic pole by rate·uDt (Rodrigues), and placed with the RTE split (camera relative to the Sun in
  ecliptic axes, `object.quaternion` = Rx(obliquity)). `positionAt(cloud, k, jd)` is the float64 twin.
- **Rebase:** one base epoch for M and the twist. When |uDt| > 1,000 kyr, `rebase` recomputes M and the
  quaternions of every point in float64 (a tight loop with no allocation) and uploads both attributes again.
  At a = 250 AU (n = 1.6 rad/kyr), float32 rounding of the phase stays below 1e−3 rad within the threshold.
  At the 10 Myr/s warp that means a rebase every 0.1 s.
- **Lazy generation:** nothing is generated at boot. Generation starts when the camera is between 100 AU and
  520,000 AU from the Sun. It runs in batches of 2,000 points within a 4 ms budget per frame (at most
  20,000), grows the draw range, and uploads only the new range. Under `?test=1` everything is generated
  in one update. Quality changes (`ctx.quality.subscribe`) regenerate the cloud at the new count.
- **Brightness (artificial throughout, `display.ts` is the CPU twin):** a point shows how many comets it
  stands for, not reflected sunlight. Its illuminance is
  E = E₀ · w · (150k / count) · brightness · inside(d☉) · contrast(a) · (D₀ / max(d, k·s))², capped at
  1e−5 lux (about Sirius) as a safety net. E₀ = 1.6e−4 lux at D₀ = 1,000 AU.
  - The 1/d² law keeps a haze's surface brightness independent of the viewing distance.
  - **Near-field bound:** under 1/d² every distance shell contributes equally, so the few nearest points
    would carry as much light as the whole haze behind them. d is therefore bounded below by k = 2.5 local
    mean spacings s = 0.08·a·(150k / count)^⅓ (about 0.16·a on potato), and a point never outshines the
    haze it belongs to.
  - **Contrast:** points beyond 2,000 AU are multiplied by (a / 2,000)^1.4. The true column density falls as
    r^−2.5, which no display can show: the core would saturate while the halo stays invisible.
  - **Inside dimming:** seen from inside, a haze has the same surface brightness as from outside, which
    would turn the sky grey. The whole cloud is dimmed by a factor of the camera's distance from the Sun:
    0.004 at 2,500 AU and below, rising smoothly in ln d to 1 at 150,000 AU (0.55 at 22,000 AU, 0.75 at
    40,000 AU).
- **Sprites:** 2 px, growing to at most 3 px with half a spacing's apparent size. The output is
  L·uExposure·cloudFade (pre-exposed), with a near fade over 0.05-2 AU and a tint mixed across ln a from the
  three `regions[].tint` values (each normalised to luminance 1). Blending is additive with no depth write,
  on the `transparent` layer.

## Settings, info, search, labels, validity

- **Settings** (registered by `index.ts`): `oort.enabled`, `oort.brightness` (0 = reality, invisible) and
  `oort.markers`. The cloud is visible when `cloudFade > 0` and the brightness is above 0. The fade runs in
  from 200 to 1,500 AU and out from 200,000 to 260,000 AU.
- **Info card `oort-cloud`** (`facts.ts`, `simulated: true`): live facts for the camera's distance from the
  Sun, light-travel time, the Sun's magnitude there (−26.74 + 5 log₁₀ d), the model region and the mean
  spacing between comets. Static facts (with sources) are the extent (1,000-2,000 to 100,000 AU, 1.6 ly),
  1.5 × 10¹² comets above 1 km in the outer cloud, about 1.3 Earth masses, a 1 million year period at
  10,000 AU, the predictions by Öpik (1932) and Oort (1950), and the fact that it has never been observed.
  Model numbers come from `model.json`; the hand-entered rows are in `facts.json`. Region-label ids
  (`oort-cloud.inner`, `.outer`, `.spiral`) open the same card.
- **Search:** "Oort Cloud" (aliases Öpik-Oort cloud, Hills cloud, Inner/Outer Oort Cloud, Oort spiral, comet
  cloud), `kind: 'other'`, flies to `oort-cloud`.
- **Labels** (`labels.ts`): Inner Oort Cloud (Hills cloud), Outer Oort Cloud and Oort spiral. They sit at
  fixed points in frame `sun`, placed for the Galactic-pole views. Each shows while the cloud is visible and
  R/d is in range: 0.05-3, or 0.15-3 for the spiral. A double click flies to `oort-spiral` or `oort-cloud`.
- **Validity `oort.cloud`:** statistical two-body orbits with a secular Galactic tide, J2000 ± 100 Myr,
  `beyond: 'approximate'`.

## Bookmarks (`bookmarks.ts`, frame `sun`, 2026-01-01)

`oort-cloud` and `oort-inside` look at the Sun along the Galactic pole, with ecliptic north up, so the dark
polar sky lies behind the cloud. `oort-spiral` looks from within the ecliptic plane, where the twist shows best.

- `oort-cloud`: 170,000 AU above the north Galactic pole, fovY 70°, EV −2. A bright but not blown-out
  inner cloud sits inside a grainy round halo that fades into the star field.
- `oort-spiral`: 24,000 AU from the Sun in the ecliptic plane, towards the Galactic pole's projection on it,
  ecliptic north up, fovY 60°, EV 0.5. The inner cloud is a bright bar through the Sun, tilted from upper left
  to lower right and bending gently into an S as it turns with distance. Grainy at 20,000 points, clear at
  150,000. The 10,000 AU shell is seen face-on around it.
- `oort-inside`: 30,000 AU on the south Galactic side, looking back at the Sun, fovY 70°, EV 0. A dark
  starry sky speckled with cloud points, and a glow around the Sun.

## Tests

- `tests/unit/oort/cloud.test.ts` covers determinism and the prefix property, the weights, perihelia at or
  beyond 38 AU, and the weighted inner (2,000-20,000 AU) to outer ratio, which is within 6% of the analytic
  4.58. It also checks the twist: the 600-1,200 AU mean normal lies within 15° of the ecliptic pole, and the
  2,500-3,500 AU mean normal is rotated backwards about the Galactic pole by the predicted angle. The spiral
  stays coherent: projected along the Galactic pole, the disc's ellipticity is above 0.2 in every annulus from
  1,500 to 8,000 AU and its long axis turns steadily with radius.
  Further cases: an isotropic outer cloud (mean |cos i| near 0.5), float32 Kepler emulation (no NaN; position
  error below 1e−5 a up to e = 0.9997), float32 phase within 1e−3 rad up to the rebase threshold, and rebase
  invariance against a float64 emulation of the shader. The rest cover the density slope (−3.2 to −3.8), the
  info card facts, bookmark distances and directions, the search entry and label visibility.
- The display-law tests cover the inside dimming (its minimum at 2,500 AU, 1 from 150,000 AU, monotonic in
  between), the contrast boost, the near-field bound and the shader carrying the same law.
- `tests/e2e/oort.spec.ts` (480×270, potato) has two tests. `oort-cloud` (`@smoke`): centre 11 px in
  0.15-0.6 (0.52 measured), every box at 60 px ≥ 0.01 (min 0.018), the 110 px ring ≥ 0.003 on average
  (0.020) and corners < 0.001. `oort-spiral`: (UL + LR)/(UR + LL) > 2.5 near the Sun and > 1.7 along the arms (3.7 and 2.4 measured), and the bar's angle turns by more than 7° between 20 and 60 px. It is also the regression test for a frame that once went black in this exact view (see the line shader of the bodies part). Both check
  `errors()` and `stats().points ≥ 20,000`. `tests/e2e/oort-bodies.spec.ts` (bodies part) also passes with
  the cloud on: the sky between the shells of `sednoid-orbits` stays dark.

## Known gaps

- The spiral is a tilted bar with a gentle S-bend, not crisp arms: most orbits are very eccentric, so the points
  at one distance come from a range of semi-major axes and twist angles, and the disc is thick (σ 12°).
- At `gliese-710-flyby` (40,000 AU) the inner cloud is a dense field of dots: not saturated, but it competes
  with the 10,000 AU shell.
- Passing stars, the eccentricity and inclination cycles of the tide, and the planets' scattering are not
  modelled. Individual points mean nothing; only the distribution does.
- `oort-inside` has no e2e test (it is covered by the bookmark sweep).

## Real objects, passing stars and scale shells

Real objects on the Oort Cloud's scale, the tracks of two passing stars and labelled distance shells:
`src/modules/oort/bodies/`, started by `initBodies(ctx, shared)` from `src/modules/oort/index.ts`. Like the cloud
part it reads the per-frame `OortShared` state (`src/modules/oort/shared.ts`).

### Data (hand-entered, bundled with the code, every value with a `source`)

| File           | Rows                                                                                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `objects.json` | Sednoids `sedna`, `2012-vp113`, `leleakuhonua`, `ammonite` (kind `dwarf`); `bernardinelli-bernstein` (kind `comet`, inbound barycentric orbit, aphelion 40,400 AU); interstellar `oumuamua`, `borisov`, `3i-atlas` (hyperbolic, with `vInfKms`). Elements in the shape of the comets module's `CometElements`. |
| `flybys.json`  | `gliese-710` and `scholz-star`: Gaia-era astrometry (position, parallax, proper motion, radial velocity) and published closest approaches; `trackHalfLengthAu` 250,000.                                                                                                                                        |
| `markers.json` | Six shells: heliopause 120 AU, solar gravity lens 550 AU, 1,000 AU, 10,000 AU, one light-year, 100,000 AU; Voyager facts.                                                                                                                                                                                      |

No value was changed from the integrator's tables. Ammonite's node and argument of perihelion are flagged unverified
in their source text.

### Model

- **Objects** (`objects.ts`): a `CometOrbit` per row (comets' `public.ts`), a frame with the row id (parent `sun`, or
  `ssb` for Bernardinelli-Bernstein) and a `Body` (`simulated: true`, influence radius 200 radii clamped to
  [1e6, 2e8] m). `objectState` propagates every orbit, bound or unbound, with `CometOrbit` (accurate millions of
  years from perihelion, as the flyby bookmarks need). Validity range `oort.objects`: element epochs ± 200 years,
  `beyond: 'approximate'`.
- **Passing stars** (`flybys.ts`): ICRS position and velocity from the astrometry
  (v_t = 4.74 μ d), straight-line motion `r(t) = r0 + v (t − t0)`, closest approach at `t* = −r0·v/|v|²`. Results:
  Gliese 710 at about 10,600 AU in 1.29 Myr, Scholz's Star at about 66,000 AU about 80,000 years ago. A frame
  `flyby:<id>` per star (parent `ssb`, influence radius 0) and no `Body` (the star catalogue has the stars).

### Drawing (lazy `import()` behind `assets.track`, four renderables)

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

### Fade rule (nothing new in inner Solar System views)

- Shells, tracks, star points, their labels and the orbit lines of unselected objects are multiplied by
  `shared.lineFade` (0 within 200 AU of the Sun and beyond 260,000 AU). Tracks and stars also follow the app-wide
  orbit-lines switch, shells the `oort.markers` setting.
- Shell alpha = `lineFade · markers · smoothstep(0.008, 0.03, R/d) · smoothstep(0.02, 0.2, d/R)`.
- The line shader discards fragments whose alpha is not in (0, 1]: hidden lines cost nothing, and an invalid
  alpha (seen once on a sub-pixel shell segment exactly face-on to the camera) can never reach the HDR buffer,
  where bloom would spread it over the whole frame. Hidden shell circles keep real positions for the same reason.
- Orbit alpha = `max(emphasis, lineFade) · orbitLines`; the selected or targeted object's line shows everywhere.
- The objects themselves are always drawn. The registry labels bodies of kind `dwarf` from any distance, so the
  four sednoid names appear in inner views as Pluto's does.

### UI

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

### Bookmarks

| Id                              | View                                                                           | EV  |
| ------------------------------- | ------------------------------------------------------------------------------ | --- |
| `sednoid-orbits`                | 2,500 AU above the ecliptic, the four sednoid orbits and the inner shells      | −2  |
| `gliese-710-flyby`              | 40,000 AU out at the computed closest approach, star, track and 10,000 AU ring | −2  |
| `scholz-star-flyby`             | 185,000 AU out 80,000 years ago, track between the light-year and 100,000 AU   | −2  |
| `interstellar-visitors`         | 650 AU above the ecliptic, three hyperbolas, heliopause and 550 AU rings       | −2  |
| `bernardinelli-bernstein-orbit` | face-on view of the whole 40,400 AU ellipse                                    | −2  |
| `sedna`                         | Sedna from 1,100 km, gibbous, sunlit at about 84 AU                            | 3   |

### Tests

- Unit `tests/unit/oort/bodies.test.ts`: sources and orbits for every row; Sedna's aphelion and perihelion; the
  Bernardinelli-Bernstein aphelion; v∞ of the visitors; unbound states through `CometOrbit` a million
  years out; orbit sampling (closed, through q and Q, turning under 0.2 rad per sample); flyby closest approaches;
  past and future label wording; shell alpha (hidden at 1, 40 and 170 AU); line alpha with `lineFade` 0; edge-on
  circle fade; info cards; bookmarks.
- E2E `tests/e2e/oort-bodies.spec.ts` (`sednoid-orbits`, `gliese-710-flyby`, not `@smoke`; uses `ui=1` for the label
  anchors): shell lines at their label anchors, the 1,000 AU ring lit all round, red-orange orbit pixels, the star
  bright and orange at its label with the track on both sides, no errors, draw-call budget.

### Known gaps

- Bare nuclei: Bernardinelli-Bernstein, Borisov and 3I/ATLAS have no coma or tail here.
- Two-body orbits only (no planets, Galactic tide or passing stars); stellar motion is a straight line, so the
  model's closest approaches differ from the published ones (both are shown). The star catalogue still draws the
  stars at today's positions.
- The sphere is a smooth procedural ball, not a shape model; only one object can be resolved at a time.
