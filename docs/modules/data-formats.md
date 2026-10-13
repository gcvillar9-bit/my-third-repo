# Data formats (P1-B)

Byte-exact specs of the data that `tools/build-solar-system.mjs` and `tools/build-stars.mjs` write under `public/`.
Browser decoders can be written from this page alone. The reference Node decoder for `stars.bin` is
`tools/lib/stars-format.mjs` (`decodeStars`); its round trip is tested in `tests/unit/tools/stars.test.ts`.

Load every file through the asset loader with a path relative to the public root (for example
`assets.binary('data/stars/stars.bin')`). Never hard-code `/`.

| Path                                                              | Format        | Size         |
| ----------------------------------------------------------------- | ------------- | ------------ |
| `data/stars/stars.bin`                                            | binary, below | 2.87 MB      |
| `data/stars/names.json`                                           | JSON, below   | 116 KB       |
| `data/solar-system/bodies.json`                                   | JSON, below   | 37 KB        |
| `textures/solar-system/*.webp`, `*.png`                           | images, below | ~19 MB total |
| `textures/stars/milkyway_diffuse_{2k,4k}.webp`, `fallback_*.webp` | images, below | ~0.2 MB      |
| `credits.json`                                                    | JSON, below   | ~40 KB       |

## `data/stars/stars.bin` (version 1)

All values little-endian. A 64-byte header is followed by six structure-of-arrays sections. Each section starts at
the offset stored in the header (always a multiple of 4). Read the offsets from the header rather than computing
them.

### Header (64 bytes)

| Offset | Type   | Field        | Value / meaning                                |
| ------ | ------ | ------------ | ---------------------------------------------- |
| 0      | u8[4]  | magic        | ASCII `STAR` (`53 54 41 52`)                   |
| 4      | u16    | version      | `1`                                            |
| 6      | u16    | headerBytes  | `64`                                           |
| 8      | u32    | count        | number of stars N (119 625 for HYG v4.1)       |
| 12     | f32    | bvMin        | `-0.5`: B-V of code 0                          |
| 16     | f32    | bvStep       | `0.014`: B-V per code step                     |
| 20     | u32    | offPosition  | byte offset of the position section            |
| 24     | u32    | offAbsMag    | byte offset of the absolute-magnitude section  |
| 28     | u32    | offVelocity  | byte offset of the velocity section            |
| 32     | u32    | offNameIndex | byte offset of the name-index section          |
| 36     | u32    | offBv        | byte offset of the B-V section                 |
| 40     | u32    | offFlags     | byte offset of the flags section               |
| 44     | u32    | namesCount   | number of rows in `names.json`                 |
| 48     | f32    | epochYear    | `2000.0`: epoch of the positions (Julian year) |
| 52     | u8[12] | reserved     | zero                                           |

The current file has offsets `64, 1435564, 1674816, 2392568, 2631820, 2751448` and a total of 2 871 076 bytes.

### Sections (star `i`, 0-based)

| Section   | Element type | Bytes | Content                                                                                                                                                                                            |
| --------- | ------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| position  | f32 × 3      | 12N   | `x, y, z` at `off + 12i`, in **parsecs**, ICRS/J2000 equatorial axes (x towards RA 0h, z towards the north celestial pole), origin at the Sun. Directly usable as a `THREE.BufferAttribute(…, 3)`. |
| absMag    | f16          | 2N    | absolute visual magnitude M_V (HYG `absmag`). IEEE 754 binary16 (`Float16`/`HalfFloatType` compatible).                                                                                            |
| velocity  | f16 × 3      | 6N    | `vx, vy, vz` in **km/s**, same axes (HYG pc/yr × 977 792.2). Clamped to ±60 000. Zero when `FLAG_DIST_UNKNOWN`.                                                                                    |
| nameIndex | u16          | 2N    | row in `names.json`'s `rows`, or `0xFFFF` when the star has no name                                                                                                                                |
| bv        | u8           | N     | B-V colour index: `bvMin + code × bvStep` (range −0.5 to +3.056, resolution 0.014). `255` = unknown (1 891 stars).                                                                                 |
| flags     | u8           | N     | bit field, below                                                                                                                                                                                   |

Flag bits:

| Bit | Mask | Name         | Meaning                                                                                                                                                                                                                                                           |
| --- | ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | 1    | NAMED        | has a `names.json` row (proper name, Bayer or Flamsteed designation)                                                                                                                                                                                              |
| 1   | 2    | VARIABLE     | HYG `var` is set                                                                                                                                                                                                                                                  |
| 2   | 4    | MULTIPLE     | member of a multiple system (HYG `base` is set)                                                                                                                                                                                                                   |
| 3   | 8    | DIST_UNKNOWN | no usable parallax. HYG puts these 10 225 stars at 100 000 pc and derives `absMag` from that distance, so `M + 5·log10(d/10 pc)` still gives the correct apparent magnitude from the Sun. Treat them as fixed-direction background stars; their velocity is zero. |
| 4   | 16   | HIPPARCOS    | has a Hipparcos id (in `names.json` only for named stars)                                                                                                                                                                                                         |
| 5-7 |      |              | reserved (0)                                                                                                                                                                                                                                                      |

**Order.** Stars are sorted by HYG apparent magnitude `mag`, brightest first, with ties broken by HYG `id`. Star 0
is Sirius. The Sun (HYG id 0) is excluded. A prefix `[0, k)` is therefore the k brightest stars, which suits
quality-based point counts.

**Apparent magnitude** from a viewpoint `p` (parsecs, same frame): `m = M + 5·log10(|pos − p| / 10)`.
**Proper motion:** `pos(t) = pos + v · (t − 2000.0 yr) · 1.0227e-6 pc/(km/s·yr)`, linear (DESIGN 3.2: valid to ±1 Myr).

**Corrections.** `names.json` → `overrides` lists hand-entered fixes applied at build time, each with a `source`.
Currently only Betelgeuse's B-V is changed: Hipparcos/HYG lists 1.500, and the build uses the Bright Star
Catalogue's +1.85.

Reference decoding (JS):

```js
const v = new DataView(buf);
const n = v.getUint32(8, true);
const off = (k) => v.getUint32(20 + 4 * k, true);
const pos = new Float32Array(buf, off(0), 3 * n);
const absMagF16 = new Uint16Array(buf, off(1), n); // upload as HalfFloatType, or decode
const velF16 = new Uint16Array(buf, off(2), 3 * n);
const nameIndex = new Uint16Array(buf, off(3), n);
const bvCode = new Uint8Array(buf, off(4), n);
const flags = new Uint8Array(buf, off(5), n);
```

binary16 → float: `sign · 2^(e−15) · (1 + m/1024)` for `e = 1..30`, `sign · 2^−14 · (m/1024)` for `e = 0`
(see `fromHalf` in `tools/lib/binary.mjs`).

## `data/stars/names.json`

```json
{
  "version": 1,
  "source": "HYG Database v4.1 (CC BY-SA 4.0); ...",
  "columns": ["star", "hip", "proper", "bayer", "flamsteed", "con"],
  "rows": [[0, 32349, "Sirius", "α", 9, "CMa"], [1, 30438, "Canopus", "α", null, "Car"], ...],
  "constellations": { "And": "Andromeda", ..., "Vul": "Vulpecula" },
  "overrides": [{ "hip": 27989, "name": "Betelgeuse", "bv": 1.85, "source": "..." }]
}
```

- `rows[k]` is the star with `nameIndex == k`. `star` is the index into `stars.bin`, so the link works both ways.
  Rows are in `stars.bin` order (brightest first). There are 3 443 rows: every HYG star with a proper name, a Bayer
  letter or a Flamsteed number.
- `hip`: Hipparcos number or `null`. `proper`: IAU or common proper name or `null`.
- `bayer`: display form, with Greek letters and superscript component numbers (`"α"`, `"γ¹"`). Latin Bayer letters
  are kept as written (`"b"`). `null` when absent.
- `flamsteed`: number or `null`. `con`: IAU 3-letter constellation abbreviation (key into `constellations`) or `null`.
- Display designations: `${bayer} ${con}` (for example "α CMa") or `${flamsteed} ${con}` ("9 CMa").

## `data/solar-system/bodies.json`

```json
{
  "version": 1,
  "units": { "radius": "km", "gm": "km^3/s^2", "angles": "deg", ... },
  "frames": { "ecliptic-j2000": "...", "equator-j2000": "...", "icrf-axes": "...", "parent-equator": "..." },
  "bodies": [ BodyRow, ... ]
}
```

There are 42 rows: the Sun, 8 planets, the Moon, 25 other moons (Phobos, Deimos, the 4 Galilean moons, Amalthea,
Himalia, Mimas, Enceladus, Tethys, Dione, Rhea, Titan, Hyperion, Iapetus, Phoebe, Miranda, Ariel, Umbriel, Titania,
Oberon, Proteus, Triton, Nereid), plus Pluto, Charon, Ceres, Vesta, Eris, Haumea and Makemake. Parents come before
their children.

`BodyRow` (optional fields are omitted when unknown, never `null`, except `parent` of the Sun):

| Field                             | Type                                       | Meaning                                                                                                   |
| --------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `id`                              | string                                     | lower-case id, also the frame id (`"titan"`)                                                              |
| `name`                            | string                                     | display name                                                                                              |
| `kind`                            | `star \| planet \| dwarf \| moon \| minor` | matches `Body.kind`                                                                                       |
| `parent`                          | string \| null                             | parent body id (moons → planet, planets → `sun`)                                                          |
| `ephemeris`                       | `astronomy-engine \| kepler`               | `astronomy-engine` for the Sun, planets, Moon, Galilean moons and Pluto. Everything else uses `elements`. |
| `radius`                          | number                                     | mean radius, km (always present)                                                                          |
| `radiusEquatorial`, `radiusPolar` | number?                                    | km. `oblateness = (eq − polar) / eq` is given when both are known.                                        |
| `gm`                              | number                                     | km³/s² (always present; planet only, without moons)                                                       |
| `albedoGeometric`, `albedoBond`   | number?                                    | geometric (V) and Bond albedo                                                                             |
| `teff`, `absMag`                  | number?                                    | Sun only: 5772 K, M_V 4.83                                                                                |
| `approximate`                     | true?                                      | radius or GM is a rough estimate (show as "approximate" in the UI)                                        |
| `rotation`                        | object?                                    | below                                                                                                     |
| `elements`                        | object?                                    | below. Present for every `kepler` body and for Pluto (barycentre fallback).                               |
| `rings`                           | object?                                    | `{ inner, outer, source }`, km from the planet centre (Celestia), for Jupiter, Saturn, Uranus and Neptune |
| `textures`                        | object?                                    | texture paths, below                                                                                      |
| `source`                          | string                                     | provenance of this row's numbers                                                                          |

`rotation` follows IAU WGCCRE leading terms, with `T` in Julian centuries and `d` in days from J2000 TDB:

- Pole: `α0 = ra0 + raRate·T`, `δ0 = dec0 + decRate·T` (ICRF, degrees; rates default to 0).
- Prime meridian: `W = w0 + wdot·d` (degrees), measured eastward along the body equator from its ascending node on
  the ICRF equator (RA `α0 + 90°`).
- Body-fixed axes: +z is the north pole `(α0, δ0)` and +x is the prime meridian.
- `periodHours = 24·360/wdot` is negative for retrograde rotators (Venus, Uranus, Pluto and its moons).
- `synchronous: true` marks tidally locked bodies. Triton has no pole: orient it to its orbit (retrograde, locked).
  `chaotic: true` marks Hyperion. Eris, Haumea and Makemake have only `periodHours`.
- `approximate: true` marks rows whose periodic terms omitted here exceed about 0.5°. For the Sun, Earth, Moon and
  planets, astronomy-engine `RotationAxis` gives the full model and is preferred.

`elements` (Keplerian, osculating at `epoch`, from Celestia `.ssc`):

| Field                                 | Meaning                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `epoch`                               | JD (TDB ≈ TT)                                                                                                                                                                    |
| `frame`                               | reference plane, one of `frames` (see below)                                                                                                                                     |
| `axes`                                | only for `icrf-axes`: `{x, y, z}`, orthonormal ICRF unit vectors of the reference frame                                                                                          |
| `center`                              | body id of the attracting centre (`"saturn"`, `"sun"`, `"pluto"`) or `"ssb"` (the Solar System barycentre frame)                                                                 |
| `a`                                   | semi-major axis, km                                                                                                                                                              |
| `e`                                   | eccentricity (all < 1)                                                                                                                                                           |
| `i`, `node`, `argPeri`, `meanAnomaly` | inclination, longitude of ascending node, argument of pericentre, mean anomaly at epoch, degrees                                                                                 |
| `period`                              | sidereal period, days, as given by Celestia. Use `n = 360/period` deg/day. This matches Kepler's third law with `gm(center) + gm` to within 1%, except Hyperion (2%, resonance). |
| `source`                              | file, and whether the block was Celestia's commented-out fallback of a `CustomOrbit`                                                                                             |

Frames:

- `ecliptic-j2000`: the mean ecliptic and equinox of J2000. To ICRF, rotate about x by +ε, with ε = 84381.406″.
- `equator-j2000`: ICRF axes.
- `icrf-axes`: the explicit `axes` (used by Amalthea, whose frame is Jupiter's equator at epoch).
- `parent-equator`: Celestia's default for satellites with no OrbitFrame (Phobos and Deimos). The xy-plane is the
  parent's equator, with the pole from the parent's `rotation.ra0/dec0` at J2000. The x axis is the ascending node
  of that equator on the ICRF equator, unit vector `(−sin α0, cos α0, 0)`.

Orbit position: solve Kepler's equation for `M = meanAnomaly + 360·(jd − epoch)/period`. In the orbital plane, take
`(a(cos E − e), a√(1−e²) sin E, 0)`, rotate by `Rz(node)·Rx(i)·Rz(argPeri)` into the frame, then into ICRF.

Pluto/Charon: Pluto's `elements` are the heliocentric orbit of the Pluto-Charon barycentre (Celestia). Charon's are
Pluto-relative, with `a = 19 595.764 km`, the sum of both barycentric semi-major axes.

`textures` maps a role to either a path or a `{tier: path}` map. Paths are relative to the public root.

| Role          | Bodies                  | Notes                                                                                                                              |
| ------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `diffuse`     | all bodies with imagery | sRGB colour. Earth: day (Blue Marble). Venus: Celestia cloud tops.                                                                 |
| `night`       | earth                   | city lights, sRGB                                                                                                                  |
| `brc`         | earth                   | channel-packed **linear** data: R = bump/height, G = roughness, B = clouds. Near-lossless WebP (q40) keeps channels independent.   |
| `normal`      | earth                   | tangent-space normal map, linear                                                                                                   |
| `specular`    | earth                   | ocean/specular mask, linear (white = water)                                                                                        |
| `surface`     | venus                   | radar surface under the clouds (SSS), sRGB                                                                                         |
| `ring`        | saturn                  | `saturn_ring_sss.png`: 4096×1 RGBA. x runs radially from `rings.inner` (x = 0) to `rings.outer`. RGB = colour (sRGB), A = opacity. |
| `ringProfile` | saturn, uranus          | Celestia `*-rings.png`: 4096×1 RGBA, same radial mapping (byte-exact copy)                                                         |

## Texture naming and conventions

- `textures/<module>/<name>_<tier>.webp`, with tier `2k` = 2048×1024 and `4k` = 4096×2048. Quality-preset
  `maxTextureSize` picks the tier. The 2k tier always exists when a 4k one does.
- Every planetary map is equirectangular: u = 0 at longitude −180°, u = 0.5 at the prime meridian, longitude
  increasing eastward to the right, north at the top (v = 0 in image rows). With three.js `flipY = true`, uv.y = 1
  is the north pole.
- Colour maps are sRGB WebP (q85 at 2k, q80 at 4k). Data maps (`brc`, `normal`, `specular`) must be sampled as
  linear (`NoColorSpace`).
- Bodies with 2k only: the Celestia moons and dwarf planets, Uranus and Neptune.
- **Pluto's texture is CC BY-NC-SA 3.0 (non-commercial)** and is flagged in `credits.json`.

### `textures/stars/`

- `milkyway_diffuse_{2k,4k}.webp`: the Solar System Scope Milky Way panorama with point stars removed (5×5 median at
  8k, then a radius-2 morphological opening). HYG supplies the stars. The panorama is in **galactic** coordinates,
  equirectangular: u = 0.5 − l/360° (l = 0 at the centre, increasing to the left), v = 0.5 − b/180° (north galactic
  pole at the top row). The upstream file has south at the top; the build flips it, and the orientation was checked
  against HYG bright stars. Galactic → ICRS uses the transpose of the J2000 matrix
  `[[−0.0548755604, −0.8734370902, −0.4838350155], [0.4941094279, −0.4448296300, 0.7469822445], [−0.8676661490, −0.1980763734, 0.4559837762]]`
  (rows: galactic x, y, z in ICRS).
- `fallback_{px,nx,py,ny,pz,nz}.webp`: the three.js `cube/MilkyWay` faces at 512² in three.js `CubeTextureLoader`
  order. Their orientation is three.js's and not tied to ICRS. Use them only as a fallback.

## `credits.json`

`{ version: 1, about, licenses: { <SPDX>: { name, url } }, entries: [Entry] }`. Each `Entry` has `module`, `id`,
`url` (or `null` for cited references), `license` (SPDX id or `"reference"`), `licenseName`, `licenseUrl`,
`attribution`, `copyright[]`, `flags[]` (`"non-commercial"`), `note`, `outputs[]` (public paths) and `licenseText`
(the verbatim upstream `.license` sidecar or `null`). It is generated from `assets/manifest/*.json` by
`pnpm credits`.

## Asset manifests (`assets/manifest/<module>.json`)

`{ module, assets: [Asset] }`. Each `Asset` has `id`, `url`, optional `file` (cache name), `sha256` and `bytes`
(both recorded by the first `pnpm assets:fetch`), `license`, `attribution`, optional `copyright[]`, optional
`licenseSidecar: { url, sha256, text }` (`text` is recorded at fetch time), optional `flags[]`, optional `note`, and
`outputs[]` (public paths). An entry without `url` is a cited reference that is never downloaded. Downloads use
`curl -fsSL --retry 3` into `.cache/raw/<module>/`. Git LFS files must use `media.githubusercontent.com`; an LFS
pointer is rejected.
