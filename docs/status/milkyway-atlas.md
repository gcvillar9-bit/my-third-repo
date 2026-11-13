# Milky Way atlas: status (phase 1 of 3)

## Done

- Atlas of about 16,500 named structures with sourced info cards: open clusters with 374,285 real member
  stars, Cepheids, maser regions, HII regions, clouds, remnants, pulsars, satellites, streams, Magellanic gas,
  associations, arms, bar, bulge, discs, halo, Galactic centre, Fermi and eROSITA bubbles, Local Bubble,
  Radcliffe Wave. Details: `docs/modules/milkyway.md`.
- Build with an enforced evidence rule (`tools/milkyway/lib.mjs`): 209 fetched files with sha256, quotes checked.
- Galaxy model: measured warp and flare. Existing Milky Way tests pass as written.
- Other modules: 32 more S-star orbits (blackholes data), `hideGalaxies` hook (galaxies).

## Gaps

- Final look and frame rate were judged on software rendering at 480x270 and 1280x720 only.
- Guides are not occluded by dust or bodies in front of them (background layer).
- No planetary nebulae, no named HII nebulae beyond the catalogue names, no OB associations beyond Sco-Cen.
- The Split, the Cepheus spur and the Orion-Eridanus superbubble were left out (no fetched geometry).
- A bookmark opened from the UI does not switch the guides on (only as the initial view); Shift+B does.

## Next phases (not built)

2. Measured 3D dust near the Sun in the volume model (Edenhofer et al. 2024, CC BY 4.0, 3 GB source; or
   Vergely et al. 2022 through VizieR, 232 million rows) and real star-forming regions in the arm field.
3. Larger real star catalogue: hot luminous stars (Zari et al. 2021, 417,535 stars) and Gaia to G = 10
   (482,106 stars). All three phases fit under the 60 MB cap.

## Requests

- `tools/build-credits.mjs`: add `CC0-1.0` to `LICENSES` (the atlas credits show the bare id today).
- `model.test.ts` describes the band offset as "no warp": the comment is out of date, the test is unchanged.
