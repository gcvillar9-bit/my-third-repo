# Status: comets

## Done

- Ten comets (`halley`, `encke`, `pons-brooks`, `67p`, `swift-tuttle`, `hale-bopp`, `hyakutake`, `mcnaught`,
  `neowise`, `tsuchinshan-atlas`) from Celestia `comets.ssc`, Stellarium (Hale-Bopp 1997) and a hand-entered,
  sourced `catalog.json`; `tools/build-comets.mjs`, manifest and credits.
- Universal-variable Kepler orbits (e up to 0.9999 and above 1), a frame and a `comet` Body each, validity range.
- Rendering: procedural nucleus, closed-form coma, straight ion tail, syndyne dust tail (sheet plus ribbons),
  photometric point, orbit lines (follow `solar-system.orbits`), built lazily per active comet.
- UI: setting `comets.enabled`, search entries with aliases, info cards with live facts, label source.
- Bookmarks `halley-1986`, `hale-bopp-1997`, `halley-nucleus`, `neowise-2020-sky`.
- 22 unit tests; e2e spec with 4 bookmarks (`halley-1986` is `@smoke`) green with `smoke.spec.ts`; `pnpm verify`
  green. Docs: `docs/modules/comets.md`.

## Gaps

- Tail brightness is an empirical law with a gain of 4 so tails read at the night exposure: their integrated light
  is overstated (the head's magnitude is physical). No forward-scattering brightening.
- One element set per comet: approximate away from its apparition (Halley's 2061 return is seven months late).
- No jets, no nucleus self-shadowing, made-up spin axes, no walk-mode ground provider, no ion-tail aberration.
- Hale-Bopp's dust tail is narrower than in photographs.
- Photometry H and K, 12P/Pons-Brooks and the Tsuchinshan-ATLAS perihelion time are hand-entered and could not be
  checked online from this environment; they are flagged approximate.
- Only `comets.spec.ts` and `smoke.spec.ts` were run; other specs were not re-run with comets present (an active
  comet adds up to 5 draw calls and an orbit line to planetary views).

## Requests

See `docs/requests/comets.md`: `solar-system.orbits` and `E2E_CHROMIUM` exist only on main, optional size-guard
boot-path entry, an upstream Celestia data error, planet orbit lines and the asteroid belt in comet views.
