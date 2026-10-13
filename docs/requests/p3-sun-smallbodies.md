# Requests from P3-B (sun, smallbodies, eclipses)

There are no contract changes. Each item below is shimmed inside P3-B's own files.

1. **solar-system Sun v1 glow.** The `sun` module removes the renderable `solar-system.sun-glow` at init
   (`registry.removeRenderable`), because its 2e-4 aureole would outshine the corona 100× in totality.
   Suggested follow-up for the integrator: stop registering the glow, or register it only when no
   priority-10 Sun shading exists.
2. **Atmosphere and eclipses.** The atmosphere pass lights the sky with the full Sun. The eclipses module
   brackets it with two atmosphere-stage passes (orders −100 and 100) that scale its contribution by the
   visible solar-disk fraction. A cleaner long-term fix would be an optional sun-visibility factor in the
   atmosphere composite (`uSunE · f`), which would also keep extinction on the corona.
3. **solar-system default Sun shading.** It may still load the v1 granulation texture lazily even though the
   priority-10 shading wins (not verified). If it does, it is harmless but costs one texture fetch.
