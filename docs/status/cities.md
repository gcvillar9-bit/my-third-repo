# Cities through history (Phase 3) status

Work: `claude/eloquent-meitner-tqq1zc` (PR gcvillar9-bit/my-third-repo#12). Docs: `docs/modules/cities.md`.

## Done

- Module `src/modules/cities`: 233 hand-entered historical cities (Jericho 8000 BC on, `TOWNS_FROM_YEAR`, the
  one start date of labels, validity and docs) with populations over time, styles by period and sources, plus
  1163 Natural Earth cities of today from 1950 (ruins nearby no longer hide Zibo, St. Louis or Mosul); 17
  monuments (Hagia Sophia a church until 1453, then a mosque).
- Labels 50 m above the ellipsoid: the largest cities of the date within the camera's horizon cap (taken from
  the ground under the camera, so high plateaus too), so none float over the street scene;
  `citiesAtJd`/`monumentsNear` for the ground.
- Life module draws towns: 36 procedural building kinds in 17 styles on street blocks (big lots for towers,
  insulae, terraces), landmarks at the centre, walls before 1800, townspeople, farmers after 6000 BC,
  livestock around towns; the terrain decides the modern coastline for life.
- Seven bookmarks (Giza, Babylon, Rome, Tenochtitlan, Paris, New York, Mediterranean labels); four e2e tests.
  Rome looks 4° east of north up a street at the Temple of Jupiter, 157 m away; its test counts temples and
  probes the temple at the view centre (pale marble, 0.6 < b/r < 1.4).

## Gaps

- Reba et al. (2016) dataset behind a personal-details guestbook, so the table is hand-entered (approximate).
- Circular towns around one centre; no rivers, harbours or real street plans; styles switch at once.
- No Byzantine church model (Hagia Sophia before 1453 uses the baroque church); dress follows the style period.
