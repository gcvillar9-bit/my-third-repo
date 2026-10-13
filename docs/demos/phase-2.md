# Cosmos: Phase 2 demo, "Worlds in immense detail"

Phase 2 lets you land. Planets and moons now have real terrain that refines smoothly from orbit down to your boots,
you can walk and jump with the right gravity, and Earth, Mars, Venus and Titan have physically based atmospheres:
blue skies on Earth, a butterscotch sky with a blue sunset on Mars, and a hero Earth with ocean glint, city lights,
clouds and cloud shadows.

**Live site:** https://gcvillar9-bit.github.io/my-third-repo/

The site updates once the Phase 2 pull request is merged into `main` (the deploy runs automatically). It needs a
browser with WebGL2. You now start 400 km above Earth at the dawn line, at the current date and time.

## Places to visit

Open a link and give it a few seconds: terrain and textures stream in while you watch.

| Link                                                                                       | What to look for                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Earth at dawn](https://gcvillar9-bit.github.io/my-third-repo/#b=earth-dawn-400km)         | The new start view: from 400 km just inside the night side, looking along the dawn line. A thin blue glow sits on the curved horizon; the lighting follows the real time of day.           |
| [Orbital sunrise](https://gcvillar9-bit.github.io/my-third-repo/#b=earth-sunrise-400km)    | The Sun rising over the Atlantic seen from 400 km above Pennsylvania (20 March 2026): the Sun above the curved limb, a coloured band of air, the sunlit ocean strip, the night side below. |
| [Earth's limb](https://gcvillar9-bit.github.io/my-third-repo/#b=earth-limb-400km)          | Sunlit Earth from 400 km: clouds and oceans below, the blue atmosphere fading into black space on the horizon.                                                                             |
| [City lights](https://gcvillar9-bit.github.io/my-third-repo/#b=earth-night-lights)         | Europe at night from 2000 km: warm orange city lights; clouds dim them where they pass over.                                                                                               |
| [Himalaya](https://gcvillar9-bit.github.io/my-third-repo/#b=earth-himalaya)                | 7.5 km above western Tibet looking south across the Kailash range: real elevation data with added fine detail and haze in the distance.                                                    |
| [Moon from low orbit](https://gcvillar9-bit.github.io/my-third-repo/#b=moon-low-orbit)     | 50 km above the Moon with a low Sun: cratered terrain everywhere, darkening towards the day-night line ahead.                                                                              |
| [Apollo 11 site](https://gcvillar9-bit.github.io/my-third-repo/#b=apollo11-2m)             | Standing at Tranquility Base: grey regolith, a black sky, the low Sun in the east and Earth high in the west. You start in walk mode: try walking and jumping.                             |
| [Sunset at Gale crater](https://gcvillar9-bit.github.io/my-third-repo/#b=mars-gale-sunset) | Standing on Mars where Curiosity explores: the small Sun 3 degrees above the horizon inside a blue glow, the rest of the sky butterscotch. You start in walk mode on the crater floor.     |

**The descent.** Open "Moon from low orbit", point the view down with the mouse and fly forwards (`W`, hold for
speed, the wheel changes speed). Terrain keeps refining all the way down; there is no switch or loading screen.
Close to the ground press `G` to stand up and walk; at the Apollo 11 site Earth hangs in the sky.

## New controls

| Action     | How                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| Walk mode  | `G` when within 10 km of a surface: you are placed on the ground at eye height (1.7 m); `G` again to fly |
| Walk / run | `W` `A` `S` `D` walk at 1.4 m/s; hold `Shift` to run (4.2 m/s); drag to look around                      |
| Jump       | `Space` (gravity is real: on the Moon you float up for longer than on Earth)                             |
| Mode       | The HUD at the bottom shows `walk` while walking                                                         |
| HD Earth   | Settings (gear) > Graphics > "HD Earth terrain", or `?hdterrain=1`: streams detailed elevation tiles     |

All Phase 1 controls still work (`/` search, `O` orbit, `,` `.` time, `L` copy link, `?` help).

## Checking performance

Add `?perf=1` before the `#`, for example https://gcvillar9-bit.github.io/my-third-repo/?perf=1#b=apollo11-2m . A
small panel shows frames per second and GPU time. Please try it on `earth-dawn-400km`, `apollo11-2m` and
`mars-gale-sunset` and report anything under 60 fps on the default (medium) preset. `?q=low` or `?q=high` picks
another quality preset (also in the settings panel).

## Known gaps in Phase 2

- No cast shadows from terrain yet: crater walls and mountains darken by their slope only, so low-Sun views look
  softer than real photographs.
- Terrain detail on the lowest preset (`potato`) stays coarse close to the ground; medium and above refine to
  centimetre-scale vertices under your feet. Small "pops" can appear while finer tiles arrive.
- Mars and Moon elevation comes from 2k global maps: the largest features (the Mars dichotomy, the Tharsis bulge)
  are flattened, and detail below a few kilometres is generated, not measured. Earth coastlines are coarse (~20 km).
- In the sunrise view a single exposure cannot show both the bright sunrise and the city lights (as with a real
  camera); the lights are in the "City lights" view. The ocean glint is subtle at small window sizes.
- Only one atmosphere is drawn at a time (for example Titan in front of Saturn shows only Titan's); gas giants have
  no limb haze yet; the ground receives direct sunlight but no blue skylight.
- Clouds are a thin static layer without volume.
- Visiting Saturn and coming back keeps Saturn's maps in memory (they are reused next time, not leaked).
- Earth's sharpest (4k) maps load only on the high and ultra presets.
- Data and image credits: see [CREDITS.md](../../CREDITS.md).
