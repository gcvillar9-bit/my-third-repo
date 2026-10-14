# Exoplanets (P4-C)

Open Exoplanet Catalogue systems with "artist's impression" planets: `src/modules/exoplanets/`. Depends on
`stars`, `starsystems` and `sun`. Data: `public/data/exoplanets/systems.json` (tools/build-exoplanets.mjs).

## Data

- Source: `oec_tables/comma_separated/open_exoplanet_catalogue.txt` (MIT). Rows whose `list` contains
  "Confirmed planets": **5 288 planets in 4 019 systems** (908 KB JSON, 195 KB gzip, fetched at init, not on the
  boot path).
- Systems group planets by host name (planet name minus its last short token). Hosts are linked to a stars.bin
  index by HYG proper name, else by position within 90″ with a distance within ±40 %: 777 linked (51 Peg,
  Proxima, τ Ceti…); the rest (TRAPPIST-1, Kepler hosts) are custom stars from the OEC host parameters.
- Planet columns: suffix, radius R⊕, mass M⊕, period d, a AU, e, inclination °, Teq K, discovery year, method.

## Runtime

- Every 8 frames (every frame in tests) the nearest system within 0.5 pc of the camera is activated; it is
  released beyond 0.6 pc. Only one system is active, so the cost elsewhere is one scan over 4 019 positions.
- Activation: the host is promoted through `starSystems()` (HYG star with its system rows, or a custom star with
  M_V from L = R²(T/5772)⁴ and a rough cool-star bolometric correction, approximate). Each planet gets frame and
  body `exo:<system>:<suffix>` (kind `planet`, `simulated: true`) on a Kepler orbit in the host frame.
- Orbits: OEC a, e and inclination to the sky plane (transits without a value: 89.5°, others 60°), node and
  periastron 0, phase from a hash of the id (illustrative). Missing a or P comes from Kepler III with the host
  mass; missing radius from Chen & Kipping 2017; missing Teq from full redistribution with Bond albedo 0.3.
- Classes (`classify.ts`): R ≥ 6 R⊕ hot Jupiter (Teq ≥ 1000 K) or gas giant; 1.75-6 sub-Neptune; smaller: lava
  (≥ 1000 K), ocean (180-330 K), ice (< 180 K), rocky otherwise.
- Shading (`planet.glsl`, priority 10): class albedo, Lambert lit by the **host** (illuminance from its M_V and
  blackbody colour, not the Sun), latitude bands for giants, a faint glow for lava worlds and hot Jupiters.
- Overlay `exoplanets.system` (transparent layer, log depth, additive, display-referred): orbit ellipses in class
  colours, the conservative habitable zone (Kopparapu et al. 2013 runaway to maximum greenhouse) as a green
  annulus in the first planet's plane, and 5 px planet markers for unresolved planets. Buffers for 12 planets are
  allocated once and rewritten only on activation; hidden with no active system (zero draws).
- Setting `exoplanets.orbits` (boolean, persisted, default on) toggles the overlay.

## Discovery

- Search: one entry per placeable system (`exosys:<id>`, aliases = planet names) flying to a point 0.005 pc
  Sun-wards of the J2000 position (proper motion since J2000 stays small against that).
- Info: planets (`exo:<sys>:<suffix>`, "artist's impression", `simulated`), custom hosts and systems.
- Bookmarks (computed at 2026-01-01 UTC and setting that time; EV puts the host photosphere at about 2):
  `trappist-1`, `proxima-b`, `kepler-186f`, `51-peg-b`.

## Tests

- Unit `tests/unit/exoplanets/exoplanets.test.ts`: ≥ 4000 planets, unique ids, HYG links, TRAPPIST-1's seven
  planets, the Sun's HZ 0.95-1.7 AU, classes of famous planets, Proxima b and TRAPPIST-1 e inside their HZ.
- E2E `tests/e2e/exoplanets.spec.ts` (`@smoke`): `trappist-1` host lit and red at the centre, dark corners, at
  least three planet labels, zero errors, budgets.

## Not built (cut)

Procedural exoplanet surface detail; OpenNGC deep-sky markers.
