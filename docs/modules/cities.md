# Cities through history (cities)

Cities appear, grow, change style and vanish with the clock, from Çatalhöyük (7100 BC) and Uruk to
today's megacities. From orbit, the largest cities of the date are labelled with approximate populations.
On the ground, the life module draws their era-styled buildings, monuments and people. Everything is
approximate (validity `cities.population`). Cross-module API: `src/modules/cities/public.ts`.

## Data (`tools/build-cities.mjs` → `public/data/cities/cities.json`)

- **History table** (`src/modules/cities/history.json`): hand-entered, with sources per row (Chandler
  1987, Modelski 2003, Morris 2010, Bairoch 1988, UN World Urbanization Prospects 2018). Each city has:
  - Its founding and (where it ended) abandonment years.
  - Population estimates over time.
  - Its architectural style by period (e.g. Rome: classical, then medieval, industrial, modern).
  - Optional names by period (Byzantium, Constantinople, Istanbul).
- **Natural Earth populated places** (v5.1.2, public domain): today's cities of at least 300 000 people
  that the table does not hold. They appear from 1950 at a third of today's size (approximate).
- **Monuments** (`monuments.json`): drawn at their real places from completion to destruction or ruin.
  Examples: the Giza pyramids, the ziggurats of Ur and Babylon (Etemenanki), the Parthenon, the Temple
  of Jupiter, Hagia Sophia, the Pyramid of the Sun, El Castillo, the Templo Mayor, Angkor Wat, the Great
  Mosque of Djenné, Notre-Dame, the Forbidden City, Himeji Castle and the Empire State Building.

Years in the table are historical (negative = BC, no year 0). `cities.json` uses astronomical numbering
(1 BC = 0). `data.ts` turns a JD into a year (`yearOfJd`). Population is log-linear between estimates and
ramps up from 1000 people at founding. The built-up radius comes from a density of 25 000 people per
km² before 1800, 12 000 until 1950 and 5 000 for modern metro areas.

The table first planned was Reba, Reitsma & Seto (2016) on Harvard Dataverse (CC BY 4.0). Its download
sits behind a personal-details guestbook, so the table is hand-entered from the same underlying sources
instead.

## Labels

Label source `cities`: the largest cities of the date, more as the camera nears Earth (12 beyond
20 000 km, then 30, 60 and 120). The text is "Rome ≈450k". The overlay declutters by priority (log of
the population) and hides cities behind Earth.

## Ground level (drawn by the life module)

`settlementsNear` and `monumentsNear` feed `life/population.ts` `buildingsAround`:

- Building kinds: `life/kit/buildings.ts`, procedural low-poly in 17 styles.
- Placement:
  - Houses go in 22 m cells on blocks between streets (every fifth row and column). They are denser
    near the centre and slightly jittered and twisted in unplanned towns.
  - The style's landmarks stand at the centre (ziggurat, temple, cathedral and keep, mosque, pagoda,
    step pyramid, mud mosque, baroque church, towers).
  - Pre-modern walled styles get a wall ring with gates.
  - Modern cities have towers at the centre, apartments, then suburbs.
- Townspeople (tunics before 1800, modern clothes after) fill the streets. The farmland around towns
  holds livestock where it lived then, and no wild herds or wild plants inside towns.

## Bookmarks (`sites.json`)

| Id                       | View                                                  |
| ------------------------ | ----------------------------------------------------- |
| `city-giza-2450bc`       | The three pyramids from the plateau to the south-east |
| `city-babylon-570bc`     | Etemenanki in Nebuchadnezzar's Babylon                |
| `city-rome-117ad`        | The Forum towards the Capitoline under Trajan         |
| `city-tenochtitlan-1500` | The Templo Mayor of the Aztec capital                 |
| `city-paris-1350`        | Notre-Dame across the Seine                           |
| `city-newyork-1935`      | Midtown towards the Empire State Building             |
| `city-labels-117ad`      | The Mediterranean world from 3500 km with city labels |

## Tests

- **Unit** (`tests/unit/cities`):
  - Table sanity, interpolation, founding and abandonment, styles by period, largest cities by date.
  - Years and radii.
  - Monuments and sites.
  - Building placement: landmarks, blocks, walls only before 1800; townsfolk instead of wild animals.
- **E2E** (`tests/e2e/cities.spec.ts`):
  - Giza with three pyramids.
  - Rome with temples, houses and people.
  - New York with towers.
  - Labels at AD 117 (Rome and Alexandria, no Constantinople or Tenochtitlan).

## Known gaps

- City footprints are circles around one centre; there are no rivers, harbours or real street plans, and
  no districts or suburbs of different ages.
- Natural Earth cities without history appear only from 1950.
- Pre-industrial cities have no night lights; the earth module's city lights start at about 1880.
- A city's style changes all at once at a period boundary.
