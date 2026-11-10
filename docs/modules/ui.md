# UI shell (P1-D)

`src/ui/`: Preact + `@preact/signals`, dark glassy panels, DOM over the canvas in `#ui`. Entry
`mountUi(root, ctx): UiApi` (contract `MountUi`), called by boot before module init.

## Visibility

- Shown by default; hidden in test mode unless `?ui=1`; `?ui=0` hides it anywhere. When hidden, the UiApi still
  works (settings, selection, label sources are accepted but not drawn, toasts go to the console), so test-mode
  screenshots are unaffected.
- `setHudVisible(false)` (or key H) hides the HUD, time bar, info card and labels; captions and toasts stay.

## Parts

| File            | Role                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `index.ts`      | `mountUi`, style injection, frame hook (`render.onAfterFrame`), keyboard                        |
| `controller.ts` | Signals and actions: selection, info-card resolution, goto, copy link, HUD and time data        |
| `app.tsx`       | Components: palette, info card, time bar, HUD, settings panel, toasts, caption, help line       |
| `search.ts`     | `SearchIndex`: fuse.js over all SearchProviders plus built-in entries for bodies and bookmarks  |
| `labels.ts`     | Label overlay: projection, ray-sphere occlusion, greedy priority declutter (max 64), pooled DOM |
| `settings.ts`   | `SettingsStoreImpl` (UiApi.settings)                                                            |
| `format.ts`     | Speed, distance, light-time, rate, instant and log-scale formatting                             |
| `debug-gui.ts`  | `?debug` lil-gui (debug settings, EV compensation, quality), lazy-loaded                        |
| `actions.ts`    | `uiActions.openHelp()` / `openExplore()` for callers outside the UI tree (onboarding card)      |
| `explore.ts`    | Explore catalogue: themed groups of ids resolved against the search index (`resolveExplore`)    |

- **Palette** (`/` or Ctrl+K): ranking = fuse score − bonus (exact name or alias 1, prefix 0.5, word prefix 0.25)
  − 0.01 · priority. Provider entries win over built-ins with the same id; `query()` results are merged. Built-ins:
  every registered Body (`target` = body id) and Bookmark (`bookmark:<id>`, low priority). Enter runs
  `camera.goto(target)` and selects the entry (a bookmark selects its `lookAt`).
- **Info card:** first non-null InfoProvider, else a card built from the Body (radius, gravity, albedo, Teff,
  `simulated` badge). Refreshed once per second while open. "Fly there" uses the entry target.
- **Time bar:** reverse/slower, play/pause, faster (`clock.warpStep`, up to 10 Myr/s), rate text, the date
  (`formatInstant`: UTC, `500 BC …`, or `≈ 66.0 Ma · Late Cretaceous` in deep time), Now, validity badges from
  `validityBadges(clock.validity())`. Clicking the date opens a text field parsed by `parseUserInstant`
  (`src/core/geotime.ts`: `66 Ma`, `21 ka`, `3 million years ago`, `500 BC`, `1066`, ISO, `now`) with `ERA_PRESETS` as
  a `<datalist>`; picking a preset jumps at once, Enter jumps, Esc cancels, unreadable text shows a warning toast.
- **HUD:** speed (`formatSpeed`: m/s, km/s, c, ly/s, Mpc/s), target with surface distance and light-time, the
  position over the nearest world when within two radii (`formatLatLon`: planetocentric latitude, east longitude,
  height above the ground; `.cz-hud-pos`), action buttons (Land / Walk / Take off, Orbit / Free flight), a log
  scale bar 1 m to 1e27 m with landmarks (marker = target distance or nearest-surface altitude), breadcrumbs of the
  camera frame path (click a body to fly there) and the camera mode. Updated at 10 Hz (every frame in test mode).
  The HUD element carries `data-target`, `data-traveling`, `data-frame` and `data-mode` for e2e.
- **Labels:** registry bodies automatically (planets, dwarfs, stars, galaxies always; moons and small bodies within
  3000 radii), plus `addLabelSource` sources. Target +1000 and selection +500 priority. Labels carry
  `data-label-id`, `data-x`, `data-y` (projected anchor in CSS px). Click selects, double-click flies.
- **Copy link:** `shareUrl` + `copyLink` from `src/app/url-state.ts`.
- **Settings panel (⚙):** quality preset (`quality.set`) and every non-debug SettingDef grouped by `group`.
  Values persist in localStorage when `persist` (not in test mode). `onChange` runs at registration and on change.
- **Topbar:** Search, Explore (`.cz-explore-btn`), Tours (`.cz-tour-btn`: opens the tour menu, or stops the running
  tour), Photo (`.cz-photo-btn`), Copy link, mute, full screen (`.cz-full-btn`, only where the browser has the
  Fullscreen API), Settings and `?`. Below 900 px the buttons show icons only. Palette entries of kind `tour` start
  that tour.
- **Explore (`X`, `.cz-explore`):** `EXPLORE_GROUPS` in `explore.ts` lists body ids, bookmark ids, `tour:<id>` and
  exact entry names by theme; `resolveExplore` drops what is not registered, never lists an entry twice and
  collects unlisted bookmarks under "More places" (so a new module's bookmarks appear without touching the
  catalogue; add them to a group for a better place). Bookmarks whose title ends in `(test)` are kept out of
  search and Explore outside test mode.
- **Tours menu (`T`, `.cz-tours`):** every `registry.tours()` entry with its description.
- **Controls panel (`?`, `.cz-help-panel`):** `HELP_SECTIONS` (keys by theme, plus touch gestures); `HELP_TEXT` is
  the same content as one line.
- **Selecting in the view:** a click or tap that does not travel more than 5 px selects the body under it
  (`UiController.pick`: nearest disc containing the point, else the closest centre within 12 px; the world the
  camera stands on is never picked); a double-click or double-tap flies there. Drags stay look drags.
- **Landing:** `UiController.land(id?)` calls `camera.land` (arriving at the world first when far away). The Land
  button shows in the info card and the HUD for bodies `terrainEligible` accepts (rocky and icy worlds, not stars
  or gas giants); the HUD offers Walk within reach of a surface and Take off when walking. `Shift+G` lands.
- **Accuracy chip:** the time bar shows one chip ("✓ real data" or "≈ n approximate") from
  `validityBadges(clock.validity())`; clicking it lists every model (`.cz-accuracy-panel`).
- **Touch:** `TouchControls` (`.cz-touch`): a movement stick and up/down hold buttons feeding
  `camera.setVirtualInput`. Shown on coarse pointers or after the first touch; setting `ui.touchControls`
  (auto / always / never). Looking (one finger) and pinch-to-fly live in the camera controller.
- **UI-owned settings:** `ui.labels` (Labels, `Shift+L`) and `ui.touchControls`, registered straight into the store.
  The Quality select has "automatic" (`src/app/auto-quality.ts`) plus the five presets; a fixed choice is stored. Flying to a `LINE_BOOKMARKS` bookmark
  (palette, labels, info card, tours) switches the constellation lines on (`wantsLines` in `controller.ts`).
- **Photo mode:** `html[data-photo]` (set by the photo module) hides the shell, labels, caption, toasts, tour
  overlay and onboarding card through a rule in `styles.ts`.
- **Perf overlay:** setting `render.perfStats` (group Performance, off, persisted) is registered by boot and drives
  `src/app/perf-overlay.ts` (stats-gl created/destroyed at runtime, `.cz-perf-stats` + `.cz-perf-res` line, GPU
  panel only with `EXT_disjoint_timer_query_webgl2`, else "GPU n/a"). `?perf=1` forces it on at boot.
- **Sound:** the topbar speaker button (`.cz-mute-btn`, `aria-pressed` = muted) and `M` toggle `audio.enabled`
  through the settings store (`AUDIO_ENABLED_SETTING` from `src/modules/audio/public.ts`); both are absent or no-ops
  without the audio module.

## Keys

`/` or Ctrl+K search · `X` Explore · `T` tours · `,` `.` time warp · K pause/play (pauses the tour while one runs) ·
N now · I info card · G fly to selection · Shift+G land · Home back to Earth · O orbit/free · H hide UI · L copy
link · M mute/unmute sound · Shift+O orbit lines · Shift+L labels · Shift+F full screen · ? controls · Esc closes
the topmost panel (photo mode first, then the tour). P is photo mode, handled by the photo module
(`src/modules/photo`); UI keys are ignored while it is on. Keys are ignored while typing in inputs. The camera owns
WASD, R/F/Space/C, Q/E, arrows, `[` `]` and plain G near a surface (walk).

## Tests

- Unit (`tests/unit/ui/ui.test.ts`): search ranking, HUD formatting, declutter/projection/occlusion, settings,
  visibility rule. `shell.test.ts`: Explore catalogue and resolution, search by exact name, picking, the
  latitude/longitude readout, help sections.
- E2E (`tests/e2e/shell.spec.ts`): Explore to the Moon, tours menu, controls panel, accuracy chip (@smoke); click to
  select and Land to walking; a touch brings up the stick and the stick flies; a real (non-test) session lifts the
  splash, shows the welcome card and remembers the quality (@smoke).
- E2E (`tests/e2e/ui.spec.ts`): `?ui=1`, type "Debug sph" in the palette, Enter, arrive within 12 s (60 frames per
  simulated second), target and info card show the debug sphere.
