# Cosmos

Fly through a realistic universe in your browser, from your boots on the Moon to the cosmic web. Real ephemerides,
star and galaxy catalogues place everything that can be known; physically motivated procedural models fill
in the rest and are labelled "simulated" or "approximate". Everything renders live in WebGL2 at true scale, with
real luminances and an automatic exposure, like a camera.

**Live:** https://gcvillar9-bit.github.io/my-third-repo/ (desktop browser with WebGL2; Chrome, Edge, Safari or Firefox)

New here? Press **▶ Tour** (top right) for _Cosmic Zoom_, a three-minute guided flight from the Apollo 11 boot prints
to the largest structures in the universe and back home. Or press `/` and type any name.

## Features

**Solar System**

- The Sun, 8 planets, 27 moons and 6 dwarf planets or asteroids at their true positions for any date, with orbit
  lines and correct brightness when seen as points of light.
- A granulated, limb-darkened Sun with a corona; solar and lunar eclipses, with a finder that puts you on the ground
  at totality.
- A living Sun (labelled "simulated"): sunspot groups, faculae, prominences and filaments that follow the 11-year
  cycle and differential rotation, and an H-alpha solar filter (Settings > Sky).
- The asteroid and Kuiper belts: up to 400,000 bodies on GPU Kepler orbits (Kirkwood gaps, Hildas, Trojans,
  plutinos).

**Worlds**

- Seamless terrain from orbit to the ground on every rocky planet and moon: real Moon, Mars and Earth elevation plus
  procedural craters, dunes, ridges and calderas. Walk mode with real gravity and jumping.
- Physically based atmospheres (Earth, Mars, Venus, Titan): blue Earth skies, blue Martian sunsets.
- Deep-time Earth: type an age in the time bar (`21 ka`, `66 Ma`, `250 Ma`) and Earth follows: ice-age sea levels
  and ice sheets, then drifting continents, seas, deserts, forests and bare rock before land plants from the
  PALEOMAP maps (0–540 Ma, approximate). Day and night keep turning; city lights fade out before ~1880.
- A hero Earth with ocean glint, city lights, clouds and cloud shadows.
- Gas giants with drifting cloud bands, the Great Red Spot and moon-shadow transits; Saturn's and Uranus's rings at
  true radii with backlit glow and shadows both ways.

**Galaxy**

- 119,625 real stars (HYG) with true colours and brightness from any viewpoint, moving with their proper motions.
- 3D constellation lines that break apart as you travel; nearby stars become real suns up close; double stars
  (Alpha Centauri, Sirius) and more than 5,000 known exoplanets with habitable zones.
- The Milky Way: the night-sky band from Earth, and from outside a barred spiral built on the measured arms, bar,
  discs and dust, with 194 globular clusters.
- The Orion Nebula in 3D: a calibrated photograph turned into a glowing bowl you can fly into, with M43, the
  Trapezium at its true distance and an Astrophoto style.

**Black holes**

- Real light bending: Sgr A\* with its photon ring, Doppler-bright disk and the S-stars on their precessing orbits;
  M87\*, Cygnus X-1 with its supergiant companion, and the dormant Gaia black holes.

**Deep universe**

- 10,936 real galaxies (Celestia catalogue) placed in 3D, with oriented spiral and elliptical images up close:
  Andromeda, the Magellanic Clouds, M33, M81/M82, the Whirlpool, the Sombrero, Centaurus A and the Virgo cluster.
  Info cards give distance in light-years and megaparsecs and the light-travel time.
- Beyond them, a simulated cosmic web of filaments and voids out to 800 Mpc (labelled "simulated").
- The Great Attractor and Laniakea, our home supercluster: a toy model of the cosmic flow (about 1,000 animated
  streamlines converging on the Great Attractor, with "Our path" from the Milky Way) inside an approximate outline
  of Laniakea (after Tully et al. 2014), plus the Norma Cluster and the Shapley Supercluster. Settings > Sky >
  "Laniakea flows".

**Showtime**

- Guided tour _Cosmic Zoom_ (palette: "Tour: Cosmic Zoom", or the ▶ Tour button): pause, skip, Esc to leave.
- Photo mode (`P`): hides the interface, sets the field of view (5-120°) and exposure, and saves a PNG with a
  credits line.
- Search palette, info cards, time controls (warp up to 10 Myr/s, pause, any date: click the date and type `66 Ma`,
  `21 ka`, `500 BC` or `1066`, or pick an era), HUD with speed, distance and light-travel time,
  and shareable links to any view.

## Controls

| Key               | Action                                                                |
| ----------------- | --------------------------------------------------------------------- |
| `/` or `Ctrl`+`K` | Search and fly anywhere                                               |
| Drag              | Look around                                                           |
| `W` `A` `S` `D`   | Fly (`R` / `F` up and down, `Q` / `E` roll)                           |
| Wheel or `[` `]`  | Change speed                                                          |
| `,` `.`           | Slower or faster time (and backwards)                                 |
| `K`               | Pause or play time (pauses the tour while one runs)                   |
| `N`               | Back to the present                                                   |
| Click the date    | Type a date or an age (`66 Ma`, `21 ka`, `500 BC`, `1066`)            |
| `G`               | Go to the selection; near a surface, walk (`Shift` run, `Space` jump) |
| `O`               | Orbit or free camera                                                  |
| `I`               | Info card                                                             |
| `P`               | Photo mode                                                            |
| `Shift`+`C`       | Constellation lines                                                   |
| `H`               | Hide the interface                                                    |
| `L`               | Copy a link to this view                                              |
| `M`               | Mute or unmute sound (also the speaker button in the top bar)         |
| `?`               | Keyboard help                                                         |
| `Esc`             | Close panels, leave the tour or photo mode                            |

## Performance

- Quality presets in the settings panel (⚙): potato, low, medium, high, ultra. The default is cheap enough for a
  laptop; high and ultra add terrain detail, stars and memory.
- Dynamic resolution lowers the render scale when frames take too long and raises it again when there is headroom.
- Settings (⚙) > Performance > "Show performance stats (FPS / CPU / GPU)" turns the stats-gl meter on and off at
  runtime (remembered; `?perf=1` forces it on). Browsers without GPU timer queries show "GPU n/a". `?q=<preset>`
  picks a preset from the URL.

## Sound

Procedural sound (Web Audio, no audio files) starts after your first click or key press: an ambient pad that changes
chord from the ground to the cosmic web, a flight whoosh, wind inside atmospheres, a black-hole rumble, footsteps
when walking and a chime on arrival. Settings (⚙) > Sound has Sound on/off, Volume and "Realistic silence in space"
(only wind, footsteps and cues). `M` or the speaker button mutes.

## Data and credits

App code is MIT-licensed. Data and textures keep their upstream licences: see [CREDITS.md](CREDITS.md) (also served as
`credits.json`). Pluto's texture is licensed for non-commercial use only. Exported photos carry a short credits line.

## Run locally

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm dev            # http://localhost:5173/my-third-repo/
pnpm verify         # typecheck, unit tests, production build, size guard
pnpm e2e            # headless Playwright smoke tests (Chromium)
```

Processed assets are committed under `public/`, so CI never downloads anything. To rebuild them, run
`pnpm assets:fetch` first (about 135 MB into `.cache/`), then `pnpm assets:build && pnpm credits`.
`pnpm contact-sheet` tiles the e2e screenshots in `artifacts/` into one review image.
`pnpm build && pnpm preview` serves the production build under the same `/my-third-repo/` subpath as GitHub Pages.

Useful URL parameters: `#b=<bookmark>` opens a saved view, `?tour=cosmic-zoom` starts the tour, `?ui=0` hides the
interface, `?debug` shows the developer panel.

## Project docs

- `docs/DESIGN.md`: design and phase plan; demo links per phase in `docs/demos/`
- `docs/CONTRACTS.md`: module plug-in contracts; `docs/modules/*.md`: one page per module
- `CLAUDE.md`: conventions for contributors and agents
