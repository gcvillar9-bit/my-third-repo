# Modern Earth near the ground (Phase 4) status

Work: `claude/eloquent-meitner-tqq1zc` (PR gcvillar9-bit/my-third-repo#12).

## Done

- Terrain `softReset`: when the HD terrain block moves, drawn tiles and the CPU height function stay and the
  drawn tiles are rebuilt in place (no more whole-Earth tile reloads); unit test.
- HD terrain (AWS Terrarium) on by default outside test mode from low quality up (setting default true;
  `?hdterrain=0` off, `?hdterrain=1` forced on); checked live. Superseded height functions are evicted per body
  in every thread and the base 2k rasters are decoded once, so block moves no longer grow memory.
- `terrainHeightGeneration(bodyId)` (terrain public API) tells ground placers when the height function changed.
- The HD block keeps hysteresis at zoom thresholds (0.15 levels) and tile edges (0.2 tile), so hovering there
  no longer swaps the height function back and forth; a dropped block's blob URLs are revoked (after 60 s).
- HD imagery (`earth/hd-imagery.ts`): NASA GIBS Blue Marble NG at about 490 m/px in a 4 x 4 tile block around the
  camera below 1200 km, blended into the day map; e2e with fixture routing and the refused-tiles fallback.
- Present-day vegetation and animals near the ground come from the life module (observed moisture, terrain coast).
- Credits for GIBS and Terrain Tiles.

## Gaps

- Imagery is today's at every date; no imagery finer than 490 m; no cast shadows or skylight on the ground.
