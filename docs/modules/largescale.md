# Large-scale flows: Great Attractor and Laniakea

The Great Attractor, the Norma Cluster, the Shapley Supercluster and the Laniakea supercluster, with a toy model of
the cosmic flow. Source: `src/modules/largescale/`. Everything here is approximate and labelled so.

## Data (`structures.json`)

- One row per structure, each with `source` and `approximate`: Great Attractor (l 307°, b 9°, 70 Mpc; Lynden-Bell
  et al. 1988, Kocevski & Ebeling 2006), Norma / Abell 3627 (l 325.3°, b −7.3°, cz 4,871 km/s → 69.6 Mpc at
  H0 = 70), Shapley core (l 306.4°, b 29.8°, z 0.048 → 200 Mpc), Virgo (the galaxies module's M87, via
  `galaxies/public.ts`), Laniakea (Tully et al. 2014: 160 Mpc / 520 Mly, 1e17 M☉, ~100,000 galaxies) and the Local
  Group's CMB motion (Kogut et al. 1993: 627 ± 22 km/s toward l 276°, b 30°).
- `galacticToUniverse` uses the galaxies module's conventions: Sun-centred galactic + `SSB_IN_MW`, rotated by
  `GALACTIC_TO_SUPERGALACTIC` into the `universe` frame (Mpc). The unit test checks M31 and M87 against
  `named.json` (< 3%). Norma lands 69.6 Mpc away, 24.5° from the Great Attractor on the sky.

## Model (`model.ts`, pure TS)

- Velocity = sum of Plummer-softened pulls: Great Attractor (weight 1, softening 20 Mpc), Shapley (3, 25 Mpc),
  Virgo (0.03, 5 Mpc). The weights are chosen, not fitted, so that the Great Attractor dominates inside Laniakea
  and the Milky Way's model flow points ~25° from the observed CMB dipole (l ≈ 305°, b ≈ 31°). Speeds are
  scaled so the Milky Way moves at 627 km/s.
- Laniakea outline: an ellipsoid (semi-axes 85, 78, 55 Mpc; long axis toward the Great Attractor, short axis toward
  supergalactic north; centre half-way to the Great Attractor) with six seeded plane-wave lumps (±15%). It is a
  stylised shape, not the measured basin. Contains the Milky Way, Virgo, Norma and the GA; Shapley is outside.
- Streamlines: seeds uniform inside the outline (mulberry32, seed 1), RK2 with 2 Mpc steps, up to 32 steps, stopping
  within 3 Mpc of the Great Attractor; plus 'Our path' from the Milky Way (64 steps). Lines per preset: potato 600,
  low 800, medium 1000, high 1200, ultra 1500. Generated lazily (a few ms) the first time the layer shows.

## Rendering (`render.ts`, overlay layer, 2 draws)

- A display-referred diagram (like milkyway's "you are here" ring): additive, no depth, RTE in Mpc relative to the
  `universe` origin. Fades in as the camera goes from 20 to 40 Mpc from the Milky Way.
- Flow lines: one indexed `LineSegments`; colour by model speed (blue slow → gold fast, log scale around
  627 km/s), a dash every 12 Mpc running downstream at 4.2 Mpc/s, 'Our path' in green.
- Outline: a 32 × 64 UV-sphere mesh, both faces, fresnel-rim glow plus contour slices every 10 Mpc along
  supergalactic north.

## Places, search, info, labels, setting

- Bookmarks `great-attractor` (150 Mpc above the plane, MW left, GA right, fovY 60°, EV −16) and `laniakea` (whole
  outline from 230 Mpc, fovY 50°, EV −16.5). Cosmic Zoom stops at `great-attractor` after `virgo-cluster`.
- Search + info ids `ls:great-attractor`, `ls:norma`, `ls:shapley`, `ls:laniakea`, `ls:lg-motion` (CMB dipole, with
  the toy model's direction for comparison). Labels beyond 25 Mpc from the MW: Great Attractor, Laniakea, Our path,
  Norma (within 260 Mpc), Shapley (beyond 45 Mpc).
- Setting `largescale.enabled` ("Laniakea flows", group Sky) hides the outline, the flows and the labels.

## Gaps

- The flow field is a three-attractor toy, not Cosmicflows data; no Perseus–Pisces, Coma or Local Void.
- The outline is not the published Laniakea surface.
