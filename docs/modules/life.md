# Life at ground level (life)

Below 3 km above Earth's ground, the scene around the camera fills with the plants and animals of the
clock's era. You see dinosaurs at 66 Ma, Stegosaurus and sauropods at 150 Ma, Australopithecus at Hadar at
3.2 Ma, and Neanderthals and mammoths at 45 ka. Today it shows modern animals. Everything is placed by fossil range,
habitat and era, so it is approximate by design (validity `life.species`).
Cross-module API: `src/modules/life/public.ts`.

## How it works

- **Activation** (`system.ts`): the camera is within `ACTIVE_ALTITUDE_M` (3 km) of Earth's ground
  (`view.nearestSurface()`). Above that the group is hidden and costs nothing. The scene is the same
  for walk mode and low flight.
- **Era** (`eraKey`): about 2.5% steps of the age, so the scene is stable at everyday clock rates and
  is rebuilt after a jump in time. Ages are years before 1950 (`core/geotime`); future dates count as 0.
- **Climate** (`paleo` `paleoClimate(jd)`, see `docs/modules/paleo.md`): a 720×360 map of the surface
  kind (sea, land, ice), temperature and moisture.
  - Deep time: the same per-cell model as the synthetic surface, in PALEOMAP paleo-coordinates, so animals
    stand where the painted land is.
  - Since 2.6 Ma: today's map with observed moisture, cooled with the ice-age sea level. Exposed shelves
    are land (Doggerland, Beringia) and the drawn ice sheets are ice.
  - `ecology.ts` `biomeOf` turns the map into rainforest, forest, taiga, savanna, grassland, steppe, desert
    or tundra.
- **Plants** (`flora.json`): era rows, from mosses at 470 Ma to grasslands from 20 Ma.
  - Each row gives a mix per biome and a density per biome, with sources.
  - `population.ts` fills 24 m cells deterministically from a hash of the cell and the era. Patches give
    glades and thickets.
  - Trees are kept out to `treeRadius`, tufts to `tuftRadius` (by quality, `LIMITS`), nearest first.
- **Animals** (`species.json`): each row has an era range, habitats, a herd size, an abundance, and a
  range from either source:
  - PBDB fossil finds (`public/data/life/occurrences.json`, `tools/build-life.mjs`).
  - Hand-entered regions for hominins, humans and some living animals (boxes with time windows, with
    sources).

  `presence()` is 1 inside a region. Otherwise it falls off with the distance to the nearest find of
  about that age: within 1800 km, slack of 10% of the age (at least 1 Myr in deep time). Finds from
  2.6 Ma on use their paleo-coordinates (`pgm=scotese`, the frame of the PaleoDEM maps), younger ones
  their modern coordinates.

  Each 240 m cell may hold one herd: pick a guild present there, then a species by presence × habitat
  × abundance.

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
    small in Float32. The shader turns the anchor's tangent frame into world axes.
  - Ground heights come from `terrainHeightAt` (terrain `public.ts`): the exact finest-level ground of
    the drawn mesh.
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

- Quadrupeds walk in a lateral sequence; bipeds and uprights walk in antiphase, with the arms against
  the legs.
- Tails sway, necks nod and graze, wings flap.
- Plants (`kit/plants.ts`: mosses, Cooksonia, scale trees, horsetails, tree ferns, seed ferns, conifers,
  araucarias, cycads, ginkgos, broadleaf trees, palms, birches, shrubs, grass, cacti) sway in the wind
  by height.

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

- `public/data/life/occurrences.json`: 285 KB, loaded the first time life is active. It is built by
  `node tools/build-life.mjs` (add `--refresh` to download again with curl; raw responses are cached
  in `.cache/raw/life`).
- The PBDB API embeds a timing field, so its responses are not byte-stable. The manifest entry is
  therefore a reference without a URL, and the derived snapshot is committed (CC BY 4.0, credited).

## Tests

- **Unit** (`tests/unit/life`):
  - The data: models, sources, contiguous flora eras.
  - Biomes; ranges (T. rex only in Late Cretaceous Laramidia; the human dispersal; featured herds alive
    where placed; candidates of the time).
  - Kit sanity (finite, on the ground, joints, sway weights).
  - Population determinism and limits; motion consistency.
- **E2E** (`tests/e2e/life.spec.ts`):
  - Four bookmarks with their cast (test hook `window.__life`) and the horizon band holding trees and
    animals.
  - The T. rex site set to today has no dinosaurs.
  - Budgets: at most 150 draws and 60 programs on potato.

## Known gaps

- Ground cover is sparse at grass scale (no grass texture yet), and all plants of a kind share one
  variant mesh.
- The modern era has wild animals only. People near cities are Phase 3 (cities).
- No cast shadows; animals do not avoid each other, trees or water. Herds do not migrate.
- Presence by distance to finds is coarse: it can put a species a little beyond its real range, and sparse
  records leave gaps.
- Deep-time terrain heights are today's relief at the paleo-coordinates (see paleo Known gaps).
