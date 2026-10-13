# Requests from P1-C solar-system

1. **`tests/e2e/smoke.spec.ts` (integrator-owned): relax the "empty frame" probe.** The boot test asserts that the
   mean of the whole canvas is `r + g + b < 0.03`. That held for the scaffold's empty scene, but boot now opens the
   `earth-now` bookmark (DESIGN: default start above Earth's dawn terminator), whose sunlit half-disk at the bookmark's
   EV 15 gives about 0.034. Suggested replacement: assert a finite, not blown-out frame (for example
   `r + g + b > 0` and `< 1.5`), or boot the smoke test with `&b=debug-sphere`. The engine and solar-system specs pass
   together on this branch; only this assertion fails.
