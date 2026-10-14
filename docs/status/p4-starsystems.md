# P4-C status: starsystems + exoplanets (+ stars)

Branch `p4-starsystems` (based on 5a3455a). `pnpm verify` green; e2e: starsystems (1 test, 2 bookmarks),
exoplanets (trappist-1, proxima-b), stars, milkyway and all `@smoke` tests pass except the pre-existing
`blackholes: gaia-bh3-dormant` failure (same 0.248 ratio without P4-C).

## Done

- Constellations: Stellarium modern figures (88, 695 segments) as 3D lines with proper motion, Shift+C /
  `starsystems.constellations`, labels at the figure centre seen from the camera, `con:*` search and info.
- Proper motion: already in the stars shader; Barnard's Star fixed to 10.39″/yr via a Gaia DR3 override row.
- Star promotion within 0.5 pc (frames under `mw` for metre precision), starSurface photospheres, sprites
  replacing hidden HYG points; α Cen AB (+ Proxima) and Sirius AB from sourced orbit rows.
- Exoplanets: 5 288 OEC planets in 4 019 systems, 777 hosts linked to HYG; class-tinted host-lit planets
  ("artist's impression"), orbits, Kopparapu HZ ring, markers; bookmarks trappist-1, proxima-b, kepler-186f,
  51-peg-b.
- Bookmarks orion-lines-from-earth, orion-from-200ly, big-dipper-100kyr. milkyway requests 2 and 3 done.

## Gaps

- milkyway request 1 (panorama ×8) deferred: needs a joint recalibration with the milkyway e2e.
- Lines turn on automatically only for the initial `?b=`/`#b=` view (no bookmark→setting hook in contracts).
- Exoplanet orbital phases, nodes and periastra are illustrative; custom host M_V uses a rough bolometric
  correction. Only one system is active at a time (the nearest within 0.5 pc).
- Search targets are static J2000 bookmarks (0.005 pc stand-off for systems).
- kepler-186f, 51-peg-b and big-dipper-100kyr have no e2e (4-bookmark cap); paths are unit-tested.

## Requests

See `docs/requests/p4-starsystems.md` (build-stars Barnard fix, Bookmark.settings, dynamic search targets).
