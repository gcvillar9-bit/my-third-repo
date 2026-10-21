# Modern Earth near the ground (Phase 4) status

Work: `claude/eloquent-meitner-tqq1zc` (PR gcvillar9-bit/my-third-repo#12).

## Done

- Terrain `softReset`: when the HD terrain block moves, drawn tiles and the CPU height function stay and the
  drawn tiles are rebuilt in place (no more whole-Earth tile reloads); unit test.
- HD terrain (AWS Terrarium) on by default outside test mode (setting default true); checked live.
- HD imagery (`earth/hd-imagery.ts`): NASA GIBS Blue Marble NG at about 490 m/px in a 4 x 4 tile block around the
  camera below 1200 km, blended into the day map; e2e with fixture routing and the refused-tiles fallback.
- Present-day vegetation and animals near the ground come from the life module (observed moisture, terrain coast).
- Credits for GIBS and Terrain Tiles.

## Gaps

- Imagery is today's at every date; no imagery finer than 490 m; no cast shadows or skylight on the ground.
