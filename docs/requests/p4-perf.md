# Requests from P4-P (performance and owner-reported bugs)

1. **surfaces**: `tests/e2e/surfaces.spec.ts` "apollo11-2m: cratered skyline and textured regolith" measured its
   texture threshold (0.01) on a view that really stood ~560 m above the drawn relief (the Moon bookmarks were
   placed on the default relief that surfaces replaces after terrain init). The bookmark now stands 2 m above the
   real relief and puts Earth ~4° below the top edge; the check reads 0.011, so it passes with little margin.
   Please re-baseline the band or the threshold for the true 2 m view.
2. **contracts (optional, next freeze)**: `QualityKnobs` could carry the dynamic-resolution bounds
   (`dynamicMin`/`dynamicMax`); they live in `DYNAMIC_SCALE_BOUNDS` in `src/core/quality.ts` for now.
3. **milkyway / blackholes**: nothing needed. Both are already cheap on medium (1/4-res march × 48 steps,
   1/2-res lensing × 64 steps) and are budgeted in `tests/e2e/perf.spec.ts`; a pass that caches its result while
   the view is still is measured after a resize.
4. **blackholes**: `tests/e2e/blackholes.spec.ts` "gaia-bh3-dormant lenses the star field" fails on the dev tip
   5a3455a itself (diff/total 0.2478 < 0.3, identical value with and without P4-P), presumably since the Milky Way
   merge changed the background the lensing cube captures. It is the only failure of the full e2e suite on this
   branch (47 of 48 pass).
