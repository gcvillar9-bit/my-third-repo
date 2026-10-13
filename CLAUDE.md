# Cosmos: agent guide

Static browser app (three.js WebGL2, Vite, TypeScript) for flying through a realistic universe, from planet surfaces to the cosmic web. Source of truth: `docs/DESIGN.md` (read only the sections your brief names). Contracts: `src/core/contracts.ts` + `docs/CONTRACTS.md`. Live site: https://gcvillar9-bit.github.io/my-third-repo/

## Commands (pnpm only, Node 22)

- `pnpm dev` / `pnpm build` / `pnpm preview`
- `pnpm typecheck`: `tsc` on `tsconfig.json` (src, DOM) and `tsconfig.node.json` (tests and configs, adds Node types)
- `pnpm test -- <filter> --reporter=dot` (vitest, Node environment, `tests/unit/**/*.test.ts`)
- `E2E_PORT=<4173|4174> pnpm e2e -- tests/e2e/<module>.spec.ts` (Playwright, flock-serialised)
- `pnpm assets:fetch`, `pnpm assets:build` (runs every `tools/build-*.mjs` except credits), `pnpm credits`
- `pnpm size-guard` (after build) and `pnpm verify` (typecheck, test, build, size-guard). Must stay green.

## Never read (cost)

`node_modules`, `.cache`, `dist`, `artifacts`, `pnpm-lock.yaml`, `public/data/**`, `public/textures/**`, other packages' artifacts. Inspect big or binary files with `ls`, `wc` and `head` only. Prefer `grep -n` plus line ranges over whole-file reads.

## Ownership (DESIGN 3.5)

- Edit only the globs your brief grants. Package-owned: `src/modules/<m>/**`, `tests/unit/<m>/**`, `tests/e2e/<m>.spec.ts`, `tests/fixtures/<m>/**`, `tools/build-<m>.mjs`, `assets/manifest/<m>.json`, `public/{textures,data}/<m>/**`, `docs/modules/<m>.md`, `docs/status/<pkg>.md`, `docs/requests/<pkg>.md`.
- Integrator-owned: root configs, `package.json`, the lockfile, `.github/**`, this file, `docs/CONTRACTS.md`, `src/core/**`, `src/render/**`, `src/camera/**`, `src/app/**`, `tools/lib/**`, `tools/{fetch-assets,build-credits,size-guard}.mjs`.
- Cross-module imports only from `src/core/**`, `src/render/chunks/**` and another module's `public.ts`.
- No new npm dependencies and no contract edits. Write `docs/requests/<pkg>.md` and shim inside your own files.

## Conventions

- **Units:** metres, seconds, radians as float64. JD is TT. Positions live in the Float64 frame tree (`universe > mw > ssb > <body> > <body>.fixed`). World axes are ICRF/J2000.
- **Camera-relative rendering:** the three.js camera stays at the origin and only rotates. Set `object.position` from `view.toCamera(frame, local, out)` every frame. Large point clouds use the `rte.glsl` high/low split. Never put absolute float64 positions in Float32 buffers.
- **Depth:** log depth, near 0.05 m, far 1e27 m. Every `ShaderMaterial`/`RawShaderMaterial` must include `src/render/chunks/depth.glsl`; a conventions test enforces this.
- **Light:** shaders output `L[cd/m²] * uExposure` (pre-exposure). Use the shared uniforms from `render.uniforms`.
- **GLSL:** separate `.glsl` files imported with `?raw`.
- **Assets:** never hard-code `/` URLs. Use `assets.url('data/<m>/x.bin')` or `import.meta.env.BASE_URL + 'data/...'`. The site is served from `/my-third-repo/`, and the base can be overridden with env `BASE`.
- **Workers:** `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` with comlink `expose`.
- **Hand-entered numbers:** keep them in JSON rows with a `source` field. Show uncertain values as `approximate` in the UI.
- **Types:** with both DOM and Node types in tests, store timer ids as `ReturnType<typeof setTimeout>`.
- **Style:** prettier (`pnpm format`), single quotes, width 110. There is no eslint.

## E2E rules

- Always 480x270 on potato: `page.goto('?test=1&q=potato&b=<bookmark>')`. The URL is relative and must have no leading `/`, so it resolves under `/my-third-repo/`.
- Flow: `await __universe.ready()`, then `renderFrames(4)`, then screenshot to `artifacts/<module>/<bookmark>.png`. rAF is off in test mode.
- Assert semantic pixel probes (`probe`), `errors()` empty and `stats()` budgets. Never golden images.
- At most 4 bookmarks per spec, 120 s per test. Read at most 6 screenshots per package.
- Run only through `pnpm e2e` (flock on `/tmp/universe-pw.lock`) with your `E2E_PORT`. Never run `playwright install` locally: browsers are in `/opt/pw-browsers` (chromium-1194, SwiftShader).
- Default server is `vite build` + `vite preview`; set `E2E_SERVER=dev` locally for the dev server. CI runs every `@smoke`-tagged test.

## Network

Only registry.npmjs.org, raw.githubusercontent.com and media.githubusercontent.com are reachable. Download with `curl`, because Node `fetch` ignores the proxy.

## Git

- Work on your assigned branch. Never push `main`.
- Every commit message ends with a blank line and then exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NLFG56DKEzxbaRG3L553Vg
  ```
- Never write model ID strings in code, docs or commits.
- When you hit your turn cap, commit and write `docs/status/<pkg>.md` (done, gaps, requests; at most 30 lines).

## Toolchain notes

- Pinned exactly: vite 8.3.4 + vitest 5.0.4 (verified to work together, so no vite 7 fallback was needed), typescript 5.9.3, @playwright/test 1.56.1, three 0.186.1 (postprocessing 6.39.5 needs three below 0.187), preact 10.29.8 + @preact/signals 2.11.3.
- three and postprocessing are built into their own `three` chunk (`vite.config.ts`).
