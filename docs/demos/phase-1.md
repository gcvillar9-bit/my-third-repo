# Cosmos: Phase 1 demo

Phase 1 builds the foundation: a camera that can travel from metres to light-years without jitter, a physically
exposed renderer, the real Solar System (42 bodies at their true positions for the chosen date), 119,625 real stars
and the Milky Way glow, plus search, info cards, a time bar and shareable links.

**Live site:** https://gcvillar9-bit.github.io/my-third-repo/

The site updates once the Phase 1 pull request is merged into `main` (the deploy runs automatically). It needs a
browser with WebGL2 (any recent Chrome, Edge, Firefox or Safari). On first load you start above Earth's dawn
terminator at the current date and time.

## Places to visit

Open a link, wait a moment for the textures, then look around (drag with the mouse).

| Link                                                                                               | What to look for                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Earth now](https://gcvillar9-bit.github.io/my-third-repo/#b=earth-now)                            | Earth with clouds on its sunlit side and the dawn line across the middle; the Sun glints off the oceans. Time is "now", so the lit continents match reality. |
| [Moon](https://gcvillar9-bit.github.io/my-third-repo/#b=moon)                                      | Grey, airless Moon: craters and maria with flat, dust-like lighting (no limb darkening as on Earth).                                                         |
| [Mars](https://gcvillar9-bit.github.io/my-third-repo/#b=mars)                                      | The red planet with its dark plains, polar cap and the Valles Marineris canyon.                                                                              |
| [Jupiter and its moons](https://gcvillar9-bit.github.io/my-third-repo/#b=jupiter-moons)            | Jupiter deliberately over-exposed in the centre so its moons show up as faint points on their orbit rings.                                                   |
| [Saturn](https://gcvillar9-bit.github.io/my-third-repo/#b=saturn)                                  | Saturn with its rings at their true size and tilt for the date; the planet's shadow falls on the rings.                                                      |
| [Titan](https://gcvillar9-bit.github.io/my-third-repo/#b=titan)                                    | Saturn's largest moon: a hazy orange ball.                                                                                                                   |
| [Pluto](https://gcvillar9-bit.github.io/my-third-repo/#b=pluto)                                    | Pluto, 40 times farther from the Sun than Earth: the light is much dimmer, so the view is exposed longer.                                                    |
| [Solar System overview](https://gcvillar9-bit.github.io/my-third-repo/#b=solar-system-overview)    | The Sun as a brilliant point with the planets' orbits (blue) and the dwarf planets' orbits (brown) around it.                                                |
| [Orion from Earth](https://gcvillar9-bit.github.io/my-third-repo/#b=orion-from-earth)              | The constellation Orion: orange Betelgeuse upper left, blue-white Rigel lower right, the three belt stars between them.                                      |
| [The Sun from Alpha Centauri](https://gcvillar9-bit.github.io/my-third-repo/#b=sun-from-alpha-cen) | From our nearest neighbouring star, the Sun is just a bright star in Cassiopeia (the "W" shape).                                                             |

Every planet and major moon also has its own view: replace the end of the link with `#b=` plus its name in lower
case, for example `#b=io`, `#b=europa`, `#b=ganymede`, `#b=callisto`, `#b=enceladus`, `#b=triton`, `#b=charon`,
`#b=ceres`, `#b=vesta`, `#b=venus`, `#b=mercury`, `#b=uranus`, `#b=neptune` or `#b=sun`.

## Controls

| Action                  | How                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Search and fly anywhere | Press `/` (or Ctrl+K), type a name (a planet, moon, star such as "Sirius" or "Betelgeuse"), press Enter  |
| Look around             | Drag with the mouse                                                                                      |
| Fly                     | `W` `A` `S` `D` to move, `R` / `F` up and down, `Q` / `E` roll                                           |
| Speed                   | Mouse wheel or `[` `]` (speed also adapts automatically to your distance from the nearest body)          |
| Orbit the selected body | `O`                                                                                                      |
| Go to the selected body | `G` (or "Fly there" on the info card)                                                                    |
| Info card               | `I`                                                                                                      |
| Time                    | `,` and `.` slow down or speed up time (also backwards), `P` pause, `N` back to now; or use the time bar |
| Share the current view  | `L` or the "Copy link" button: the link reopens exactly this place and time                              |
| Hide the interface      | `H`                                                                                                      |
| Keyboard help           | `?`                                                                                                      |

## Checking performance

Add `?perf=1` before the `#`, for example https://gcvillar9-bit.github.io/my-third-repo/?perf=1#b=saturn . A small
panel shows frames per second and GPU time. `?q=low` or `?q=high` picks a lower or higher quality preset (the
settings panel, the gear button, does the same).

## Known gaps in Phase 1

- No landing on surfaces yet: planets are smooth textured spheres. Terrain, walking and atmospheres come in Phase 2.
- Earth's city lights only show where the night side fills the view; next to the bright day side they are (realistically)
  too faint to see.
- The Milky Way glow is faint by design (the camera is exposed like a real one); it is clearest towards Sagittarius.
- Stars cannot be visited as bodies yet: searching for a star flies you close to it, and its info card shows its data.
- Saturn's rings do not yet cast a shadow on the planet; Uranus's rings are not drawn.
- Faint moons can be invisible when the view is exposed for a bright planet, as in a real photograph.
- Touch controls and small phone screens are untested.
- Data and image credits: see [CREDITS.md](../../CREDITS.md). Pluto's map is licensed for non-commercial use only.
