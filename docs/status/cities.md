# Cities through history (Phase 3) status

Work: `claude/eloquent-meitner-tqq1zc` (PR gcvillar9-bit/my-third-repo#12). Docs: `docs/modules/cities.md`.

## Done

- Module `src/modules/cities`: 233 hand-entered historical cities (Jericho 8000 BC on) with populations over
  time, styles by period and sources, plus 1145 Natural Earth cities of today from 1950; 17 monuments.
- Labels from orbit with approximate populations by date; `settlementsNear`/`monumentsNear` for the ground.
- Life module draws towns: 36 procedural building kinds in 17 styles on street blocks (big lots for towers,
  insulae, terraces), landmarks at the centre, walls before 1800, townspeople, farmers after 6000 BC,
  livestock around towns; the terrain decides the modern coastline for life.
- Seven bookmarks (Giza, Babylon, Rome, Tenochtitlan, Paris, New York, Mediterranean labels); four e2e tests.

## Gaps

- Reba et al. (2016) dataset behind a personal-details guestbook, so the table is hand-entered (approximate).
- Circular towns around one centre; no rivers, harbours or real street plans; styles switch at once.
