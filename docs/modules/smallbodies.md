# Small bodies (P3-B)

The asteroid belt, Hildas, Jupiter Trojans, the Kuiper belt and plutinos as one GPU-propagated point cloud.
Cross-module API: `src/modules/smallbodies/public.ts`. Parameters and sources are in `populations.json`
(a statistical model, not a catalogue; marked approximate). Nothing is downloaded: elements are generated
at runtime from `?seed=` (deterministic, mulberry32).

## Populations (`generate.ts`)

Elements are heliocentric, ecliptic J2000, at epoch J2000. Counts by preset: potato 20k, low 60k, medium
150k, high 250k, ultra 400k. The split is main belt 70%, Hildas 3%, Trojans 7%, classical Kuiper belt 14% and
plutinos 6%.

| Population  | Model                                                                                                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main belt   | a in 2.1-3.3 AU, drawn from a sin^0.6 bump times flat-bottomed (super-Gaussian) notches at the Kirkwood gaps 3:1 (2.502), 5:2 (2.825), 7:3 (2.958) and 2:1 (3.279). The gaps live in the a-distribution, as in reality, so they are not sharp in space. e is Rayleigh with σ 0.11, i is Rayleigh with σ 7°. |
| Hildas      | n = 3/2 n_J exactly. The resonant angle 3λ_J − 2λ − ϖ is set within ±40° of 0, which draws the Hilda triangle in Jupiter's frame and never drifts.                                                                                                                                                          |
| Trojans     | n = n_J and λ = λ_J ± 60°, with L4 holding 62%. A libration term A·sin(φ + νt) has A up to 35° and a 150 yr period. The shader adds Jupiter's true-minus-mean longitude (`uTrojanShift`, from the frame tree each frame), so the clouds follow the real Jupiter.                                            |
| Kuiper belt | Classical a in 42-48 AU, 60% cold (i σ 2°) and 40% hot (i σ 15°).                                                                                                                                                                                                                                           |
| Plutinos    | n = 2/3 n_Neptune, with the resonant angle 3λ − 2λ_N − ϖ within ±80° of 180°.                                                                                                                                                                                                                               |

Jupiter's and Neptune's mean longitudes come from the Standish J2000 mean elements. H magnitudes follow a
power law, N(<H) ∝ 10^0.3H.

## GPU propagation (`belt.ts`, `glsl/belt.vert.glsl`)

- **Attributes:** `aEl0` (a, e, i, Ω), `aEl1` (ω, M at the GPU epoch, n, H) and `aLib` (libration
  amplitude and phase). That is 40 bytes per point, 16 MB on ultra.
- **Kepler solve:** Mikkola's cubic starter plus exactly 4 Newton iterations. The CPU twin is `kepler4.ts`;
  in float64 the residual stays under 1e-9 for e ≤ 0.97 over all M (unit-tested).
- **Time:** `uDt` = jd − epoch in days. The epoch is rebased in float64 whenever |uDt| > 200 d. M and the
  libration phase are recomputed for all points (about 2 ms on ultra) and re-uploaded, so float32 phases
  stay below about 2 rad at any warp. A unit test checks float32 against float64 after a rebase (under 3,000
  km).
- **Positioning:** RTE via `rte.glsl`. The camera is relative to the Sun in ecliptic axes (high/low split),
  and `object.quaternion` = Rx(obliquity). This assumes the `sun` frame shares the ICRF axes, as it does.
- **Photometry:** m = H + 5 log10(r·Δ) − 2.5 log10 Φ_HG(α, G = 0.15), and E = 2.54e-6 · 10^(−0.4 m) lux spread
  over a 2 px sprite. It is pre-exposed, additive, and capped at 8 per pixel.
- **Visibility boost (not physical):** real belt members are far below naked-eye brightness, so points are
  brightened by `smallbodies.boost` magnitudes (setting, default 19, 0 = physical). A further
  2.5 log10(150k / count) keeps the integrated brightness independent of the preset.
- **Fades:** points nearer than 1e6-1e8 m fade out (there are no close-up rocks). The whole cloud fades
  between 3,000 and 30,000 AU from the Sun.

## Bookmarks and search

- `asteroid-belt-3au`: 3 AU from the Sun, 0.12 AU above the ecliptic, looking prograde and slightly
  sunward, EV −2, at 2026-01-01. The belt is densest in the upper left.
- The search entry "Asteroid belt" (aliases Kirkwood gaps, Trojans, Hildas, Kuiper belt, plutinos) flies
  there.

## Cut or not built (lean Phase 3)

Named dwarf planets and comets from `.ssc` files, comet tails, close-up rocks and spacecraft markers are not
built.
