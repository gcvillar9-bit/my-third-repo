# Cosmos: polish pass ("make it perfect")

This pass looked at every saved view, fixed what was wrong, and added the things a visitor expects to find.

**Live site:** https://gcvillar9-bit.github.io/my-third-repo/ (updates when the pull request is merged into `main`).

## Fixed

- **Io and Titan.** Io showed as a black disc with glowing dots and Titan's ground was black: both colour maps had
  been built wrong. [Io](https://gcvillar9-bit.github.io/my-third-repo/#b=io) is now its pale yellow self.
- **Grid pattern on planets.** On the two lowest quality settings Mars, Earth and the deep-time Earth showed a
  regular lattice from orbit. Gone: [Mars](https://gcvillar9-bit.github.io/my-third-repo/#b=mars),
  [Pangaea](https://gcvillar9-bit.github.io/my-third-repo/#b=earth-pangaea-250ma).
- **Slow machines.** The automatic resolution drop never engaged below about four frames a second, and the quality
  you picked was forgotten on reload. Both fixed, and quality now lowers itself when the frame rate stays poor.
- **Clutter.** No more star names over a daylit sky or far-away black holes named in every view; labels no longer
  run off the right edge; the time bar shows one accuracy chip instead of seven cut-off badges.
- **Field of view.** After visiting a close-up view (Uranus's rings is a 6° telescope shot) every later flight
  stayed zoomed in. Views now ease back to the normal field of view.

## New

- **Loading screen** with progress, and a readable message with a Reload button if the browser lacks WebGL2, the
  connection stalls or the graphics context is lost.
- **Explore** (button or `X`): about a hundred places by theme, from the planets to deep time, cities, comets,
  black holes and the cosmic web.
- **Five guided tours** (button or `T`): Cosmic Zoom, Grand Tour of the Solar System, Earth Through Time, Black
  Holes, Stars and the Galaxy.
- **Click a world** to select it, double-click to fly there, and **Land** to fly down and walk on it. The HUD shows
  latitude, longitude and height, with Walk and Take off buttons.
- **Comets**: [Halley in 1986](https://gcvillar9-bit.github.io/my-third-repo/#b=halley-1986),
  [Hale-Bopp in 1997](https://gcvillar9-bit.github.io/my-third-repo/#b=hale-bopp-1997),
  [Halley's nucleus](https://gcvillar9-bit.github.io/my-third-repo/#b=halley-nucleus) and
  [NEOWISE in the sky](https://gcvillar9-bit.github.io/my-third-repo/#b=neowise-2020-sky).
- **Spacecraft**: the [International Space Station](https://gcvillar9-bit.github.io/my-third-repo/#b=iss-over-earth),
  [Hubble](https://gcvillar9-bit.github.io/my-third-repo/#b=hubble-over-earth),
  [Webb at L2](https://gcvillar9-bit.github.io/my-third-repo/#b=jwst-l2),
  [Voyager 1 looking back at the Sun](https://gcvillar9-bit.github.io/my-third-repo/#b=voyager1-looking-back) and
  [New Horizons](https://gcvillar9-bit.github.io/my-third-repo/#b=new-horizons); search also finds Voyager 2 and
  the Pioneers.
- **Touch screens and gamepads**: drag to look, pinch to fly, an on-screen stick; or sticks and triggers on a pad.
- **Controls panel** (`?`) with every key by theme and the data credits; switches for orbit lines (`Shift`+`O`)
  and labels (`Shift`+`L`); full screen (`Shift`+`F`); `Home` flies back to Earth.
- A short description on the info card of every Solar System body.

## Not checked

Everything was rendered in software on a build machine. It has not been tried on a real graphics card, a real
phone or a real gamepad, so frame rates, touch feel and the gamepad mapping are the things to try first.
