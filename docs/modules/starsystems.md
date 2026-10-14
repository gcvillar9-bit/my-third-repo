# Star systems (P4-C)

Constellations in true 3D, star promotion and the nearby multiple systems: `src/modules/starsystems/`.
Depends on `stars` and `sun`. Data: `public/data/starsystems/constellations.json` (tools/build-starsystems.mjs).

## What it registers

| Kind                    | Id                                                                | Notes                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Renderable (background) | `starsystems.constellations`                                      | 695 segments of the 88 IAU figures, one `LineSegments` draw, hidden (no cost) when off.                                                                                                                            |
| Renderable (background) | `starsystems.sprites`                                             | Up to 16 photometric sprites for promoted stars (HYG point shader, camera-relative float64 positions).                                                                                                             |
| LabelSource             | `starsystems.constellations`                                      | `con:<IAU abbr>` labels (Latin name), priority 4, only while lines are on and within 1.5 kpc of the Sun.                                                                                                           |
| Search / Info           | `starsystems.constellations`, `starsystems`                       | `con:<abbr>` entries (aliases: abbreviation, English byname) fly to a view from Earth; info for `con:*` and promoted stars without a HYG name (`sirius-b`).                                                        |
| Setting                 | `starsystems.constellations`                                      | Boolean, persisted, default off. Toggle **Shift+C** (plain C moves the camera down). URL `?starsystems.constellations=1`; the three bookmarks below switch it on when opened as the initial view (`?b=` or `#b=`). |
| Bookmarks               | `orion-lines-from-earth`, `orion-from-200ly`, `big-dipper-100kyr` | EV −4. The last sets jd = J2000 + 100 kyr.                                                                                                                                                                         |
| Frames (on demand)      | `star:<HIP>`, `star:<id>`, `sys:alpha-cen`, `sys:sirius`          | ICRS axes, parented to **`mw`** (see below).                                                                                                                                                                       |
| Bodies (on demand)      | `hip:<HIP>`, `sirius-b`, exoplanet hosts `exo:<system>`           | kind `star`, `starSurface(teff, R)` shading at priority 10.                                                                                                                                                        |

`public.ts` exports `starSystems()` (promise of `{ promoteStar, promoteCustom, release, starPositionPc }`),
the pure orbit helpers (`skyBasis`, `solveKepler`, `orbitOffset`, `orbitNormal`, `meanAnomalyJ2000`,
`hashPhase`, `estimateRadiusRsun`, `luminosityLsun`), `PROMOTE_PC`, `RELEASE_PC`, `SPHERE_MIN_PX`, `starFrameId`.

## Constellations

- Build: Stellarium `skycultures/modern/index.json` (CC BY-SA 4.0) polylines → unique segments of stars.bin
  indices. The HIP → index map is rebuilt from the HYG CSV with the documented order (Sun dropped, `mag`, then
  `id`) and checked against the committed `stars.bin` positions; all 695 segments resolve (0 missing HIP).
- Shader: both ends get the HYG proper motion (`uYears`, ±1 Myr like the points) and are projected as
  directions. A straight 3D segment and the chord between its end directions project onto the same great-circle
  arc, so this is exact for any camera position. Each end stops `max(0.004 rad, 5 px)` short of the star.
- Colour is display-referred (0.05, 0.085, 0.16 pre-exposed, EV independent) because the lines are a guide, not
  light. They fade out between 1.5 and 3 kpc from the Sun.
- Figure labels sit 1 pc along the mean direction of the figure's stars as seen from the camera, so they follow
  the figure as it distorts. They lose declutter fights against star labels (Orion's sits on the belt).

## Star promotion

- Every 8 frames (every frame under `?test=1`) the camera is tested against the 3 4xx named HYG stars with a
  distance; a star within `PROMOTE_PC` = 0.5 pc is promoted with its whole system, and released beyond
  `RELEASE_PC` = 0.6 pc. Exoplanet hosts are promoted by the exoplanets module through the same API (owners).
- Frames hang off `mw`, not `ssb`: the ssb influence sphere is about 1 pc, and the anchor search descends through
  influence spheres, so a star frame under ssb beyond 1 pc is never anchored and the camera would stay in `mw`
  with 32 km steps. Position = ssb origin in mw + ssb rotation × (catalogue pc × PC); orientation = ssb's (ICRS).
  Unit test: camera 1.001 R from Sirius A anchors in `star:32349` and sees the centre to < 1 mm.
- While promoted, the HYG points of the system members are hidden (`stars/public.hideStars`, at most 4, nearest
  first) and their labels skipped; a sprite with the same photometry replaces them until the disk exceeds
  1.5 px, where the solar-system sphere provider draws the photosphere.
- Radii of plain HYG stars: `R = sqrt(L_V) (5772/T)²` from M_V and B-V Teff (no bolometric correction,
  approximate). Frames are kept after release (cheap; exoplanet frames may hang off them); bodies are removed.

## Systems (`binaries.json`, every row has a `source`)

| System    | Orbit / distance                                                                                                                 | Components                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| α Cen AB  | Pourbaix & Boffin 2016: P 79.929 yr, a 17.66″, e 0.5208, i 79.32°, Ω 205.064°, ω 232.006°, T 1875.665; 1.3384 pc (Kervella 2016) | A 1.1055 M☉ 1.2234 R☉, B 0.9373 M☉ 0.8632 R☉              |
| Proxima   | single, 1.302 pc (Gaia DR3)                                                                                                      | 0.1221 M☉, 0.1542 R☉, 3050 K (approximate)                |
| Sirius AB | Bond et al. 2017: P 50.1284 yr, a 7.4957″, e 0.59142, i 136.336°, Ω 45.4°, ω 149.161°, T 1994.5715; 2.6548 pc                    | A 2.063 M☉ 1.711 R☉ 9940 K, B 1.018 M☉ 0.0081 R☉ 25 000 K |

The barycentre direction is the mass-weighted HYG direction of the components, its velocity the primary's HYG
space velocity; the radial sign convention of the relative orbit is approximate. Sirius B's HYG point (Gl 244B,
no HIP) is found by position and M_V. A unit test checks Kepler's third law for both orbits (< 5 %).

## Proper motion

Already in `stars.vert.glsl` (P1). Barnard's Star moves 10.39″/yr after the stars module's Gaia DR3 override
(HYG clips its pmdec at 9 999.99 mas/yr). `big-dipper-100kyr` shows Dubhe and Alkaid drifting off the five
co-moving Ursa Major stars; the `core.stars.proper-motion` badge covers ±1 Myr.

## Tests

- Unit `tests/unit/starsystems/starsystems.test.ts`: 88 figures and valid indices, Orion's shoulders swap from
  200 ly, Big Dipper shape changes > 10 % at +100 kyr, Kepler III for the rows, Sirius promotion frames
  (barycentre distance, A-B separation range, anchor and mm precision, release).
- E2E `tests/e2e/starsystems.spec.ts` (`@smoke`): `orion-lines-from-earth` (Saiph-Rigel segment lit, sky beside it
  dark) then `orion-from-200ly` (segment lit, Orion's proportions change by > 20 %), zero errors, budgets.
