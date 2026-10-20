# Deep-time Earth (Phase 1) status

Backup of the pre-change state: branch `backup-before-deep-time` (0650d37). Work: `claude/eloquent-meitner-tqq1zc`.

## Done

- Step 0, time safety: capped TT → UT solve (`astroTimeFromTt`; astronomy-engine's own loop never returns for some
  instants, e.g. 365 Ma or a day near 3743 BCE, and froze the tab); `toDate`/`jdToIso` null outside the Date range;
  the clock carries float64 rounding so 1× still advances at 66 Ma.
- Step 1, day and night in deep time: `foldJd` (core `time.ts`) folds beyond J2000 ± 10 kyr onto J2000 ± 2 yr with a
  1461-day period; fast-warp hold (> 1e6 s/s) so deep warps do not strobe; `core.planets` is `approximate` beyond.
- Step 2, time model: `src/core/geotime.{ts,json}` (years BP from 1950.0, ICS labels, presets, `parseUserInstant`),
  `≈ 66.0 Ma · Late Cretaceous` and `500 BC …` display, warp to 1 and 10 Myr/s, deep-past share links.
- Step 7, time bar: type `66 Ma`, `21 ka`, `500 BC`, `1066`, ISO (UTC) or pick an era preset.
- Earth city lights fade out before ~1880 (electricity-generation proxy, `earth/city-lights.json`).
- Adversarial review (5 lenses, 2 skeptics per finding): 20 upheld findings fixed in 5da930f.

## Blocked (needs network)

- Steps 3, 5, 6 (paleo maps, `src/modules/paleo/`, bookmarks, e2e) and the Earth GLSL hooks (`EARTH_PALEO`,
  `uEarthCloudMap`), which land with their first consumer. Allow `zenodo.org`, `www.ngdc.noaa.gov` and
  `www.ncei.noaa.gov` in the environment's network settings (still proxy 403 on 2026-10-20). Then
  `tests/unit/tools/manifest.test.ts` must also accept those hosts. Plan: `/root/.claude/plans/i-want-to-make-snazzy-cocke.md`
  (session-local; the steps are summarised in the PR/commit history).

## Gaps and notes

- ICS boundary ages in `geotime.json` were hand-entered and not re-checked against the 2024/12 PDF (host blocked).
- Pre-existing, not fixed: `?t=<other date>` with a body-fixed bookmark (e.g. `earth-night-lights`) places the
  camera on the wrong side of Earth (all-white frame); reproduced on 0650d37.
- Initial JS 470.0 KB gzip (base 466.5 KB; the 413.6 KB in older status notes is out of date).
