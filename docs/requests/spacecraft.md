# Requests from the spacecraft module

No contract changes. Nothing below blocks the module; each item is shimmed or noted.

1. **Walk mode on spacecraft.** `src/camera/controller.ts` counts `spacecraft` as SOLID (right: the camera
   stops at the craft's radius sphere), but `enterWalk` then lets G start walk mode within 10 km of the ISS
   and stands the camera on a 55 m sphere with the gravity of a rock. Suggested: skip bodies of kind
   `spacecraft` in `enterWalk`.
2. **Bookmark ids shadow body ids.** `CameraController.goto(id)` resolves a bookmark before a body, so a
   bookmark called `hubble` would turn the search entry for the body `hubble` into a jump to the bookmark's
   date. The module therefore names its bookmark `hubble-over-earth`; a unit test guards the rule. A check in
   `Registry.addBookmarks` (warn on a clash with a body id) would catch this for every module.
3. **Label threshold.** `src/ui/labels.ts` labels non-"always" kinds only within 3000 radii, which is 165 km
   for the ISS. The module adds its own label source beyond that. A per-body `labelRange` (optional field)
   would let small bodies say how far their label should reach.
4. **Orbit-lines setting.** Rings and paths follow `ui.settings.get('solar-system.orbits') !== false`, as
   asked; on this branch's base commit the setting does not exist yet, so they are always on here.
5. **E2E browser override.** This branch's `playwright.config.ts` predates the `E2E_CHROMIUM` override, so
   the spec was run with a throwaway config outside the repository that adds `executablePath`; nothing in
   the repository was changed for it.
