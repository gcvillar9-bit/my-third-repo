# Audio

Procedural sound with the Web Audio API only (oscillators, a looping 2 s white-noise buffer, biquad filters and a
feedback-delay echo). No audio files, no dependencies.

## Files

| File               | Role                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `public.ts`        | Module id, setting ids (`audio.enabled`, `audio.volume`, `audio.realisticSilence`), attr   |
| `settings.ts`      | `audioSettingDefs` (group Sound, persisted) and `audible(prefs)`                           |
| `mapping.ts`       | Pure mappings: `classifyZone`, `whooshParams`, `windParams`, `densityAt`, `rumbleLevel`, … |
| `atmospheres.json` | Density proxy rows (`rho0`, scale height, top, `source`, `approximate`)                    |
| `engine.ts`        | `AudioEngine`: the graph, pad crossfades, footstep thuds and the chime                     |
| `index.ts`         | Module: settings, gesture unlock, 20 Hz update from `render.onAfterFrame`                  |

## Behaviour

- **Autoplay:** the `AudioContext` is created on the first `pointerdown`/`keydown` (capture listeners on `window`)
  while sound is on; a later unmute creates it if needed. Never in test mode unless `?audio=1`. Muted, volume 0 or
  a hidden tab suspends the context. `<html data-cz-audio>` is `test-off`, `idle`, `running` or `suspended`.
- **Pad by zone** (`classifyZone`): surface (altitude < 0.02 R), orbit (< 30 R), interplanetary (< 1e14 m from the
  SSB), interstellar (< 3e18 m), galactic (< 1e21 m from Sgr A*), cosmic. A zone must hold 1.2 s, then the two
  pad slots crossfade linearly over 6 s. Chords and timbres: `PAD_VOICES`.
- **Whoosh:** band-passed noise; level and centre from speed / altitude (the camera cruises at k · d) and
  |d ln v / dt|. Silent when still and in walk mode.
- **Wind:** low-passed noise × two gust LFOs, gain from log10(1 + ½ρv²) plus a faint breeze near the ground. ρ is
  an exponential atmosphere per body (`atmospheres.json`: Earth, Mars, Venus, Titan).
- **Rumble:** beating 31/32.7 Hz sines, 46.5 and 62 Hz partials and deep noise; level from the distance to the
  nearest registry body of kind `blackhole` in Schwarzschild radii (0 beyond 1e6 r_s).
- **Walk:** thuds at `stepRate(speed)` (1.2-4 Hz), jump and landing thuds (eye > 1.76 m means airborne), pitch
  `gravityPitch(g)` = (g / 9.81)^0.25 clamped to 0.55-1.4.
- **Chime:** two soft sines when `camera.traveling` turns false (autopilot arrival).
- **Realistic silence:** mutes the `space` bus (pad, whoosh, rumble); wind, footsteps and the chime stay.

## Controls

Top-bar speaker button (`.cz-mute-btn`) and `M` toggle `audio.enabled` (the UI shell owns both). Settings > Sound:
Sound, Volume (0-1, default 0.5), Realistic silence in space.

## Tests

`tests/unit/audio/audio.test.ts` (zones, mappings, persistence with a fake storage) and
`tests/e2e/audio-perf.spec.ts` (controls in test mode, audio stays off).
