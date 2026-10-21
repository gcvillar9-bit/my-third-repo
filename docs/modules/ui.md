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
| `actions.ts`    | `uiActions.openHelp()` for callers outside the UI tree (onboarding card)                        |

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
- **HUD:** speed (`formatSpeed`: m/s, km/s, c, ly/s, Mpc/s), target with surface distance and light-time, a log
  scale bar 1 m to 1e27 m with landmarks (marker = target distance or nearest-surface altitude), breadcrumbs of the
  camera frame path (click a body to fly there) and the camera mode. Updated at 10 Hz (every frame in test mode).
  The HUD element carries `data-target`, `data-traveling` and `data-frame` for e2e.
- **Labels:** registry bodies automatically (planets, dwarfs, stars, galaxies always; moons and small bodies within
  3000 radii), plus `addLabelSource` sources. Target +1000 and selection +500 priority. Labels carry
  `data-label-id`, `data-x`, `data-y` (projected anchor in CSS px). Click selects, double-click flies.
- **Copy link:** `shareUrl` + `copyLink` from `src/app/url-state.ts`.
- **Settings panel (⚙):** quality preset (`quality.set`) and every non-debug SettingDef grouped by `group`.
  Values persist in localStorage when `persist` (not in test mode). `onChange` runs at registration and on change.
- **Topbar:** ▶ Tour (`.cz-tour-btn`, starts Cosmic Zoom through `src/modules/tours/public.ts`) and Photo
  (`.cz-photo-btn`). Palette entries of kind `tour` start that tour. Flying to a `LINE_BOOKMARKS` bookmark
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

`/` or Ctrl+K search · `,` `.` time warp · K pause/play (pauses the tour while one runs) · N now · I info card ·
G fly to selection · O orbit/free · H hide UI · L copy link · M mute/unmute sound · ? help · Esc closes (photo mode first, then the tour).
P is photo mode, handled by the photo module (`src/modules/photo`); UI keys are ignored while it is on. Keys are ignored while typing in inputs. The camera
owns WASD, R/F/Space/C, Q/E, arrows and `[` `]`.

## Tests

- Unit (`tests/unit/ui/ui.test.ts`): search ranking, HUD formatting, declutter/projection/occlusion, settings,
  visibility rule.
- E2E (`tests/e2e/ui.spec.ts`): `?ui=1`, type "Debug sph" in the palette, Enter, arrive within 12 s (60 frames per
  simulated second), target and info card show the debug sphere.
