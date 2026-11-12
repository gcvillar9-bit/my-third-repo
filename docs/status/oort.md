# Status: oort

## Done

- Module `oort` in two parts over one per-frame state (`shared.ts`): fades keep everything out of views within
  200 AU of the Sun and beyond 260,000 AU. Settings `oort.enabled`, `oort.brightness`, `oort.markers`.
- Cloud (`cloud/`): 20,000 to 400,000 GPU Kepler points from 250 to 100,000 AU (detached disc, inner cloud
  twisted by the Galactic tide, isotropic outer cloud), live under deep-time warp, generated lazily in batches.
  Artificial brightness with a near-field bound, flattened contrast and inside dimming. Info card with live
  facts, search entry, region labels, bookmarks `oort-cloud`, `oort-spiral`, `oort-inside`.
- Bodies (`bodies/`): Sedna, 2012 VP113, Leleakuhonua, Ammonite, comet Bernardinelli-Bernstein, 1I, 2I and 3I
  as frames and bodies with points, a lit sphere, orbit lines, info cards and search entries; straight tracks of
  Gliese 710 and Scholz's Star; six labelled shells; Voyager distance labels; six bookmarks.
- Explore panel group, README entry, `docs/modules/oort.md`.
- comets: hyperbolic orbits now converge far from perihelion (3I/ATLAS was at 1e37 AU after 100,000 years).
- 689 unit tests, `pnpm verify`, the four oort e2e tests and the 32 smoke tests pass.

## Gaps

- The spiral is a tilted bar with a gentle S-bend, grainy at potato; no crisp arms (see the module page).
- All orbital elements and astrometry are hand-entered and flagged approximate; Ammonite's node and argument
  of perihelion were not verified.
- Bernardinelli-Bernstein, Borisov and 3I/ATLAS are bare nuclei (no coma or tail).
- Stellar motion is a straight line, the star catalogue still draws both stars itself, and they do not perturb the cloud.
- Cosmic Zoom does not stop at the Oort Cloud (its smoke test is close to its time budget).

## Requests

- Other line shaders may share the hazard fixed in `bodies/glsl/line.glsl` (an invalid alpha reaching the HDR
  buffer blacks out the frame through bloom): worth a guard in the shared post chain.
