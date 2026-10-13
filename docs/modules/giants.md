# Giants (P3-A)

Gas-giant surface shading for Jupiter, Saturn, Uranus and Neptune (priority 10 over solar-system's default),
moon shadow transits and the P3-A bookmarks. Depends on `solar-system` and `rings`.

## Shading (`shading.ts`, `glsl/giant.glsl`, `giants.json`)

- Same albedo maps as solar-system (`texturePath`, lazy load above 1.5 px, owner `giants`), divided by their
  area-weighted mean so the disk matches the geometric albedo p of the point LOD.
- **Flow**: the map is advected by a zonal jet profile (sum of Gaussians in planetocentric latitude, m/s in the IAU
  rotating frame, `jets` rows with sources, approximate) plus divergence-free curl-noise eddies (`turbulence` m/s).
  Advection is bounded with the flow-map scheme: two phases of a 2 h sim-time cycle, crossfaded so each wraps while
  its weight is zero (`flowState`). Bands shear slowly with sim time and never smear. The flow fades out when a frame
  advances more than 1/100 to 1/10 of the cycle (high warp).
- **Great Red Spot**: found in the loaded map (reddest smoothed spot within 7° of 22° S, `findRedSpot`); an
  elliptic solid-body anticyclone (7,000 × 5,000 km semi-axes, 4.5-day rotation, counter-clockwise) swirls the map
  there and shields it from the zonal shear. If no red spot is found, no vortex is drawn.
- **Limb darkening**: Minnaert, L = E·c·p(2k+1)/(2π)·μ0^k·μ^(k−1), which keeps p for any k (k = 1 is solar-system's
  Lambert). k = 1.1 Jupiter, 1.05 Saturn, 0.9 Uranus and Neptune (approximate).
- **Ring shadow** (Saturn, Uranus): `ringSunTransmission` from `rings/public.ts` multiplies the sunlight.
- Cost: one pass, two map samples, three noise evaluations per fragment.

## Moon shadows (`occluders.ts`)

`OccluderProvider` with receivers Jupiter (Io, Europa, Ganymede, Callisto) and Saturn (Titan). The sphere provider
turns them into `shadows.glsl` sphere occluders (exact umbra and penumbra). These moons are also among the sphere
provider's default candidates, so the provider now skips a caster it has already counted (see
`docs/requests/p3-giants-rings.md`).

## Bookmarks (`bookmarks.ts`)

Computed from the frame tree at fixed instants; pole up on screen; inertial planet frames.

| id                          | Instant (UTC)    | View                                                                                                                                                               |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `saturn-backlit-2013-07-19` | 2013-07-19 21:27 | 600,000 km behind Saturn on the anti-Sun axis (inside the umbra), fov 30°, EV 5: unlit ring face glowing by forward scattering around the black night side.        |
| `jupiter-io-shadow`         | 2026-01-29 02:35 | 3 R_J from Io's shadow, 25° off the Sun direction, fov 20°, EV 11: umbra (~3,000 km) at the screen centre. Found with astronomy-engine `JupiterMoons` (unit test). |
| `uranus-rings`              | 2026-01-01 00:00 | 8 R_U, 30° off the Sun, aimed at the east ansa (47,500 km) with the globe just off-screen, fov 6°, EV 0: epsilon ring bright, inner rings faint.                   |

## Known gaps

- Cut by the lean plan: Saturn's hexagon, Neptune's dark spot, ring-particle fly-through.
- No ringshine or Saturnshine on night sides; no high-altitude haze or limb brightening in methane bands.
- The point LOD tint of the giants stays untinted, because solar-system's default shading (which reports the tint)
  no longer loads their maps (request filed).
