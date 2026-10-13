# Cosmos

Fly through a realistic universe in your browser: from standing on planet surfaces, through the Solar System and the Milky Way, out to the cosmic web. Real ephemerides and star catalogues place everything that can be known; physically motivated procedural models fill in the rest and are labelled "simulated".

**Live:** https://gcvillar9-bit.github.io/my-third-repo/ (needs WebGL2)

## Run locally

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm dev            # http://localhost:5173/my-third-repo/
pnpm verify         # typecheck, unit tests, production build, size guard
pnpm e2e            # headless Playwright smoke tests (Chromium)
```

`pnpm build && pnpm preview` serves the production build under the same `/my-third-repo/` subpath as GitHub Pages.

## Project docs

- `docs/DESIGN.md`: design and phase plan
- `docs/CONTRACTS.md`: module plug-in contracts
- `CLAUDE.md`: conventions for contributors and agents

App code is MIT-licensed. Data and textures keep their upstream licences (see the in-app credits).
