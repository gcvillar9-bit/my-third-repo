# Smoothness pass (owner report: "the game feels weird")

Work: `claude/dazzling-euler-xy2z1w`. Measured in a live session (rAF loop, SwiftShader, dev server) with
every shader link timed (`getProgramInfoLog` waits) while flying from `earth-dawn-400km` to the ground.

## Found

- CPU side of a frame is cheap: over 400 frames of descent the main thread spent under 2% in JavaScript
  (frames, labels, terrain selection, life); GC about 1 ms per second. No per-frame JS hot spot.
- The hitches are shader links on first draw: 23 programs at boot, then mid-flight links that block the
  frame for the whole link (1.8 s on SwiftShader; hundreds of ms on a laptop GPU). Two sources:
  the surface/terrain program of a body when its renderable first draws, and the atmosphere's sky-view
  and aerial-perspective LUT programs the frame the camera enters the atmosphere (about 100 km up).

## Done

- `src/render/warm-up.ts`: with `KHR_parallel_shader_compile`, a renderable's programs are created when it
  is added (three.js `compile` against the layer's target, so the draw reuses them) and the object is kept
  out of the draws until every program reports linked (at most 180 frames). The surface manager
  (`src/app/loop.ts`) keeps the previous geometry provider drawn while the new one warms up. Off in tests
  and without the extension (programs then link on first draw as before). Unit tests for both.
- Atmosphere pass: the inside-only LUT materials are compiled on the first render and drawn once off-screen
  as soon as they report linked (second frame without the extension), so entering the atmosphere links
  nothing. Measured: the descent went from 3 mid-flight links (1.1-1.8 s of waits) to 0.

## Gaps

- Materials created later inside an already warm renderable (life and town models, clouds) and other
  ScreenPasses that start drawing on demand (lensing near a black hole) still link on first draw.
- Dynamic resolution steps reallocate every render target (one hitch per step, at most one per 1.2 s)
  and move the terrain LOD target (small pops); not changed.
- Not profiled on a real GPU: SwiftShader exposes no parallel compile, so the warm-up path was exercised
  with an emulated extension (no errors, same frame output) and its gain is by construction.
