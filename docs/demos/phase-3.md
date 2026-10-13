# Cosmos: Phase 3 demo, "Grand Tour"

Phase 3 adds the showpieces of the Solar System: living gas giants with moon shadows, Saturn's and Uranus's rings
at their true sizes that glow when lit from behind, a granulated Sun with a real corona, the asteroid and Kuiper
belts (hundreds of thousands of bodies moving on their true orbits), and a solar-eclipse finder that puts you on the
ground for totality.

**Live site:** https://gcvillar9-bit.github.io/my-third-repo/

The site updates once the Phase 3 pull request is merged into `main` (the deploy runs automatically). It needs a
browser with WebGL2.

## Places to visit

Open a link and give it a few seconds for textures to arrive.

| Link                                                                                             | What to look for                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Saturn backlit](https://gcvillar9-bit.github.io/my-third-repo/#b=saturn-backlit-2013-07-19)     | 19 July 2013, from inside Saturn's shadow (the day Cassini photographed Earth from here). The rings glow from behind: the dusty outer rings light up, the dense B ring stays darker, and the planet is a black disk.          |
| [Io's shadow on Jupiter](https://gcvillar9-bit.github.io/my-third-repo/#b=jupiter-io-shadow)     | 29 January 2026: the small black shadow of the moon Io crossing Jupiter's cloud bands. Speed up time to watch it move and the bands drift.                                                                                    |
| [Uranus's rings](https://gcvillar9-bit.github.io/my-third-repo/#b=uranus-rings)                  | The thin dark rings of Uranus, tipped on their side like the planet. The outer (epsilon) ring is the clearly visible one.                                                                                                     |
| [The Sun up close](https://gcvillar9-bit.github.io/my-third-repo/#b=sun-closeup)                 | Skimming 3% above the Sun's surface: a boiling pattern of granules (each about the size of France) over larger cells, and the darker edge of the disk. It looks white because that is the Sun's true colour without a filter. |
| [Asteroid belt](https://gcvillar9-bit.github.io/my-third-repo/#b=asteroid-belt-3au)              | Inside the main belt, 3 AU from the Sun and a little above it, looking along the direction the asteroids travel: thousands of asteroids as faint dots (more on higher quality settings).                                      |
| [Total eclipse, Luxor 2027](https://gcvillar9-bit.github.io/my-third-repo/#b=eclipse-2027-luxor) | Standing in Luxor, Egypt, on 2 August 2027 at mid-eclipse: the black Moon covers the Sun, the pearly corona with its streamers appears, the sky goes dark and stars come out.                                                 |

**Watch the belt move.** In the asteroid belt view press `.` a few times to speed up time (`,` slows it down, `P`
pauses). Inner asteroids overtake outer ones, and the Trojans stay locked 60 degrees ahead of and behind Jupiter. The
Kirkwood gaps (empty lanes where Jupiter's pull clears out orbits) are gaps in orbit size, so they show best when
you fly above the belt and look down on it. Further out, the Kuiper belt lies beyond Neptune.

**Find the next eclipse.** Press `/` and type `eclipse`: "Next solar eclipse" and "Next lunar eclipse" are worked out
from the current date in the app. Picking one puts you on the ground where it is best seen.

**Brightness note.** Real asteroids are too faint to see as dots, so the belt is brightened by default. Settings
(gear) > Sky > "Asteroid visibility boost" set to 0 shows the physical brightness.

## Checking performance

Add `?perf=1` before the `#`, for example
https://gcvillar9-bit.github.io/my-third-repo/?perf=1#b=asteroid-belt-3au . A small panel shows frames per second
and GPU time. Please try it on `asteroid-belt-3au`, `saturn-backlit-2013-07-19` and `sun-closeup` and report anything
under 60 fps on the default (medium) preset. `?q=low` or `?q=high` picks another quality preset (the belt has 60k
points on low, 150k on medium and 400k on ultra).

## Known gaps in Phase 3

Cut to keep this phase within budget (planned for later):

- Flying through Saturn's rings among individual ice chunks; Saturn's hexagon; Neptune's dark spot.
- Sunspots and the solar cycle, prominences, and a lens flare.
- Comets and their tails, named dwarf planets and comets from catalogues, close-up rocks near the camera, and
  spacecraft markers (Voyager, New Horizons, JWST).
- Planet transits across the Sun (the eclipse finder covers solar and lunar eclipses only).

Known limitations of what was built:

- Saturn's night side is fully black in the backlit view (no light reflected from the rings onto it yet).
- Only Uranus's outer (epsilon) ring is clearly visible; the inner rings are much fainter than they should be.
- The Great Red Spot is drawn but is not in any of the demo views; fly to Jupiter and look around 22 degrees south.
- Seen as distant points, the giant planets are no longer tinted by their colour (they look white-ish).
- During an eclipse the sky darkening is approximate, and there is no orange glow along the whole horizon.
- Asteroids in resonance (Hildas, plutinos) hold their average position rather than swinging back and forth.
