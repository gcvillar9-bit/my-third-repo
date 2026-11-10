# tours (P5-B)

`src/modules/tours/`: guided tours on the frozen `TourDef` / `registry.addTour` contract.

## Files

| File                                                                       | Role                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `player.ts`                                                                | `compileTour` (TourDef → fixed timeline) and `TourPlayer` (`tick(dtReal)`, pause, next, stop)   |
| `cosmic-zoom.ts`                                                           | The flagship tour `cosmic-zoom` (11 stops, about 3 minutes)                                     |
| `grand-tour.ts`, `earth-through-time.ts`, `black-holes.ts`, `starlight.ts` | Four more tours (see below)                                                                     |
| `overlay.ts`                                                               | DOM overlay: title, stop counter, progress, Pause / Next / Exit; data attributes for e2e        |
| `index.ts`                                                                 | Module: registers `TOURS` and a palette entry per tour, wires actions to camera/clock/ui        |
| `public.ts`                                                                | `tours` control (start, stop, togglePause, next, status), `COSMIC_ZOOM_ID`, `TOUR_ENTRY_PREFIX` |

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

- Start: palette "Tour: <title>" (entry kind `tour`, id `tour:<id>`), the UI's Tours menu (`T`), the Explore panel,
  the onboarding card, or `?tour=<id>` (starts on the first frame). `?tourspeed=<k>` (max 100) plays k times faster (e2e uses 60 and 100).
- Esc exits (not while photo mode is on: Esc leaves photo mode first). `K` pauses the tour while one runs (UI key
  handler). Overlay buttons: Pause/Resume, Next (skip to the next stop), Exit.

## Cosmic Zoom captions (sources: rounded textbook values)

Moon 3,474 km, 384,400 km, 1.3 light-seconds; ISS altitude ~400 km, period ~92 min; light to Earth 8.3 min and to
Neptune ~4.2 h; Alpha Centauri 4.37 ly, the Sun appears in Cassiopeia; Milky Way ~100,000 ly across, Sun ~26,000 ly
from the centre; Sgr A\* 4.3 million solar masses; M31 2.5 million ly; Virgo cluster ~16.5 Mpc (54 million ly),
more than 1,000 galaxies.

## The other tours

Every tour opens with a caption, captions each stop, ends with `goto earth-now` (that bookmark's `jd: 'now'` puts
the clock back) and returns any time warp to 1. A tour left early on another date shows a toast ("press N").

| Id                   | Stops                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grand-tour`         | Sun close-up, Mercury, Venus, Earth, Moon, Mars, asteroid belt, Jupiter with Io's shadow, Saturn, Uranus and its rings, Neptune, Pluto, the system at 23 days/s (about 4 minutes) |
| `earth-through-time` | Pangaea 250 Ma, Permian, Jurassic, the 90 Ma seaway, T. rex 66 Ma, Lucy 3.2 Ma, mammoth steppe 45 ka, the 21 ka ice age, Giza 2450 BC, Rome AD 117, New York 1935 (about 4 min)   |
| `black-holes`        | Cygnus X-1, Gaia BH3, S2 at pericentre, Sgr A\*, M87\* (about 2 minutes)                                                                                                          |
| `starlight`          | Orion's lines, Orion from 200 ly, the Orion Nebula, the Trapezium, the Sun from α Cen, TRAPPIST-1, the disc from 1 kpc up, the Milky Way from 100 kpc (about 3 minutes)           |

Caption figures (rounded published values): Sun 1.39 million km and 99.86% of the system's mass, granules ~1,000
km; Mercury 88 d, 430 / −180 °C; Venus 465 °C, 92 bar; Olympus Mons ~22 km, Valles Marineris ~4,000 km; belt mass
~3% of the Moon's; Saturn's main rings ~280,000 km across and ~10 m thick; Uranus tilt 98°, 84 yr, 13 rings, the first nine found by a stellar occultation in 1977; Neptune 30 AU,
winds ~2,000 km/h (NASA Solar System Exploration fact pages). Sea level −120 m at 21 ka; Rome ~1 million in AD 117;
PALEOMAP and Paleobiology Database for the reconstructions (see `docs/modules/paleo.md`, `life.md`, `cities.md`).
Cygnus X-1 21 M☉ at 2.2 kpc (Miller-Jones et al. 2021); Gaia BH3 33 M☉ (Gaia Collaboration 2024); S2 period 16 yr,
~7,700 km/s at pericentre, Sgr A\* 4.3 million M☉ (GRAVITY Collaboration); shadow diameter √27 r_s ≈ 2.6 horizon
diameters; M87\* 6.5 billion M☉ at 16.8 Mpc (EHT 2019). Orion's bright stars 250 to 2,000 ly (Hipparcos); Orion
Nebula 1,340 ly (Menten et al. 2007); TRAPPIST-1 40 ly, seven planets; Sun's galactic year ~230 Myr.

## Tests

- Unit `tests/unit/tours/tours.test.ts`: compiled times, missing stop skipped with its captions, same actions for
  any tick size, speed scaling, pause/next/stop, Cosmic Zoom stop list and skip behaviour; for every tour: a
  caption at each stop, readable caption times, total length, ends at `earth-now`, runs with optional stops missing.
- E2E `tests/e2e/tours.spec.ts` (@smoke): `?tour=cosmic-zoom&tourspeed=60&ui=1`, captions change, overlay targets
  advance through the first 3 stops, the camera passes through 3+ anchor frames, Esc exits, no errors.
