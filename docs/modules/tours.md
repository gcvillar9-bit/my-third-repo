# tours (P5-B)

`src/modules/tours/`: guided tours on the frozen `TourDef` / `registry.addTour` contract.

## Files

| File             | Role                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `player.ts`      | `compileTour` (TourDef → fixed timeline) and `TourPlayer` (`tick(dtReal)`, pause, next, stop)   |
| `cosmic-zoom.ts` | The flagship tour `cosmic-zoom` (11 stops, about 3 minutes)                                     |
| `overlay.ts`     | DOM overlay: title, stop counter, progress, Pause / Next / Exit; data attributes for e2e        |
| `index.ts`       | Module: registers the tour and a palette entry per tour, wires actions to camera/clock/ui       |
| `public.ts`      | `tours` control (start, stop, togglePause, next, status), `COSMIC_ZOOM_ID`, `TOUR_ENTRY_PREFIX` |

## Schedule (deterministic)

A tour compiles into instant events plus orbit spans before it starts; frame timing never changes the order or the
scheduled times (unit test with a fake clock at dt = 1/60, 0.37 and 5 s).

- `goto`: `camera.goto(target, { duration })`, default 7 s, blocking. Flights are not awaited: the next step starts on
  schedule even if the user interrupts.
- `orbit`: rotates the camera about the target body around the camera's up axis (skipped while flying or walking).
- `wait` blocks; `caption` is instant and stays until the next caption, the end, or `seconds` later.
- `timeRate`, `setTime`, `setting` are instant; `speak` is ignored (narration was cut).
- **Missing targets:** a `goto` whose bookmark/body does not exist when the tour starts is skipped together with the
  steps up to the next `goto` (its captions and waits). Cosmic Zoom uses `m31-approach`, `virgo-cluster` and
  `cosmic-web-500mpc` from the galaxies/cosmic-web package and simply skips them when absent.
- Ending or exiting clears the caption and restores the time rate from before the tour. Bookmarks in
  `LINE_BOOKMARKS` (starsystems) switch the constellation lines on.

## Controls

- Start: palette "Tour: Cosmic Zoom" (entry kind `tour`, id `tour:<id>`), the UI's ▶ Tour button, the onboarding card,
  or `?tour=<id>` (starts on the first frame). `?tourspeed=<k>` (max 100) plays k times faster (e2e uses 20).
- Esc exits (not while photo mode is on: Esc leaves photo mode first). `K` pauses the tour while one runs (UI key
  handler). Overlay buttons: Pause/Resume, Next (skip to the next stop), Exit.

## Cosmic Zoom captions (sources: rounded textbook values)

Moon 3,474 km, 384,400 km, 1.3 light-seconds; ISS altitude ~400 km, period ~92 min; light to Earth 8.3 min and to
Neptune ~4.2 h; Alpha Centauri 4.37 ly, the Sun appears in Cassiopeia; Milky Way ~100,000 ly across, Sun ~26,000 ly
from the centre; Sgr A\* 4.3 million solar masses; M31 2.5 million ly; Virgo cluster ~16.5 Mpc (54 million ly),
more than 1,000 galaxies.

## Tests

- Unit `tests/unit/tours/tours.test.ts`: compiled times, missing stop skipped with its captions, same actions for
  any tick size, speed scaling, pause/next/stop, Cosmic Zoom stop list and skip behaviour.
- E2E `tests/e2e/tours.spec.ts` (@smoke): `?tour=cosmic-zoom&tourspeed=20&ui=1`, captions change, overlay targets
  advance through the first 3 stops, the camera passes through 3+ anchor frames, Esc exits, no errors.
