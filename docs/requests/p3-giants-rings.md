# Requests from P3-A giants + rings

No contract changes. Items for the integrator and the solar-system owner:

1. **Landed on this branch, outside P3-A ownership (please review):** `src/modules/solar-system/render/sphere.ts`,
   `updateOccluders`: a `seen` set so a caster named both as a default candidate and by an `OccluderProvider` is
   counted once (3 lines). Without it, the giants' transit provider (Galilean moons, Titan) squared the penumbra
   visibility. P3-B's eclipse provider (the Moon on Earth) benefits the same way.
2. **Ring v1 cleanup (solar-system):** the rings module removes `solar-system.rings.saturn` at init via
   `registry.removeRenderable`. `createRings` in `render/extras.ts`, `glsl/rings.glsl` and the "Saturn's rings v1"
   and "Known gaps" (ring shadow, Uranus rings) paragraphs of `docs/modules/solar-system.md` can go.
3. **Point LOD tint (solar-system):** giants' maps now load through the priority-10 shading, so the default shading's
   `onTint` never runs for them and their photometric points stay untinted. Suggest exporting a
   `setPointTint(bodyId, rgb)` (or computing tints from the map path independently of the winning shading) in
   `public.ts`; giants would call it with the mean colour it already computes.
4. **Optional, later:** ringshine (light reflected by the lit ring face onto the night side) needs the ring
   profile in the planet's shading, which `rings/public.ts` already exposes; not built (lean plan).
