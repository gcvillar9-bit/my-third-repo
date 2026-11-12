# Oort Cloud (oort)

The Oort Cloud around the Solar System, in two parts that share one per-frame state (`shared.ts`: camera
relative to the Sun in ecliptic axes, the near and far fades, the settings). This page covers the cloud part
(`src/modules/oort/cloud/`). It is a statistical model, not a catalogue: no Oort Cloud body has ever been
observed in place. Elements are generated at runtime from `?seed=` (deterministic, mulberry32), so nothing is
downloaded. The model and its sources are in `cloud/model.json`, and every value there is marked approximate.

## The model (`generate.ts`, three-free, float64)

| Step            | Model                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semi-major axis | dN/da is a continuous piecewise power law over 250, 2,000, 50,000 and 100,000 AU with slopes 1.5, −1.5 and −3.5 (Duncan, Quinn & Tremaine 1987: n(r) ∝ r^−3.5). Points are drawn from the flatter law 0.5, −1, −2 (inverse CDF) and carry `w = true / sampling` (both 1 at 2,000 AU, so w ≤ 1: 0.125 at 250 AU, 0.2 at 50,000, 0.07 at 100,000). This gives the thin outer cloud a third of the points. |
| Eccentricity    | A smoothstep in ln a from 1,500 to 12,000 AU picks thermal orbits, f(e) = 2e up to e = 1 − 38/a (Heisler & Tremaine 1986). The rest are detached, with perihelion uniform in 38-90 AU (sednoid-like).                                                                                                                                                                                                   |
| Orientation     | A smoothstep in ln a from 8,000 to 25,000 AU picks isotropic orbits. The rest form a disc near the ecliptic: inclination Rayleigh with σ 12°, node and perihelion argument uniform.                                                                                                                                                                                                                     |
| Galactic tide   | Orbit-averaged vertical tide: the node precesses about the north Galactic pole at −(ν²/2n) cos i_G (1 + 1.5e²)/√(1 − e²), with ν² = 4πGρ₀ (ρ₀ = 0.1 M☉/pc³, 5.65e−15 yr⁻²) and \|rate\| capped at n/2. It acts over 4.5 Gyr: about 0.2 rad at a = 1,000 AU, 2 rad at 3,000 AU, and many turns beyond 6,000 AU (phase-mixed). That twists the inner disc into the spiral of Nesvorný et al. (2025).      |
| Phase           | Mean anomaly at J2000 is uniform.                                                                                                                                                                                                                                                                                                                                                                       |

Assumed, not sourced: the rise below 2,000 AU, the cut-off beyond 50,000 AU, the thermal and isotropic
transition ranges, and e and i_G frozen at their initial values under the tide. Passing stars are left out of the
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

All three views look at the Sun along the Galactic pole, with ecliptic north up. The dark polar sky lies
behind the cloud. An untwisted ecliptic disc would look mirror-symmetric left to right in these views; the
tide's twist makes the upper-left and lower-right quadrants brighter.

- `oort-cloud`: 170,000 AU above the north Galactic pole, fovY 70°, EV −2. A bright but not blown-out
  inner cloud sits inside a grainy round halo that fades into the star field.
- `oort-spiral`: 22,000 AU above the north Galactic pole, fovY 60°, EV 0.5. A speckled haze surrounds a
  bright, slightly flattened core; the haze is brighter upper left and lower right. The scale shells and
  the tracks of the bodies part cross it.
- `oort-inside`: 30,000 AU on the south Galactic side, looking back at the Sun, fovY 70°, EV 0. A dark
  starry sky speckled with cloud points, and a glow around the Sun.

## Tests

- `tests/unit/oort/cloud.test.ts` covers determinism and the prefix property, the weights, perihelia at or
  beyond 38 AU, and the weighted inner (2,000-20,000 AU) to outer ratio, which is within 6% of the analytic
  4.58. It also checks the twist: the 600-1,200 AU mean normal lies within 15° of the ecliptic pole, and the
  2,500-3,500 AU mean normal is rotated backwards about the Galactic pole by the predicted angle.
  Further cases: an isotropic outer cloud (mean |cos i| near 0.5), float32 Kepler emulation (no NaN; position
  error below 1e−5 a up to e = 0.9997), float32 phase within 1e−3 rad up to the rebase threshold, and rebase
  invariance against a float64 emulation of the shader. The rest cover the density slope (−3.2 to −3.8), the
  info card facts, bookmark distances and directions, the search entry and label visibility.
- The display-law tests cover the inside dimming (its minimum at 2,500 AU, 1 from 150,000 AU, monotonic in
  between), the contrast boost, the near-field bound and the shader carrying the same law.
- `tests/e2e/oort.spec.ts` (480×270, potato) has two tests. `oort-cloud` (`@smoke`): centre 11 px in
  0.15-0.6 (0.52 measured), every box at 60 px ≥ 0.01 (min 0.018), the 110 px ring ≥ 0.003 on average
  (0.020) and corners < 0.001. `oort-spiral`: (UL + LR)/(UR + LL) > 1.2 (about 1.4 measured). Both check
  `errors()` and `stats().points ≥ 20,000`. `tests/e2e/oort-bodies.spec.ts` (bodies part) also passes with
  the cloud on: the sky between the shells of `sednoid-orbits` stays dark.

## Known gaps

- No spiral arms show, at potato or at medium (150,000 points, checked once): it is a model limit, not a
  point-count one. Most orbits are very eccentric and spend their time between a and 2a, so the points at a
  given distance come from a spread of semi-major axes, and hence of twist angles, too wide for arms, and
  the disc is thick (σ 12°). The twist reads as a mirror-asymmetric, leaning core.
- At `gliese-710-flyby` (40,000 AU) the inner cloud is a dense field of dots: not saturated, but it competes
  with the 10,000 AU shell.
- Passing stars, the eccentricity and inclination cycles of the tide, and the planets' scattering are not
  modelled. Individual points mean nothing; only the distribution does.
- `oort-inside` has no e2e test (it is covered by the bookmark sweep).

## Real objects, passing stars and scale shells
