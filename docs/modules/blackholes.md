# Black holes (P4-B)

Schwarzschild lensing, accretion disks, the black-hole catalogue and the S-stars around Sgr A\*.
Code: `src/modules/blackholes/`. Data: `public/data/blackholes/blackholes.json` (every row has `source`).
Cross-module API: `public.ts` (ids, `B_CRIT`, `PHOTON_SPHERE`, `R_ISCO`, `deflectionExact`, `shadowAngle`, `schwarzschildRadius`).

## Physics (units r_s = 1, c = 1)

- **Geodesics** (`geodesic.ts`, the CPU reference used by the tests): Binet's equation in Cartesian form,
  `x'' = -1.5 h² x / r⁵`, `h = |x × x'|`, RK4 with `dt = k·r`. A static observer's direction is turned into a
  coordinate tangent by scaling its radial part by `sqrt(1 - 1/r)`; this gives Synge's shadow
  `sin ψ = b_c sqrt(1 - 1/r) / r` with `b_c = 3√3/2 ≈ 2.598`. Photon sphere 1.5, ISCO 3.
- **Deflection LUT**: exact `α(b)` by quadrature (substitution `u = u0(1 - t²)`), stored as `f = α b / 2`
  (half float, 128 entries, log b from 2.6 to 1e4; beyond, `α = 2/b`).
- **Disk** (`disk.ts` + `glsl/disk.glsl`): Page-Thorne flux for a = 0 (zero at r = 3, peak at 4.77 r_s, Newtonian
  far out), `T = T_max (F/F_max)^¼`. `g = 1 / (u^t (1 - Ω λ))` for a Keplerian emitter and photon `λ = L_z/E`,
  split into gravitational `sqrt(1 - 1/r)` (times the static camera's blueshift) and Doppler parts so each
  toggle removes one. Observed intensity `∝ g⁴`, colour `blackbodyColor(g T)` (LUT, clamped 1000-40000 K).
  Filament noise lives in (azimuth − Ω(r) τ, log r) with two layers crossfaded on a 4-ISCO-orbit cycle; the
  shear clock τ follows sim time but advances at most 1/120 cycle per frame.
- **S-stars** (`sstars.ts`): visual-binary Thiele-Innes elements in the (north, east, line-of-sight) basis at
  Sgr A\*, published period, `a` from Kepler with the catalogue mass, `ω(t) = ω0 + Δω (t - tp)/P` with
  `Δω = 3π r_s / (a(1 - e²))` (S2: 12.2′ per orbit, period 16.05 yr, pericentre 2018.379 at 120 AU).

## Lensing pass (`lensing.ts`, stage `lensing`)

- Each frame `active()` picks the hole with the largest footprint (shadow, Einstein angle `sqrt(2/D)`, or the
  disk's sphere) that is at least 3 px and meets the view. Nothing runs otherwise.
- **March** (reduced resolution, scissored to the screen box of the marched sphere of radius
  `R_b = max(12, 1.25 r_out)`): per-pixel RK4, steps and resolution per preset:

  | preset      | scale | steps  | k = clamp(10/steps) |
  | ----------- | ----- | ------ | ------------------- |
  | potato, low | 1/4   | 32, 48 | 0.30, 0.21          |
  | medium      | 1/2   | 64     | 0.16                |
  | high        | 1/2   | 128    | 0.08                |
  | ultra       | 1     | 256    | 0.04                |

  A camera farther than `3 R_b` starts rays on the sphere (straight line before it, weak-field bending added
  analytically); closer cameras march every pixel from the camera. Disk-plane crossings are interpolated
  linearly, the thin disk is opaque (so the lensed far side and the photon ring emerge on their own), the
  RIAF glow is integrated per step, `r < 1` is black. Escaping rays get the remaining weak bending
  `(1 - cos χ)/b` and sample `sky(dir)`.

- **Composite** (full resolution): pixels in front of the hole (log depth) pass through; inside `1.08 R_b`
  the upsampled march; out to the radius where the deflection exceeds ~0.5 px, `α(b)(1 + cos ψ)/2` from the LUT;
  elsewhere the input untouched.
- **Sky source**: the on-screen scene when the bent direction lands on screen behind the hole, else a 256²
  HalfFloat cube of the background scene captured in-module with a `CubeCamera` at the camera (on activation,
  on a hole change and every 30 frames; rescaled by the exposure ratio). The engine's optional
  `RenderApi.captureCube` is not used. Main-scene content is lensed only through the on-screen path.

## Catalogue, frames, bodies

- Hole frames `bh:<id>` have world axes (`orientationAt = conj(orientation(parent))`). Sgr A\* sits at the `mw`
  origin; Milky Way holes hang under `mw`, M87\* under `universe` (the `ssb` influence is under 1 pc), at their
  ICRS direction and distance from the Sun. Bodies: kind `blackhole`, radius `r_s`.
- S-stars: frames/bodies `sgra-s2`, … under `bh:sgra`, `starSurface` close-ups, sprites (2.5 px, grow when
  saturated, fade when the sphere passes 3 px) and precessing orbit lines (display-referred, hidden within
  20 AU of the hole).
- Cyg X-1: companion HDE 226868 (`hde226868`, `starSurface`, circular 5.6 d orbit, superior conjunction at
  `t0Jd`), a large disk mesh out to 1.5e5 r_s (discarded inside the marched sphere when the pass targets it),
  and an illustrative stream from the companion's inner face to the disk rim.
- Disk orientation: `incDeg` between the axis and the direction to the observer (> 90 = clockwise),
  `paDeg` position angle of the projected axis. Disk luminances are display choices.

## Settings (group "Black holes")

`blackholes.lensing`, `.beaming`, `.redshift`, `.disk` (booleans, default on), `.mode` (`illustrative`
default: bright thin disk; `realistic`: dim optically thin RIAF-like glow), `.orbits` (S-star orbit lines).

URL overrides `?blackholes.<name>=0|1` (and `?blackholes.mode=realistic`) set these at boot, for deep links and
e2e (persisted settings are disabled under `?test=1`); the gaia-bh3 e2e compares lensing on and off this way.

## Bookmarks

`sgra-lensing` (26 r_s, 12° above the disk plane, EV 11), `sgra-s2-periapsis` (2018-05-19 TT, face-on to
S2's orbit from 3200 AU, 1 month/s), `m87-shadow` (60 r_s along Earth's line of sight, 17° from the jet),
`cygx1-disk` (quarter phase near 2026, EV from the companion's surface luminance), `gaia-bh3-dormant`
(40 r_s, looking back at the Sun's neighbourhood, EV −8).

## Decisions and gaps

- Step budgets follow the brief (32/48/64/128/256), not `knobs.lensingSteps` (64/64/128/256/256), to stay cheap
  on medium; the resolution scale is per preset as above.
- No Kerr spin and no fall-into-the-hole mode (cut). Camera motion aberration is ignored (static observer).
- The cube holds only the `background` scene; with P4-A's galaxy the lensed sky near Sgr A\* will fill in.
- Potato's quarter-resolution march is visibly blocky; medium and up are smooth.
