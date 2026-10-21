# Life at ground level (life)

Below 3 km above Earth's ground, the scene around the camera fills with the plants and animals of the
clock's era. You see dinosaurs at 66 Ma, Stegosaurus and sauropods at 150 Ma, Australopithecus at Hadar at
3.2 Ma, and Neanderthals and mammoths at 45 ka. Today it shows modern animals, livestock and people, and the
towns of the cities module. Everything is placed by fossil range, habitat and era, so it is approximate by
design (validity `life.species`).
Cross-module API: `src/modules/life/public.ts`.

## How it works

- **Activation** (`system.ts`): the camera is within `ACTIVE_ALTITUDE_M` (3 km) of Earth's ground
  (`view.nearestSurface()`). Above that the group is hidden and costs nothing. The scene is the same
  for walk mode and low flight.
- **Era** (`eraKey`): about 2.5% steps of the age, so the scene is stable at everyday clock rates and
  is rebuilt after a jump in time. Ages are years before 1950 (`core/geotime`); future dates count as 0.
- **Climate** (`paleo` `paleoClimate(jd)`, see `docs/modules/paleo.md`): a 720×360 map of the surface
  kind (sea, land, ice, exposed shelf), temperature and moisture.
  - Deep time: the same per-cell model as the synthetic surface, in PALEOMAP paleo-coordinates, so animals
    stand where the painted land is.
  - Since 2.6 Ma: today's map with observed moisture, cooled with the ice-age sea level. Sea floor bared
    by the lower sea level is kind shelf (Doggerland, Beringia) and the drawn ice sheets are ice.
  - Near the camera, `system.ts` `groundClimate` checks the modern map against the terrain heights: land
    at sea level becomes sea, and dry ground the map calls sea becomes land. Shelf cells stay land (the
    terrain has no bathymetry, so it cannot tell exposed sea floor from sea).
  - `ecology.ts` `biomeOf` turns land and shelf into rainforest, forest, taiga, savanna, grassland, steppe,
    desert or tundra (sea and ice have none).
- **Plants** (`flora.json`): era rows, from mosses at 470 Ma to grasslands from 20 Ma.
  - Each row gives a mix per biome and a density per biome, with sources.
  - `population.ts` fills 24 m cells deterministically from a hash of the cell and the era. Patches give
    glades and thickets.
  - Cells are rows of latitude, each split into a whole number of columns, so the grid wraps at the
    antimeridian: both sides of it (Taveuni, Chukotka) show the same plants and herds.
  - Trees are kept out to `treeRadius`, tufts to `tuftRadius` (by quality, `LIMITS`), nearest first.
    Filled cells stay cached up to 15000 (about three picks at ultra) before the cache is emptied.
- **Animals** (`species.json`): each row has an era range, habitats, a herd size, an abundance, and a
  range from either source:
  - PBDB fossil finds (`public/data/life/occurrences.json`, `tools/build-life.mjs`).
  - Hand-entered regions for hominins, humans and some living animals (boxes with time windows, with
    sources).

  `presence()` is 0 outside the species' own range (`lastMa` to `firstMa`, never widened, so the K-Pg
  and end-Permian extinctions are sharp; herd cells are cached per era, so a scene built before a
  boundary can keep its herds to the end of that era step) and 1 inside a region. Otherwise it falls
  off with the distance to the nearest find of about that age, up to 1800 km. A find matches when the
  age lies in its interval widened by a slack of 15% of the age below 2.6 Ma (at least 2 kyr) or 10% in
  deep time (at least 1 Myr). From 2.6 Ma on, finds are placed by their paleo-coordinates
  (`pgm=scotese`, the frame of the PaleoDEM maps); at younger ages, by their modern coordinates.

  Each 240 m cell may hold one herd: pick a guild present there, then a species by presence × habitat
  × abundance. The creature cap (`maxCreatures`) keeps the hand-placed herds first, then the nearest
  (`orderHerds`). The test hook `window.__life` `shown()` counts the animals drawn under the cap, and
  `debug().herds` lists every picked herd, drawn or not.

- **People and towns** (cities module `citiesAtJd` and `monumentsNear`, see `docs/modules/cities.md`):
  - Herd cells inside a town hold people instead of wild animals: townspeople, or people in modern
    clothes in modern and industrial towns.
  - Out to 1.6 town radii is farmland: livestock only (`cattle` and `sheep`, domestic rows with
    hand-entered regions from their domestication on), no wild herds. The filter also lets flyers
    through, but no flying species lives in the age of towns.
  - Homo sapiens herds younger than 8 ka are farmers and herders in the townspeople's clothes
    (`FARMING_FROM_MA`, approximate: farming spread unevenly).
  - Built-up land has no wild plants, apart from a few trees.
  - `buildingsAround` places the buildings of the towns in range. Houses stand in 22 m cells on blocks
    between streets (every fifth row and column), and the style's landmarks at the centre.
  - Before 1800, walled styles of more than 3000 people get a wall ring. It has a multiple of four
    segments, so one falls on each of the four main streets; leaving it out opens a gate of 22-26 m
    centred on the street.
  - Monuments stand at their real places. Each keeps its footprint and a 6 m lane clear of houses. A
    monument in town replaces the style landmark of its kind (Etemenanki is Babylon's ziggurat), and a
    style landmark that would overlap a monument of another kind is left out.
  - A pick (`system.ts`) takes the towns of the date (`citiesAtJd`) in two lists (`townsAround`). `built`
    feeds `buildingsAround`: towns whose wall ring (1.02 radii plus two building cells) is within the
    building radius, or whose centre is within 4x the building radius plus 100 m (landmarks). `near`
    feeds `townAt`: towns within 1.6 radii plus √2 × (herd radius + 240 m), measured from the town
    centre, so a cached herd cell holds people, livestock or wild animals wherever the camera stood.
  - Monuments come from `monumentsNear` within `monumentRange`: 4x the building radius plus 100 m plus
    5 km. A monument that replaces a style landmark is then passed wherever that landmark is drawn (the
    Empire State Building stands 4.7 km from New York's centre), so the two never swap as you approach.
  - Towns change within an era (all of 1950 to today is one era). A pick also runs, at most five times
    a second, when the half-year date step `townYearKey` changes: the cities table steps by a decade
    before 1800 and a year after, and monuments and walls switch on whole years. The herd cache is
    cleared then. Before the first towns (cities `TOWNS_FROM_YEAR`) the key does not change.

- **Motion** (`memberAt`):
  - Each animal walks an elliptical loop around its home in the herd, with a speed that swells and
    stops (grazers lower their heads while standing).
  - Real time drives it, so warping the clock does not make animals race.
  - The gait phase is integrated from the distance walked, so the feet match the ground speed.
  - Pterosaurs circle 25-70 m up.
- **Rendering**:
  - One `InstancedBufferGeometry` per model.
  - Every material shares one program (same shader source). A uniform `uGait` per model sets the gait.
  - Draws: one per model present, typically 6-12.
  - Instances are offsets from an anchor ground point that snaps to a 0.002 degree grid, so they stay
    small in Float32. The shader turns the anchor's tangent frame into world axes. Crossing an anchor
    cell only rewrites the offsets from the cached ground positions; the next pick waits for its turn.
  - Ground heights come from `terrainHeightAt` (terrain `public.ts`): the exact finest-level ground of
    the drawn mesh. When the height function changes (`terrainHeightGeneration`: the first heights, HD
    terrain blocks), the scene is seated again and its cached cells are rebuilt.
- **Shading** (`glsl/life.frag.glsl`):
  - Faceted Lambert with the normal from screen-space derivatives (no normal attribute, so posed limbs
    stay faceted).
  - Sun through the atmosphere (`atmoSunTransmittance`), plus a blue sky term and ground bounce.
  - Aerial perspective comes from the atmosphere composite.
- **Labels**: the nearest individual of each species within 400 m gets its name (UI label source `life`).
  This needed the label overlay to test occlusion against the polar radius, because ground-level points
  sit inside the equatorial sphere (`src/ui/labels.ts`).

## Models (`kit/`)

Procedural, stylised low-poly at real sizes (`kit/models.ts`). A generic body-plan builder
(`kit/creatures.ts`) handles:

- Plans: quadrupeds, bipeds (theropods, hadrosaurs), sprawlers (Permian synapsids), upright primates
  and pterosaurs.
- Extras: sails, plates, frills, horns, crests, trunks, tusks, armour, manes and shaggy coats.

Each vertex carries its joint (hip, knee, neck or tail pivot). `glsl/life.vert.glsl` poses the joints
from the gait phase:

- Quadrupeds walk in a lateral sequence; bipeds and uprights walk in antiphase, each arm swinging with
  the opposite leg.
- Tails sway, necks nod and graze, wings flap.
- Plants (`kit/plants.ts`: mosses, Cooksonia, scale trees, horsetails, tree ferns, seed ferns, conifers,
  araucarias, cycads, ginkgos, broadleaf trees, palms, birches, shrubs, grass, cacti) sway in the wind
  by height. Each vertex carries a sway weight, 0 at the root. A blob's `bendBase` option
  (`kit/mesh.ts`) blends the weight ring by ring from `bendBase` at its bottom pole to `bend` at its top
  (without it the whole blob has `bend`), so a shrub with `bendBase: 0` stays rooted in the ground.

Downloadable CC0 packs (Quaternius) were the plan. Their Google Drive host answers "quota exceeded" from
the build environment, so the models are generated in code instead: no download and no licence; each
model's geometry is built the first time it is needed (a few hundred to a thousand triangles).

## Bookmarks (`sites.json`, `bookmarks.ts`)

Each bookmark stands on the ground in walk mode, facing north at local midday (the Sun behind the
camera), with a 40 degree field of view. Each site places a few herds by hand in view (`featuredHerds`).
Unit tests check that those species lived there and then.

| Id                    | Where and when (globe as drawn)                                                |
| --------------------- | ------------------------------------------------------------------------------ |
| `life-trex-66ma`      | 50 N 79.5 W paleo (Hell Creek area): T. rex, ceratopsids, hadrosaurs           |
| `life-jurassic-150ma` | 31.5 N 60.5 W paleo (Morrison Formation): Stegosaurus, diplodocids, Allosaurus |
| `life-permian-252ma`  | 33 N 38 E paleo (Russian Platform): pareiasaurs, gorgonopsians, dicynodonts    |
| `life-lucy-3ma`       | 11.1 N 40.6 E (Hadar, Ethiopia): Australopithecus, elephants, giraffes         |
| `life-mammoth-45ka`   | 48 N 38 E (mammoth steppe): Neanderthals, mammoths, horses                     |

## Data

- `public/data/life/occurrences.json`: 285 KB, loaded the first time life is active. The scene waits
  until it has loaded or failed before its first pick, so no herd cell is cached without it. It is built by
  `node tools/build-life.mjs` (add `--refresh` to download again with curl; raw responses are cached
  in `.cache/raw/life`).
- The PBDB API embeds a timing field, so its responses are not byte-stable. The manifest entry is
  therefore a reference without a URL, and the derived snapshot is committed (CC BY 4.0, credited).

## Tests

- **Unit** (`tests/unit/life`):
  - The data: models, sources, contiguous flora eras.
  - Biomes, with exposed shelf as land; ranges (T. rex only in Late Cretaceous Laramidia; species gone
    just past their own first and last appearance; the human dispersal; featured herds alive where
    placed; candidates of the time).
  - Kit sanity: finite, on the ground, joints; winding (every blob, loft, cone and building face wound
    counter-clockwise from outside, because the life material culls back faces; blobs closed); no
    uniform or attribute that clashes with three.js; zero sway at plant roots; arms swinging with the
    opposite leg.
  - Population determinism and limits; the same cells on both sides of the antimeridian; motion
    consistency.
  - Settlements (`population.test.ts`): no house on a monument at the city bookmarks, monuments
    replacing the style landmark of their kind, a wall gate on each of the four main streets.
  - The system (`system.test.ts`): the date step of towns; towns in range (`built`, `near` from the town
    centre) and the monument range; herd order under the cap; the ground climate (shelf kept as land);
    waiting for the fossil finds; seating again when the terrain heights change; crossing an anchor
    cell; re-picking the towns when the date changes inside an era.
- **E2E** (`tests/e2e/life.spec.ts`):
  - Four bookmarks with their cast (test hook `window.__life`) and the horizon band holding trees and
    animals. Species that must be absent are checked in every picked herd (`debug().herds`), so the
    creature cap cannot hide them.
  - The T. rex site set to today has no dinosaurs.
  - Budgets: at most 150 draws and 60 programs on potato.

## Known gaps

- Ground cover is sparse at grass scale (no grass texture yet), and all plants of a kind share one
  variant mesh.
- People are generic: townspeople in the streets and farmers in the fields, without trades or crowds.
- No cast shadows; animals do not avoid each other, trees or water. Herds do not migrate.
- Presence by distance to finds is coarse: it can put a species a little beyond its real range, and sparse
  records leave gaps.
- Deep-time terrain heights are today's relief at the paleo-coordinates (see paleo Known gaps).
