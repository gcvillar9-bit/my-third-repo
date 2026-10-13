# Rings (P3-A)

Saturn's and Uranus's rings at their true radii. Replaces solar-system's ring v1: at init the module removes the
renderable `solar-system.rings.saturn` through the registry and registers `rings.saturn` and `rings.uranus`.
Cross-module API: `src/modules/rings/public.ts`.

## Model (`rings.json`, `model.ts`)

- Regions in km from the planet centre, with typical normal optical depth `tau`, effective single-scattering
  `albedo`, `dust` fraction and a `source` for every row (NSSDCA Saturnian and Uranian ring fact sheets). Later
  rows override earlier ones, so gaps (Encke, Keeler) cut through the A ring.
- Saturn: D ring 66,900 km to the F ring at 140,180 km; Cassini Division 117,580-122,170 km (tested). Uranus: rings
  6, 5, 4, alpha, beta, eta, gamma, delta, lambda and epsilon at their fact-sheet radii and widths, very dark
  (albedo 0.04-0.05); epsilon has the largest equivalent width and is the brightest (tested).
- **Profile bake** (`bakeProfile`): 4096 linear RGBA texels over the system's extent: R = albedo, G = normal opacity
  1 − e^(−τ), B = dust fraction. Eight sub-samples per texel keep a 2 km ringlet's equivalent width. For Saturn
  the Celestia strip (`textures/solar-system/saturn_rings_profile.png`, decoded with `DecompressionStream`) adds
  fine structure inside the C, B, A rings and the Cassini Division: τ(r) = τ_region · α_img(r) / mean(α_img),
  so region means and boundaries stay those of the model. Until the strip loads, the model-only bake is shown.
- **Texture**: half-float, with a CPU box-filtered mip chain (`mipChain`), so narrow Uranian ringlets fade by
  coverage at distance instead of aliasing. Shared by the ring mesh and the globe's ring shadow.

## Rendering (`render.ts`, `glsl/rings.glsl`)

- One quad in the `<body>.fixed` equatorial plane scaled to the outer radius; the fragment computes the radius
  exactly (no chord sag) and discards outside the profile. Transparent layer, premultiplied alpha
  (rgb = L·exposure, a = slant opacity 1 − e^(−τ/|μ|)), drawn once the outer diameter exceeds 3 px.
- Single-scattering slab (Chandrasekhar): lit face I/F = ϖP/4 · μ0/(μ0+μ) · (1 − e^(−τ(1/μ0+1/μ))); unlit face
  diffuse transmission ϖP/4 · μ0/(μ0−μ) · (e^(−τ/μ0) − e^(−τ/μ)). P = 4π·[(1−d)·HG(g = −0.35) + d·HG(g = 0.7)]:
  icy particles backscatter (lit B ring brightest at low phase), dust forward-scatters (backlit D, F, Roche and
  Cassini Division glow). |μ| is clamped at 0.01 near equinox and edge-on views.
- Planet shadow on the rings: `shadows.glsl` with the planet as a sphere occluder (exact penumbra).

## Ring shadow on the globe (`public.ts`, `glsl/ring-shadow.glsl`)

`RING_SHADOW_GLSL` defines `ringSunTransmission(p, sunDir)`: ray-plane intersection from the surface point
towards the Sun, transmission (1 − opacity)^(1/|μ0|) at the hit radius. `ringShadowUniforms(bodyId)` returns the
shared uniforms (profile, camera-relative centre, normal, range), updated once per frame in `render.onBeforeFrame`.
The giants shading uses it for Saturn and Uranus.

## Known gaps

- No ring-particle fly-through, no E/G rings, no Saturnshine on the unlit face, no ringshine on the planet.
- Ring brightness uses single scattering with an effective albedo (multiple scattering in the B ring is folded
  into `albedo`, marked approximate). Ring colour is one tint per system.
- The planet shadow uses a sphere of the equatorial radius (Saturn's oblateness is ignored for the shadow).
