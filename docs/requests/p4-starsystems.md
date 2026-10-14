# Requests from P4-C (starsystems, exoplanets, stars)

No contract changes. Notes for the integrator and other owners:

1. **build-stars (integrator / stars data):** HYG v4.1 clips `pmdec` at 9 999.99 mas/yr, so Barnard's Star's
   stars.bin velocity gives 10.03″/yr. The stars module patches it at load from `src/modules/stars/overrides.json`
   (Gaia DR3, 10.39″/yr). Baking the same row into `tools/build-stars.mjs` would fix the data at the source; the
   runtime override is idempotent and can stay.
2. **milkyway request 1 (panorama ×8) is not applied.** Raising `MILKY_WAY_LUMINANCE` changes the calibration that
   `mw-band-from-earth` (EV −8.5) and the 200-400 pc crossfade were tuned against, so it needs a joint pass with
   the milkyway e2e. Requests 2 (`milkyWayFade`, `FADE_START`, `FADE_END`, `MILKY_WAY_LUMINANCE` now exported
   from `stars/public.ts`) and 3 (100 kpc placeholder stars culled when the camera is > 1 kpc from the Sun) are done.
3. **Pre-existing e2e failure, not P4-C:** `blackholes: gaia-bh3-dormant` fails its lensing-diff ratio
   (0.248 < 0.3) on the dev tip 5a3455a with P4-C removed as well (checked); probably the merged Milky Way sky
   lowering the relative lensing contrast.
4. **Optional contract field (later):** a `Bookmark.settings?: Record<string, SettingValue>` would let
   `orion-lines-from-earth` switch the constellation lines on when picked from the palette; today that only
   happens for the initial `?b=` / `#b=` view (or with Shift+C).
5. **Search UX:** star and exoplanet-system search targets are static bookmarks (J2000 positions, 0.05 pc and
   0.005 pc stand-offs). A `SearchEntry.target` resolved at selection time would allow arriving at a few AU.
