# Milky Way atlas: status (all three phases built)

## Done

- Phase 1: atlas of about 16,500 named structures with sourced info cards (open clusters with 374,285 real
  member stars, Cepheids, maser and HII regions, clouds, remnants, pulsars, satellites, streams, Magellanic
  gas, associations, arms, bar, bulge, discs, halo, Galactic centre, bubbles, Local Bubble, Radcliffe Wave);
  measured warp and flare; 32 more S-star orbits (blackholes data); `hideGalaxies` hook (galaxies).
- Phase 2: measured 3D dust within 1.2 kpc of the Sun in the volume model (Edenhofer et al. 2024, CC BY 4.0)
  and measured star-forming regions in the arm field, weighted by radio luminosity.
- Phase 3: 1,091,751 deep stars (AT-HYG to magnitude 11, CC BY-SA 4.0; hot luminous stars of Zari et al.
  2021), in two files so that low presets fetch 1.7 MB and the others 8.7 MB.
- Build with an enforced evidence rule (`tools/milkyway/lib.mjs`): every fetched file has a sha256, every
  hand-entered value a quote checked against the fetched page. Details: `docs/modules/milkyway.md`.

## Gaps

- Final look and frame rate were judged on software rendering only.
- Guides are not occluded by dust or bodies in front of them (background layer).
- The edge of the measured dust circle is visible from above; nothing is measured on the far side.
- Deep stars have no proper motion and no info cards; they are not searchable.
- No planetary nebulae, no OB associations beyond Sco-Cen; the Split, the Cepheus spur and the
  Orion-Eridanus superbubble were left out (no fetched geometry).
- A bookmark opened from the UI does not switch the guides on (only as the initial view); Shift+B does.
- Known deviations pinned by existing tests: bar angle 27 deg (long bar measured at 28 to 33) and the
  thick-disc normalisation 0.12 (the review gives 4% for the local density ratio).
- `public/` is at 53.4 MB of the 60 MB cap.
