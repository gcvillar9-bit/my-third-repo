# Cosmos

Fly through a realistic universe in your browser: from standing on planet surfaces, through the Solar System and the Milky Way, out to the cosmic web. Real ephemerides and star catalogues place everything that can be known; physically motivated procedural models fill in the rest and are labelled "simulated".

**Live:** https://gcvillar9-bit.github.io/my-third-repo/ (needs WebGL2)

## What works so far (Phase 1)

- A camera that travels seamlessly from metres to light-years (64-bit frame tree, camera-relative rendering, log depth).
- Physically exposed rendering: real luminances, auto exposure, bloom and filmic tone mapping.
- The Solar System at its true positions for any date: the Sun, 8 planets, 27 moons and 6 dwarf planets or asteroids,
  with textures, Saturn's rings, orbit lines and correct brightness when seen as points.
- 119,625 real stars (HYG catalogue) with true colours and brightness from any viewpoint, plus the Milky Way glow.
- Search palette, info cards, time controls (warp, pause, any date), HUD with speed and distance, shareable links.

Demo links and what to look for: [docs/demos/phase-1.md](docs/demos/phase-1.md).

## Controls

`/` search and fly · drag to look · `W` `A` `S` `D` fly · `R` / `F` up and down · `Q` / `E` roll · wheel or `[` `]`
speed · `O` orbit · `G` go to · `I` info · `,` `.` time warp · `P` pause · `N` now · `L` copy link · `H` hide UI ·
`?` help. Add `?perf=1` to the URL for an fps meter.

## Run locally

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm dev            # http://localhost:5173/my-third-repo/
pnpm verify         # typecheck, unit tests, production build, size guard
pnpm e2e            # headless Playwright smoke tests (Chromium)
```

Processed assets are committed under `public/`, so CI never downloads anything. To rebuild them, run
`pnpm assets:fetch` first (about 135 MB into `.cache/`), then `pnpm assets:build && pnpm credits`.
`pnpm contact-sheet` tiles the e2e screenshots in `artifacts/` into one review image.

`pnpm build && pnpm preview` serves the production build under the same `/my-third-repo/` subpath as GitHub Pages.

## Project docs

- `docs/DESIGN.md`: design and phase plan
- `docs/CONTRACTS.md`: module plug-in contracts
- `CLAUDE.md`: conventions for contributors and agents

App code is MIT-licensed. Data and textures keep their upstream licences: see [CREDITS.md](CREDITS.md) (also served as
`credits.json`). Pluto's texture is licensed for non-commercial use only.
