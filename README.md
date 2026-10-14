# Cosmos

Fly through a realistic universe in your browser, from your boots on the Moon to the cosmic web. Real ephemerides,
star catalogues and galaxy surveys place everything that can be known; physically motivated procedural models fill
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
- The asteroid and Kuiper belts: up to 400,000 bodies on GPU Kepler orbits (Kirkwood gaps, Hildas, Trojans,
  plutinos).

**Worlds**

- Seamless terrain from orbit to the ground on every rocky planet and moon: real Moon, Mars and Earth elevation plus
  procedural craters, dunes, ridges and calderas. Walk mode with real gravity and jumping.
- Physically based atmospheres (Earth, Mars, Venus, Titan): blue Earth skies, blue Martian sunsets.
- A hero Earth with ocean glint, city lights, clouds and cloud shadows.
- Gas giants with drifting cloud bands, the Great Red Spot and moon-shadow transits; Saturn's and Uranus's rings at
  true radii with backlit glow and shadows both ways.

**Galaxy**

- 119,625 real stars (HYG) with true colours and brightness from any viewpoint, moving with their proper motions.
- 3D constellation lines that break apart as you travel; nearby stars become real suns up close; double stars
  (Alpha Centauri, Sirius) and more than 5,000 known exoplanets with habitable zones.
- The Milky Way: the night-sky band from Earth, and from outside a barred spiral built on the measured arms, bar,
  discs and dust, with 194 globular clusters.

**Black holes**

- Real light bending: Sgr A\* with its photon ring, Doppler-bright disk and the S-stars on their precessing orbits;
  M87\*, Cygnus X-1 with its supergiant companion, and the dormant Gaia black holes.

**Deep universe**

- Nearby galaxies (Andromeda, the Magellanic Clouds, the Virgo cluster) and the cosmic web of filaments and voids
  beyond them, with cosmology readouts (lookback time, distance).

**Showtime**

- Guided tour _Cosmic Zoom_ (palette: "Tour: Cosmic Zoom", or the ▶ Tour button): pause, skip, Esc to leave.
- Photo mode (`P`): hides the interface, sets the field of view (5-120°) and exposure, and saves a PNG with a
  credits line.
- Search palette, info cards, time controls (warp, pause, any date), HUD with speed, distance and light-travel time,
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
| `G`               | Go to the selection; near a surface, walk (`Shift` run, `Space` jump) |
| `O`               | Orbit or free camera                                                  |
| `I`               | Info card                                                             |
| `P`               | Photo mode                                                            |
| `Shift`+`C`       | Constellation lines                                                   |
| `H`               | Hide the interface                                                    |
| `L`               | Copy a link to this view                                              |
| `?`               | Keyboard help                                                         |
| `Esc`             | Close panels, leave the tour or photo mode                            |

## Performance

- Quality presets in the settings panel (⚙): potato, low, medium, high, ultra. The default is cheap enough for a
  laptop; high and ultra add terrain detail, stars and memory.
- Dynamic resolution lowers the render scale when frames take too long and raises it again when there is headroom.
- Add `?perf=1` to the URL for an fps and GPU meter. `?q=<preset>` picks a preset from the URL.

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
