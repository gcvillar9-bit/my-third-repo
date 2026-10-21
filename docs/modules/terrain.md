# Terrain and walk mode (P2-A)

Cube-sphere quadtree terrain for every planet, dwarf, moon and minor body (not the gas giants), the mesh-identical
ground used by collision, and walk mode. Code: `src/modules/terrain/**`, `src/camera/walk.ts` (+ hooks in
`src/camera/controller.ts`). Public API: `src/modules/terrain/public.ts` (including `terrainHeightAt(bodyId, dir)`,
the ground height of the finest grid, used by the life module to stand plants and animals on the drawn ground).

## Quadtree (`cube.ts`, `patch.ts`, `select.ts`)

- 6 roots (face table identical to the sphere provider, `u × v` = outward), max level 22, node key
  `((face·32 + level)·2^22 + x)·2^22 + y` (< 2^53).
- Patch = 33×33 vertices + 4 skirts (depth `2·cell + 0.5 m`), 2304 triangles, one shared `Uint16` index. Face
  coordinates are exact dyadics `s = (x·32+i)/(16·2^L) − 1` warped by an odd-exact `tan(|s|·π/4)` with `±1 → ±1`,
  so shared edges (inside a face and across cube edges) give bitwise-identical directions and heights.
- Positions are float64 `d·(r_ell(d) + h(d))` on a 35×35 bordered grid (edge normals match neighbours), stored as
  Float32 offsets from the float64 centre vertex. `aUpH` = radial direction + height drives the hand-off morph.
- Selection is best-first by screen-space error `SSE = 0.5·cell(L) / (dist·pixelAngle)` with
  `dist = max(|C − cam| − ρ, |cam| − r_max, 0.1)`. Split when `SSE > knobs.terrainSse`, merge only below
  `target / 1.5` (hysteresis). Horizon culling over the sphere `min(a, c) − maxAbsHeight`; frustum culling against
  the 4 side planes (never within 10 m of the camera).
- A node splits only when all of its non-culled children are resident; otherwise it draws and requests them.
  Pending splits reserve their leaf/tile budget and pin the siblings that already arrived. Exact bounds of every
  built node are remembered after eviction so culling decisions stay stable (no request loops).
- Budgets: leaves ≤ `min(300, 0.75·terrainTileCap)` (draw calls), tree tiles ≤ `terrainTileCap − 8`.
  LRU eviction never touches the current tree or the roots. Note: the knob gives SSE 4 px on medium (DESIGN's
  "2 px" is ultra); with `eps = cell/2` the vertex spacing is about `2·SSE` px.

## Generation (`terrain.worker.ts`, `height-modules.ts`, `manager.ts`)

- `TerrainManager` per body: height spec, CPU height function, tile cache, in-flight requests, selection. It
  observes the camera once per frame (from `wants()`), issues ≤ 8 requests per frame (≤ 16 in flight).
- In test mode the per-frame budget is lifted and every completed patch re-runs the selection with the last view,
  so the worker pool stays busy until the tree has converged and `ready()` returns a finished tree.
- Workers: comlink pool `terrain.gen` (2 workers) calling `build(req)`; the main thread falls back to in-process
  generation (tracked with `assets.track`) when workers are unavailable or fail.
- Height sources: `HeightSourceSpec.workerModule` is a key of `import.meta.glob('/src/modules/*/height/*.ts')`
  (default export `{ create }` or a named `create`). Bodies without a registered spec use
  `/src/modules/terrain/height/fbm-craters-lite.ts`. A later `addHeightSource` (registry `'height'`) resets that
  body's tiles and reloads the CPU function.
- `fbm-craters-lite`: float64 hashed gradient-noise fBm (`λ0 = min(R/2, 400 km)`, `A0 = 0.0035·λ0`, H = 0.9)
  plus 9 crater layers (jittered 3D cells, `D ≤ 0.35 S`, bowl + rim + ejecta, depth `min(0.2 D, 1 km·(D/15 km)^0.3)`;
  none on Earth, Venus, Titan, Io, Europa). Features fade in between 4 and 2 vertex spacings of the requested
  level (band limit), and heights are clamped to the analytic `maxAbsHeight`.

## Rendering (`render.ts`, `glsl/terrain.*.glsl`)

- One `ShaderMaterial` per body: depth chunk, `SURFACE_INPUT_GLSL`, shadows, noise, the body's `SurfaceShading`
  GLSL and `terrain.frag`; uniforms are spread from the shading (same objects as the sphere, so lazily loaded maps
  appear on both). One Mesh per leaf, `position = (body − camera) + R_fixed·centre` in float64.
- Hand-off: the provider wants a body below 3 R (3.05 R once active) when its 6 roots are resident; the sphere
  keeps far views. `uMorph = clamp((3R − alt)/0.5R)` flattens the relief and the normals onto the ellipsoid at 3 R
  (matching the sphere) and blends them in by 2.5 R: a short geometric crossfade without a pop.
- Fragment detail: 5 bands (10 km … 1 m) of periodic noise anchored at `frac(cam/λ/P)·P` (float64 origin =
  camera, `localPos` = camera-relative body-fixed), perturbing normals and ±6% radiance; bands fade out below
  4 pixels of the grazing-angle footprint.

## Ground and walk mode

- GroundProvider `terrain` (priority 10): `heightAt = groundRadius(dir, MAX_LEVEL) − a`, the radial ray
  intersected with the float64 triangle (diagonal p00–p11) of the finest grid. P4-P: it used the level of the leaf
  drawn under `dir`, which changes as the view turns (frustum, tile cap, loading); a coarse leaf sits metres to
  hundreds of metres below the surface (chord sag), so walkers fell and were thrown back up ("clicking to look
  throws me back"). The mesh near the camera converges to this grid (leaves within `NEAR_KEEP` are never culled).
- Walker re-seat (`RESEAT_THRESHOLD` 0.5 m): a standing walker whose ground changes by more than that at the same
  spot (height source swapped, e.g. surfaces replacing the Moon's default relief after boot) stands on the new
  ground instead of free-falling. Walking off a real ledge still falls.
- Walk (`src/camera/walk.ts`): G toggles within 10 km of a solid surface (capture-phase listener; elsewhere G keeps
  the UI's "fly to selection"). Eye 1.7 m, `g = GM/R²`, Space jumps at 2 m/s (Moon apex `v²/2g` = 1.23 m),
  W/A/S/D 1.4 m/s, Shift 4.2 m/s, mouse/arrows look (yaw about the local vertical, pitch ±89°). The camera anchors
  to `<body>.fixed`, so the walker turns with the planet. Bookmarks with `mode: 'walk'` enter it on arrival.

## Bookmarks

- `moon-low-orbit`: `moon.sunview`, 50 km above a point with the Sun 16° up, looking along the surface towards the
  terminator, pitched 20° down (horizon in the upper third). EV 14.
- `apollo11-2m`: `moon.fixed`, 0.674° N 23.473° E, eye 2 m above the max-level mesh, jd 2461390.0 (2026-12-15,
  Sun ≈ 10° up in the east, Earth ≈ 60° up in the west), facing Earth's azimuth with Earth near the top edge,
  fovY 80°, walk mode (the walker then settles the eye to 1.7 m above the drawn mesh). EV 14.
- Test only (`?test=1`): `terrain-jitter-a` / `-b` (same site, free mode, time frozen, b = a + 1 mm east).

## Performance (P4-P)

- Presets (`src/core/quality.ts`): error target 8/6/4/3/2 px and tile cap 64/128/224/384/512 for
  potato/low/medium/high/ultra. Medium used 2 px with 512 tiles (heavier than high) and ran ~30 fps walking on the
  owner's laptop; ultra (1024 tiles) ran ~15 fps. apollo11-2m on medium at 1280×720 now draws 165 calls, 428k
  triangles with 224 resident tiles (`tests/e2e/input.spec.ts` budget).
- The error target is in drawing-buffer pixels, so dynamic resolution also lowers the tile count when it scales down.
- Moon bookmarks are re-placed when the surfaces module's relief replaces the default one (it is ~560 m lower at
  Tranquility Base; apollo11-2m used to start ~560 m up). apollo11-2m now puts Earth ~4° below the top edge (was 6°)
  so the textured near ground fills the lower band the surfaces checks probe.

## Known gaps

- `renderer.stats().tiles` is still 0; `terrainStats()` has the numbers (request in `docs/requests/terrain.md`).
- No geomorphing between levels (small pops at splits); T-junction cracks are hidden by skirts.
- No cast shadows (terrain self-shadowing); crater interiors facing away from a low Sun are dark by shading only.
- The tree under a walker at 2 m converges to level ≈ 10 on potato (64-tile cap: every split keeps its visible
  siblings and the split node resident) versus level ≈ 19-21 on medium, so potato ground looks smooth; the
  fragment detail bands add the small-scale texture.

## R2b integration changes

- Remembered bounds: on overflow of `KNOWN_BOUNDS_MAX` only evicted nodes are forgotten (resident tiles are re-seeded), and `select()` falls back to a resident tile's own bounds, so a body can no longer vanish after long flights.
- Failed builds back off per key (1 s doubling to 30 s); after `SPEC_FAILURE_LIMIT` consecutive failures the system reports once and falls back to the default spec (or drops terrain for bodies in `NO_DEFAULT_RELIEF`). A failed height-module load stays cached for 30 s.
- `NO_DEFAULT_RELIEF` (earth, venus, titan): these bodies get terrain only from a registered `HeightSourceSpec`, never the fbm default.
- A shading may scale the fragment detail bands with `uniforms.uDetailStrength`, or mask them per pixel by defining `SURFACE_DETAIL_MASK` and `float surfaceDetailMask(SurfaceInput s)` in its GLSL (Earth: land only).
- One shared index buffer for all tiles; `select()` is skipped when the view and the tile set are unchanged.
- `moon-low-orbit` now has the Sun 9° up so the terminator lies inside the horizon.
- Medium preset: `terrainSse` 2 px, `terrainTileCap` 512 (1280×720: ≤ 325 calls, ≤ 0.8M triangles, ≤ 216 MB GPU on the Phase 2 bookmarks).
