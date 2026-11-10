# Requests from the comets package

Nothing blocks the package; these are for the integrator.

1. **Orbit-lines switch.** Comet orbit lines read `ctx.ui.settings.get('solar-system.orbits') !== false` every
   frame. That setting does not exist on this branch's base commit, where the lines are simply always on. Nothing
   to do once the branch is merged onto a main that registers the setting.
2. **`E2E_CHROMIUM`.** `playwright.config.ts` on this branch's base commit does not read `E2E_CHROMIUM` yet, so
   the spec was run with a throwaway wrapper config (kept outside the repo) that adds
   `launchOptions.executablePath`. On main, `E2E_CHROMIUM=… E2E_PORT=… pnpm e2e -- tests/e2e/comets.spec.ts` should
   work as is.
3. **Size guard (optional).** `data/comets/comets.json` (17 KB) is fetched during module init, before the first
   frame. Add it to `BOOT_PATH` in `tools/size-guard.mjs` if the boot-path total should count it.
4. **Upstream data.** The `C 2023 A3 (Tsuchinshan-ATLAS)` row of Celestia `comets.ssc` has a mean anomaly that puts
   perihelion on 2024-09-18 instead of 2024-09-27.7 (it reads like a digit too many: 359.99998858 for 359.9998858).
   `catalog.json` overrides the perihelion time by hand. Worth reporting to CelestiaContent.
5. **Planet orbit lines in comet views.** In `halley-1986` and `hale-bopp-1997` the planets' orbit lines and the
   visibility-boosted asteroid belt share the frame. They belong to solar-system and smallbodies; nothing was
   changed there.
