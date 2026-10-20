# Deep-time Earth (Phase 1) status

Backup of the pre-change state: branch `backup-before-deep-time` (0650d37). Work: `claude/eloquent-meitner-tqq1zc`.

## Done

- Time core: capped TT → UT solve (astronomy-engine's loop hung the tab at e.g. 365 Ma); clock rounding carry;
  ephemeris fold beyond ±10 kyr so day and night keep turning, with a fast-warp hold; Myr/s warp; deep-past links.
- Time bar: type `66 Ma`, `21 ka`, `500 BC`, `1066`, ISO (UTC), or pick an era preset; `≈ 66.0 Ma · Late Cretaceous`.
- City lights fade out before ~1880.
- Paleo module (docs/modules/paleo.md): ice-age sea level and ice sheets (7 ka – 3 Ma) over today's imagery; a
  synthetic surface baked from the PALEOMAP maps (0–540 Ma) with a moisture model fitted to today's Earth; zonal
  clouds; four bookmarks and e2e checks (Pangaea, seaway, LGM ice, 66 Ma sunset). Data 2.9 MB, lazy.
- Two adversarial reviews; the first one's 20 upheld findings fixed in 5da930f.

## Not done (plan steps 8 and 9, and later phases)

- Smooth plate motion (continents cross-fade between 5 Myr maps); paleo terrain heights for walking in deep time.
- Phase 2 (dinosaurs, apes, humans), Phase 3 (cities through history), Phase 4 (modern HD detail).

## Gaps and notes

- ICS ages in `src/core/geotime.json` hand-entered, not re-checked against the 2024/12 PDF.
- Biome moisture fit is about 60% class agreement today (misses monsoons and some rain shadows).
- Pre-existing, not fixed: `?t=<other date>` with a body-fixed bookmark (e.g. `earth-night-lights`) lands over
  daylight (all-white frame); a separate session is fixing it.
