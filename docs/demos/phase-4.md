# Cosmos: Phase 4 demo, "The Galaxy"

Phase 4 leaves the Solar System. You can now visit black holes that bend the light around them, see the whole
Milky Way from outside as a barred spiral, walk among the nearby stars with their planets, and watch the
constellations come apart as you travel. This phase also fixes the trackpad "snap back" bug you reported and adds
automatic resolution scaling for smoother frame rates on the Earth and terrain views.

**Live site:** https://gcvillar9-bit.github.io/my-third-repo/

The site updates once the Phase 4 pull request is merged into `main` (the deploy runs automatically). It needs a
browser with WebGL2. Open a link and give it a few seconds for data to arrive.

## Black holes

| Link                                                                                    | What to look for                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Sgr A\*, up close](https://gcvillar9-bit.github.io/my-third-repo/#b=sgra-lensing)      | The black hole at the centre of our Galaxy, seen from 26 times its horizon size. The black shadow, a thin bright photon ring around it, and the disk bent over the top and under the bottom. One side of the disk is brighter and bluer: that gas is coming towards you. |
| [S2 at its closest](https://gcvillar9-bit.github.io/my-third-repo/#b=sgra-s2-periapsis) | 19 May 2018: the star S2 whips past Sgr A\* at 120 times the Earth-Sun distance, at almost 3% of the speed of light. Time runs at about one month per second, so you see S2 swing around and its orbit line slowly turn (Einstein's precession).                         |
| [M87\*'s shadow](https://gcvillar9-bit.github.io/my-third-repo/#b=m87-shadow)           | The first black hole ever photographed (2019), seen almost face-on along our line of sight: a dark centre inside a bright ring, like the Event Horizon Telescope image.                                                                                                  |
| [Cygnus X-1](https://gcvillar9-bit.github.io/my-third-repo/#b=cygx1-disk)               | The first black hole ever found. A blue supergiant star loses gas in a stream that spirals into a hot disk around the 21-solar-mass hole. (The stream is drawn as an illustration.)                                                                                      |
| [Gaia BH3](https://gcvillar9-bit.github.io/my-third-repo/#b=gaia-bh3-dormant)           | A quiet black hole with no disk. All you see is a black dot and the stars around it pulled into arcs and doubled images. Drag to look around and watch the stars slide around the edge.                                                                                  |

**Black-hole switches.** Open Settings (the gear) and find the **Black holes** group:

- **Gravitational lensing**: off shows the scene with straight light rays, so you can see what the bending does.
- **Doppler beaming**: off makes both sides of the disk equally bright.
- **Gravitational redshift**: off removes the reddening and dimming of light climbing out of the hole.
- **Accretion disks**: hides the disks, glows and streams.
- **S-star orbits**: shows or hides the orbit lines of the stars around Sgr A\*.
- **Disk style**: "Illustrative" (default) shows a bright thin disk. "Realistic" shows Sgr A\* as it really is: a
  dim, hot, puffy glow.

## The Milky Way

| Link                                                                                              | What to look for                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [From 100,000 parsecs](https://gcvillar9-bit.github.io/my-third-repo/#b=mw-outside-100kpc)        | Our whole Galaxy from far above: a yellow bar in the middle, spiral arms dotted with pink star-forming regions, dark dust lanes, and a cyan ring marking "You are here" (the Sun). Globular clusters float around it. |
| [Edge-on](https://gcvillar9-bit.github.io/my-third-repo/#b=mw-edge-on)                            | The Galaxy seen from the side: a thin bright disk split by a dark lane of dust, with the bulge in the middle.                                                                                                         |
| [1,000 parsecs above the Sun](https://gcvillar9-bit.github.io/my-third-repo/#b=mw-above-sun-1kpc) | Looking down at the disk from above: the sky below you glows, the sky above is dark.                                                                                                                                  |
| [The band from home](https://gcvillar9-bit.github.io/my-third-repo/#b=mw-band-from-earth)         | The Milky Way band towards Sagittarius and the centre of the Galaxy, with its dark dust rifts.                                                                                                                        |

## Stars, constellations and planets

| Link                                                                                                  | What to look for                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Orion from Earth](https://gcvillar9-bit.github.io/my-third-repo/#b=orion-lines-from-earth)           | Orion with its stick figure drawn in.                                                                                                                                |
| [Orion from 200 light-years](https://gcvillar9-bit.github.io/my-third-repo/#b=orion-from-200ly)       | The same stars seen from 200 light-years to the side. The figure falls apart because its stars are at very different distances. The lines still join the real stars. |
| [The Big Dipper in 100,000 years](https://gcvillar9-bit.github.io/my-third-repo/#b=big-dipper-100kyr) | The date is set 100,000 years ahead. The stars have moved, so the "dipper" has a broken handle and a bent bowl.                                                      |
| [TRAPPIST-1](https://gcvillar9-bit.github.io/my-third-repo/#b=trappist-1)                             | A small red star with seven Earth-sized planets packed close in. A faint green ring marks the habitable zone, where liquid water could exist.                        |
| [Proxima Centauri b](https://gcvillar9-bit.github.io/my-third-repo/#b=proxima-b)                      | The nearest star to the Sun and its planet, inside its habitable zone.                                                                                               |
| [Kepler-186f](https://gcvillar9-bit.github.io/my-third-repo/#b=kepler-186f)                           | The first Earth-sized planet found in a habitable zone.                                                                                                              |
| [51 Pegasi b](https://gcvillar9-bit.github.io/my-third-repo/#b=51-peg-b)                              | The first planet found around a Sun-like star (Nobel Prize 2019): a "hot Jupiter" racing around its star every 4 days.                                               |

Planet looks are an **artist's impression** (the info card says so). Their sizes and orbits come from the catalogue
of more than 5,000 known planets. Press `/` and type a star or planet name to fly to any of them. Fly to within about
1.6 light-years of a star and it turns into a real glowing ball you can approach.

**Constellation lines:** press **Shift+C** (plain `C` moves the camera down), or turn on Settings > "Constellation
lines". The three constellation links switch them on by themselves.

## Time-warp tips

`.` speeds time up, `,` slows it down or runs it backwards, `P` pauses and `N` returns to now.

- **S2's orbit:** the S2 link already runs at about a month per second. Press `.` once or twice to watch whole 16-year
  orbits. The orbit line turns a little each lap: that is the precession Einstein predicted, measured in 2020.
- **The Big Dipper over 100,000 years:** start from [Orion from Earth](https://gcvillar9-bit.github.io/my-third-repo/#b=orion-lines-from-earth)
  or any night-sky view and press `.` until the rate reads about 100 billion times (1e11). 100,000 years then pass
  in about half a minute and every constellation slowly changes shape. Press `N` to come back to today.

## Performance and your trackpad bug

- **"Clicking to look throws me back" is fixed.** We reproduced it. On the Moon the walking spot was computed against
  the wrong height map, so you started about 560 m up and kept falling. The ground height under your feet also
  jumped by metres as the view turned. Both are fixed, and a quick click or a lost mouse-up no longer snaps the view.
- **Automatic resolution scaling (new, on by default).** When the frame rate drops below about 55 fps the app
  lowers the render resolution a little (down to half at most) and raises it again when there is headroom. To turn
  it off: Settings > **Performance** > "Dynamic resolution".
- **Earth and terrain are cheaper.** The atmosphere is now computed at half resolution on low to high quality, and
  medium and ultra no longer draw more terrain detail than the screen can show. These gains come from counting the
  work, not from timing a real laptop, so please test again on yours.
- **Checking fps:** add `?perf=1` before the `#`, for example
  https://gcvillar9-bit.github.io/my-third-repo/?perf=1#b=sgra-lensing . It shows frames per second, GPU time and
  the current resolution scale. Please try `earth-dawn-400km`, `apollo11-2m` (walking on the Moon), `sgra-lensing`
  and `mw-outside-100kpc` on medium, and tell us anything under 60 fps.

## Known gaps in Phase 4

Cut to keep this phase within budget:

- Spinning (Kerr) black holes and a "fall into the hole" ride; faint procedural stars filling the Galaxy between
  the real catalogue stars.

Known limitations of what was built:

- The Milky Way band seen from Earth is still fainter than the real sky at night. It shows well in the "band from
  home" link. Flying out from 650 to 1,300 light-years the sky brightens noticeably as the Galaxy model takes over
  from the photo panorama.
- On the potato and low settings the black-hole close-ups look blocky and the Galaxy's arms are soft. Medium and
  above are sharper.
- Only one black hole bends light at a time (the biggest on screen).
- Picking a constellation link from the search box does not switch the lines on: use Shift+C.
- Where a planet sits on its orbit, and the planets' looks, are illustrative; only one planetary system is shown at
  a time.
- Searching a star or planet flies you near it, then you click the host star to go closer.
