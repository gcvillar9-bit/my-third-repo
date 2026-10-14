# P4-P status: performance and owner-reported bug fixes

**Done**

- Snap-back bug, root cause: Moon bookmarks were placed on the default relief, which the surfaces module replaces
  after terrain init (~560 m lower at Tranquility Base). The walker also used the LOD drawn under the feet, which
  changes as the view turns, so it fell and was thrown back up. Fixes: the ground query uses the finest grid,
  bookmarks are re-placed when the real relief loads, and a standing walker re-seats when its ground changes.
  Hardening: the `#b=` hash is replaced at once, stale hashchanges are ignored, and drags end on lost capture or
  on a move with no button pressed. `tests/e2e/input.spec.ts` covers this in a live session (`?test=1&live=1`).
- Dynamic resolution (`src/render/dynamic-res.ts`): on by default (setting under Performance), shown in the
  `?perf=1` readout, never active in tests.
- Presets: terrain 8/6/4/3/2 px with caps of 64/128/224/384/512 tiles. Atmosphere knob is 8/12/24/48/48.
- Atmosphere: the march runs at half resolution and is upsampled with depth (path length) awareness, which cuts
  earth-dawn-400km work about 4x on medium. Mars, Venus and Titan use the same pass.
- `tests/e2e/perf.spec.ts`: budgets for draw calls, triangles and ray-march work (pixels × steps).

**Gaps**

- Not profiled on real hardware: the gains are estimated from step and pixel counts only.
- Earth's cloud shell and surface shader cost were not changed. Earth 4k maps were already limited to high/ultra.
- Dynamic resolution measures whole frames, so CPU-bound scenes (many draw calls) gain little when it scales down.
- The terrain error target is in drawing-buffer pixels, so a resolution step can change the LOD (small pops).
- The surfaces apollo11-2m texture check passes with little margin (0.011 vs 0.01). See requests.

**Requests**: `docs/requests/p4-perf.md`.
