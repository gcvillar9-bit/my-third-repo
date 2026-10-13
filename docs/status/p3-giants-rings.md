# P3-A giants + rings: status

Branch `p3-giants-rings`. `pnpm verify` green; `giants.spec.ts` (3 tests), `solar-system.spec.ts` and
`integration.spec.ts` pass on potato.

**Done**

- `giants`: priority-10 shading for Jupiter, Saturn, Uranus, Neptune: zonal-jet + curl-noise flow advection
  (bounded two-phase cycle), Great Red Spot vortex at the red spot found near 22° S, Minnaert limb darkening,
  ring shadow on Saturn's and Uranus's globes.
- `giants`: OccluderProvider (Io, Europa, Ganymede, Callisto on Jupiter; Titan on Saturn).
- `rings`: Saturn (D 66,900 to F 140,180 km, Cassini Division 117,580-122,170 km, Encke and Keeler gaps, Celestia
  fine structure) and Uranus (10 narrow rings at true radii, epsilon brightest, Uranus's tilt from its `.fixed`
  frame); HG phase mix (backscattering B ring, forward-scattering dust), lit-face reflection and unlit-face
  transmission, planet shadow on the rings; ring v1 removed at runtime.
- Bookmarks `saturn-backlit-2013-07-19`, `jupiter-io-shadow` (2026-01-29 02:35 UTC, from astronomy-engine),
  `uranus-rings`.
- Unit tests: Cassini Division, ring shadow geometry, HG normalisation, Io between Sun and Jupiter at the bookmark
  date, umbra at the aim point, Saturn-backlit camera in the umbra, flow phases, GRS detection.

**Gaps**

- Cut by plan: ring-particle fly-through, Saturn's hexagon, Neptune's dark spot.
- No ringshine/Saturnshine; Uranus's inner rings are near the noise floor at the bookmark EV (physically faint).
- Point LOD tint of the giants is lost (request 3).

**Requests**: `docs/requests/p3-giants-rings.md` (one minimal solar-system edit to review, ring v1 cleanup, tint).
