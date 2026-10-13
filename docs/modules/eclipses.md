# Eclipses (P3-B)

An eclipse finder built on astronomy-engine, with "next eclipse" search entries and info cards, the
`eclipse-2027-luxor` totality bookmark, and the sky dimming under the Moon's shadow. Cross-module API:
`src/modules/eclipses/public.ts`.

## Finder (`search.ts`, three-free)

- `nextSolarEclipse(jd)` uses `SearchGlobalSolarEclipse`: kind, greatest-eclipse JD TT, latitude and
  longitude, obscuration.
- `nextLunarEclipse(jd)` uses `SearchLunarEclipse`: kind, peak, and the total, partial and penumbral
  durations.
- `localSolarEclipse(jd, lat, lon, h)` uses `SearchLocalSolarEclipse`: the local peak, the Sun's altitude and
  the totality contacts.
- JD TT goes in and out, converted through UTC with the engine's ΔT. Unit tests cover:
  - 2024-04-08: greatest eclipse at 25.3°N 104.1°W, 18:17 UTC (±3 min).
  - 2027-08-02: total at Luxor with about 6 min of totality and greatest eclipse within 1.5° of the city.
  - 2025-09-07: total lunar eclipse.

## Search and info (`index.ts`)

- Entries "Next solar eclipse" and "Next lunar eclipse" are computed from the current sim time and cached
  per sim day. Their `target` is a getter, so the bookmark is built when the entry is selected.
  - **Solar:** a walk-mode ground bookmark at the point of greatest eclipse, looking at the Sun (fovY 6°). If
    the shadow axis misses the Earth, it uses the sub-lunar point.
  - **Lunar:** on the ground at the sub-lunar point at the peak, looking up at the Moon (fovY 3°).
- Info cards for `eclipse:next-solar`, `eclipse:next-lunar` and `eclipse-2027-luxor` show the date (UTC),
  type, location, obscuration and durations, sourced to astronomy-engine.

## `eclipse-2027-luxor` (`bookmarks.ts`)

- The site is Luxor at 25.7°N 32.6°E, 75 m. The eye sits 1.7 m above the reference ellipsoid (Earth's
  oblateness from the body), in walk mode, which reseats on the drawn ground.
- The time is the local peak from `localSolarEclipse` (2027-08-02, about 10:07 UT, Sun about 80° high).
- The view looks at the Sun with fovY 6° and test EV 9.5.
- Result: a black lunar disk about 13 px in radius at potato, the corona with streamers, a dark sky and
  stars.

## Sky dimming (`sky.ts`)

- The atmosphere ScreenPass lights the sky with the full Sun and ignores the Moon's shadow; Phase 2 had no
  hook for this. Two small passes therefore bracket it in the `atmosphere` stage:
  - `eclipses.sky-capture` (order −100) copies the scene into a private HalfFloat target.
  - `eclipses.sky-dim` (order 100) writes `pre + f · (post − pre)`, so only the atmosphere's contribution
    is scaled.
- f = 1e-4 + (1 − 1e-4) · (visible solar-disk fraction at the camera, from exact circle overlap). The 1e-4
  floor stands for light scattered in from outside the umbra.
- The passes are active only within 150 km of Earth's surface while the Moon overlaps the Sun. Cost: one
  extra full-screen target and three full-screen draws.
- **Known approximation:** in totality the corona and Moon pixels skip atmospheric extinction (under 20% at
  this Sun height). The ground is darkened by the surface shaders' own Moon occluder (`shadows.glsl`).

## Cut or not built

Transits and the occlusion-tested lens flare are not built. There is no eclipse timeline UI.
