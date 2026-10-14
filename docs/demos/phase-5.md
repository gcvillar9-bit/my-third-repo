# Cosmos: Phase 5 demo, "Cosmos & Showtime"

Phase 5 is the last phase. It takes you past the Milky Way to the other galaxies and the cosmic web, and adds the
"showtime" features: a guided tour, a photo mode and a welcome card for first-time visitors.

**Live site:** https://gcvillar9-bit.github.io/my-third-repo/

The site updates once the Phase 5 pull request is merged into `main` (the deploy runs automatically). It needs a
desktop browser with WebGL2. Open a link and give it a few seconds for data to arrive.

## New places

- [Approaching Andromeda](https://gcvillar9-bit.github.io/my-third-repo/#b=m31-approach): our big neighbour, 2.5
  million light-years away, seen from just outside it. A yellowish core in a tilted spiral disc; faint galaxies
  behind it are small dots.
- [The Local Group](https://gcvillar9-bit.github.io/my-third-repo/#b=local-group): our galactic neighbourhood from
  above. The Milky Way with the two Magellanic Clouds beside it, and Andromeda and Triangulum on the other side.
- [The Virgo Cluster](https://gcvillar9-bit.github.io/my-third-repo/#b=virgo-cluster): about 54 million
  light-years away, hundreds of galaxies crowded around the giant elliptical galaxy M87.
- [The cosmic web](https://gcvillar9-bit.github.io/my-third-repo/#b=cosmic-web-500mpc): looking back home from
  about 1.6 billion light-years. Galaxies gather in knots and filaments around empty voids. This part is a
  simulation (it says "simulated" on its info card), shaped like the real thing.

Everything here comes from a real catalogue of 10,936 galaxies at their measured distances. Press `/` and type
**Andromeda**, **M87**, **Whirlpool**, **Sombrero**, **Centaurus A**, **M81**, **M82**, **M33** or **Large
Magellanic Cloud** to fly to one; its info card shows the distance in light-years and how long its light took to
reach us.

## The Cosmic Zoom tour

A three-minute guided flight from the Apollo 11 boot prints on the Moon, past Earth, the Solar System, the Milky
Way, its central black hole, Andromeda, the Virgo Cluster and the cosmic web, then back home to Earth. Captions
explain each stop.

- Start it with the **▶ Tour** button at the top right, by pressing `/` and choosing **Tour: Cosmic Zoom**, from
  the welcome card, or straight from a link: https://gcvillar9-bit.github.io/my-third-repo/?tour=cosmic-zoom
- The panel at the top of the screen shows the stop number and progress, with **Pause**, **Next** and **Exit**. `K` pauses and
  `Esc` leaves the tour.

## Photo mode

Press `P` (or the **Photo** button). The interface disappears so you get a clean picture. A small panel lets you
zoom (field of view 5-120°) and make the picture brighter or darker in half-stop steps. **Save PNG** downloads the
image with a small credits line in the corner. `Esc` or **Exit** brings the interface back.

## Welcome card

The first time someone opens the site, a small card lists the main keys (search, flying, speed, time, walking,
photo mode) with buttons **Take the tour**, **All keys (?)** and **Got it**. It shows only once per browser; open
the site in a private window to see it again.

## Checking speed

Turn on Settings > Performance > "Show performance stats" (or add `?perf=1` to the address,
https://gcvillar9-bit.github.io/my-third-repo/?perf=1) to show a frame-rate and GPU meter in the corner. The default "medium" quality is set to stay smooth on a laptop; Settings (the gear) has
lighter and heavier presets.

## New: sound and performance overlay

- **Sound.** Click or press any key once and the universe starts to sound: a soft pad that changes chord as you
  go from a planet's surface to orbit, interplanetary and interstellar space, the galaxy and the cosmic web (slow
  6 s crossfades); a whoosh when you speed up or fly fast; wind inside the atmospheres of Earth, Mars, Venus and
  Titan (stronger with air density and speed, with gusts); a deep rumble that grows as you approach a black hole
  (try [Sgr A*](https://gcvillar9-bit.github.io/my-third-repo/#b=sgra-lensing)); footsteps and a landing thud in
  walk mode (lower on light worlds such as the Moon); a small chime when an autopilot flight arrives.
- **Controls.** The speaker button in the top bar or `M` mutes. Settings (the gear) > Sound has Sound on/off,
  Volume (default 50%) and "Realistic silence in space" (only wind, footsteps and the chime play). All choices are
  remembered. Muted or at volume 0, the audio engine is suspended and costs nothing.
- **Performance overlay.** Settings > Performance > "Show performance stats (FPS / CPU / GPU)" shows the frame-rate,
  CPU and GPU meters plus a line with the render scale and draw calls, without reloading. Browsers without GPU
  timing (Safari) show "GPU n/a". `?perf=1` still turns it on from the address bar.

## Other changes

- The Milky Way band in the night sky is brighter, and the
  [Milky Way band](https://gcvillar9-bit.github.io/my-third-repo/#b=mw-band-from-earth) view is no longer
  overexposed.
- Pause/play time moved from `P` to `K`, because `P` is now photo mode.
- Flying to a constellation view turns the constellation lines on automatically.

## Known gaps

- Search finds the ten famous galaxies above by name. The other ~10,900 galaxies are shown but have no names yet.
- Galaxy tilts are exact for Andromeda and the Milky Way and approximate for the others (the Sombrero Galaxy looks
  less edge-on than it really is).
- The cosmic web is a simulation, not real survey data. The first time you fly beyond about 65 million
  light-years there can be a short hitch (about a tenth of a second) while it is built.
- One tour, no narration or music. If you take over the camera during the tour's slow orbit of the Moon, that
  orbit is skipped.
- Cut from the plan to keep the site fast and the project finished: a 3D cloud model of Andromeda, the cosmic
  microwave background shell, cosmology readouts (redshift, lookback time) and named superclusters.

## Cosmos at a glance: 12 places to visit

1. [Apollo 11 boot prints](https://gcvillar9-bit.github.io/my-third-repo/#b=apollo11-2m): stand 2 m above
   Tranquility Base on the Moon.
2. [Dawn from the Space Station](https://gcvillar9-bit.github.io/my-third-repo/#b=earth-dawn-400km): the blue limb
   of Earth over the sunrise line, from 400 km up.
3. [Sunset on Mars](https://gcvillar9-bit.github.io/my-third-repo/#b=mars-gale-sunset): the blue Martian sunset in
   Gale crater, where the Curiosity rover drives.
4. [Total eclipse, Luxor 2027](https://gcvillar9-bit.github.io/my-third-repo/#b=eclipse-2027-luxor): the Moon
   covers the Sun and the corona appears over Egypt.
5. [Jupiter and Io's shadow](https://gcvillar9-bit.github.io/my-third-repo/#b=jupiter-io-shadow): a moon's black
   shadow crossing Jupiter's cloud bands.
6. [Saturn backlit](https://gcvillar9-bit.github.io/my-third-repo/#b=saturn-backlit-2013-07-19): the rings glowing
   with the Sun behind Saturn, as Cassini saw it in 2013.
7. [Orion from 200 light-years](https://gcvillar9-bit.github.io/my-third-repo/#b=orion-from-200ly): the familiar
   constellation pulled apart, because its stars are at very different distances.
8. [TRAPPIST-1](https://gcvillar9-bit.github.io/my-third-repo/#b=trappist-1): seven Earth-sized planets around a
   small red star.
9. [The Milky Way from outside](https://gcvillar9-bit.github.io/my-third-repo/#b=mw-outside-100kpc): our home
   galaxy as a barred spiral, with a "You are here" marker.
10. [Sgr A\*, up close](https://gcvillar9-bit.github.io/my-third-repo/#b=sgra-lensing): the black hole at the
    centre of the Galaxy bending light into a bright ring.
11. [Approaching Andromeda](https://gcvillar9-bit.github.io/my-third-repo/#b=m31-approach): the nearest big
    galaxy.
12. [The cosmic web](https://gcvillar9-bit.github.io/my-third-repo/#b=cosmic-web-500mpc): the largest structures
    in the universe (simulated).

Or simply take the [Cosmic Zoom tour](https://gcvillar9-bit.github.io/my-third-repo/?tour=cosmic-zoom).
