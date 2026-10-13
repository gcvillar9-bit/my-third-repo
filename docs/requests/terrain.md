# Requests from P2-A terrain

1. **Stats:** wire `terrainStats().tiles` (from `src/modules/terrain/public.ts`) into `renderer.stats().tiles`
   (currently hard-coded 0). `terrainStats()` also reports drawn `leaves` and `inflight` requests.
2. **G key:** the UI binds G to "fly to the selection". The camera now claims G in a capture-phase window listener
   only when walk mode can toggle (walking, or within 10 km of a solid surface) and stops propagation; elsewhere the
   UI's G still works. Please document G in the help overlay and consider a HUD badge for the camera mode
   (`camera.mode === 'walk'`); terrain currently shows a toast on entering and leaving walk.
3. **Quality knob:** `terrainSse` medium is 4 px while DESIGN Phase 2 says "2 px on medium". Terrain uses the knob as
   given (`eps = cell/2`, so the vertex spacing is about 8 px on medium). Adjust the knob if 2 px is wanted.
4. **P2-C:** registering a `HeightSourceSpec` replaces `fbm-craters-lite` for that body automatically (tiles reset).
   If `surfaces` initialises after `terrain`, the `apollo11-2m` eye height was computed from the default heights;
   walk mode re-seats it on the real mesh, so either order works. Consider `dependsOn: ['terrain']` for P2-C.
5. **Optional contract field (not needed now):** a `GroundProvider.levelHint` or similar would let collision ask for
   the finest available ground instead of the drawn LOD; the current behaviour (ground = drawn mesh) matches
   DESIGN's "identical to the mesh".
