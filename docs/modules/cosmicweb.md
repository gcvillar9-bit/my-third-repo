# Cosmic web (P5-A)

A cheap procedural large-scale structure beyond the galaxy catalogue's completeness (~100 Mpc). It is a
statistical illustration, not a map, and is labelled **simulated** everywhere. Source: `src/modules/cosmicweb/`.

## Generator (`generate.ts`, deterministic, seed 1)

- 2,400 cluster nodes uniform in a sphere of radius 800 Mpc around the Milky Way, each with a Pareto richness
  (u^−0.6, capped at 20); every node is joined to its three nearest neighbours (a few thousand filaments).
- Tracers: 30% in Gaussian node blobs (σ = 1.5 Mpc × richness^⅓, picked ∝ richness), 60% along filaments
  (uniform along the segment, σ = 1.2 Mpc across, picked ∝ length), 10% uniform field.
- Counts per preset: potato 50k, low 100k, medium 200k, high 300k, ultra 400k. Each tracer has absolute
  magnitude −24.5 at 200k (about 1e12 L☉, matching a B-band luminosity density of ~1e8 L☉/Mpc³, approximate),
  brightened by 2.5 log10(200k/N) so the total light does not depend on the preset.
- Unit test: same seed → identical bytes; pair counts within 10 Mpc are > 5× those of a uniform field.

## Rendering

- One `Points` draw (background layer, RTE in Mpc relative to the `universe` origin, drawn as directions at
  infinity with the stars' 0.65 px Gaussian), photometric like the galaxy points.
- Tracers within 60-140 Mpc of the Milky Way fade in (the real catalogue covers the inside); the whole layer fades
  in as the camera goes from 20 to 120 Mpc from the Milky Way, so it never shows in the Local Volume.
- Generated lazily the first time the layer becomes visible (a one-off ~100 ms on medium in Node on the CI container, grid-accelerated neighbour search); zero cost before that.

## Bookmark, search, info, setting

- `cosmic-web-500mpc`: 500 Mpc from the Milky Way looking back at it, fovY 60°, EV −16.5.
- Search/info id `cosmicweb` ("Cosmic web (simulated)", `simulated: true`, approximate facts).
- Setting `cosmicweb.enabled` (group Sky).

Cut (per the P5 brief): FFT/Zel'dovich web, CMB shell, cosmology readouts, named superclusters.
